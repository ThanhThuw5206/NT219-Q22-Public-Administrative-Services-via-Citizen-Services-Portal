/**
 * Signature Service — backward-compatible shim over Falcon-512.
 *
 * Historically this module implemented an Ed25519 "demo" signature scheme
 * via `node:crypto.generateKeyPairSync('ed25519', ...)`. As of Task 1.6 of
 * the falcon-digital-signature-qr spec, the real signing engine lives in
 * `falcon/falcon.service.js` (built on `@noble/post-quantum`) and key
 * material is owned by `key-manager.service.js`.
 *
 * This file is now a thin **delegating** layer that preserves the EXACT
 * export names existing callers depend on (`document.service1.js`,
 * `network.controller.js`) so they keep working without sweeping changes.
 *
 * IMPORTANT — ASYNC MIGRATION:
 *   The previous Ed25519 implementation exposed `getActiveKey` and
 *   `signPayload` as synchronous functions. Falcon-512 key access is now
 *   async (the keystore is read lazily and may need to generate a fresh key
 *   pair on first call). Therefore:
 *
 *     - `getActiveKey()`           is now ASYNC. Callers must `await`.
 *     - `signPayload(payload)`     is now ASYNC. Callers must `await`.
 *     - `verifyPayloadSignature()` is now ASYNC. Callers must `await`.
 *     - `buildSignaturePayload()`  remains synchronous (pure function).
 *
 *   The minimal set of callers updated as part of Task 1.6:
 *     - `services/document.service1.js`  (processDocument, verifyDocument)
 *     - `controllers/document.controller.js`  (verifyDocumentByQr, verifyDocumentByUpload)
 *     - `controllers/network.controller.js`  (getCryptoPublicKey)
 *
 * Other behavioural changes vs the legacy demo:
 *   - `version` in the signature payload is now the STRING "1.0" instead of
 *     the numeric `1`. Any value passed by callers is ignored — the canonical
 *     payload always emits `version: "1.0"` (per spec Requirement 5.4).
 *   - No more `node:crypto` signature operations in this file. Falcon-512
 *     signing/verification goes through `falcon.service.js`.
 *
 * Related: Requirements 1.7, 5.4, 5.5, 5.6, 5.10, 14.6.
 */

import * as falconService from "./falcon/falcon.service.js";
import * as keyManagerService from "./key-manager.service.js";
import { INTERNAL_CRYPTO_SECRET } from "../config/env.config.js";

const ALGORITHM = "FALCON-512";
const PROVIDER = "crypto-zone";

/**
 * Return the currently active Falcon-512 key as a plain metadata object.
 *
 * Shape:
 *   {
 *     key_id:     string,
 *     algorithm:  "FALCON-512",
 *     provider:   "file" | "crypto-zone",
 *     status:     "active",
 *     public_key: string,    // base64 of 897 bytes
 *     created_at: string,    // ISO 8601
 *   }
 *
 * NEVER returns a private key (or any encrypted form of it).
 *
 * @returns {Promise<{
 *   key_id: string,
 *   algorithm: string,
 *   provider: string,
 *   status: string,
 *   public_key: string,
 *   created_at: string,
 * }>}
 */
export const getActiveKey = async () => {
    const active = await keyManagerService.getActivePublicKey();
    return {
        key_id: active.key_id,
        algorithm: active.algorithm,
        provider: active.provider,
        status: active.status,
        public_key: active.public_key,
        created_at: active.created_at,
    };
};

/**
 * Build the canonical JSON payload that gets signed.
 *
 * Delegates to `falconService.signaturePayload` — keys are emitted
 * alphabetically, no whitespace, snake_case. The `version` field is ALWAYS
 * the string "1.0" regardless of what the caller passes (legacy callers
 * may still pass the numeric `1`; we normalise here).
 *
 * @param {Object} input
 * @param {string} input.documentId
 * @param {string} input.fileHash    SHA-256 hex (64 lowercase chars).
 * @param {string} input.issuedAt    ISO 8601 timestamp.
 * @param {string} input.keyId
 * @param {*}      [input.version]   Ignored. Always emitted as "1.0".
 * @returns {string} canonical JSON string
 */
export const buildSignaturePayload = ({ documentId, fileHash, issuedAt, keyId } = {}) => {
    return falconService.signaturePayload({
        documentId,
        fileHash,
        issuedAt,
        keyId,
        version: "1.0",
    });
};

/**
 * Sign a canonical payload with the active Falcon-512 private key.
 *
 * Steps:
 *   1. Resolve the active key via Key Manager (read_public).
 *   2. Fetch its (decrypted) private key with the internal crypto secret.
 *   3. Hand the payload + private key to `falconService.sign`.
 *
 * Returns the legacy-compatible shape consumed by `document.service1.js`:
 *   { signature: base64, key_id, algorithm, provider }
 *
 * @param {string | Object} payload  Canonical JSON string (recommended) or a
 *   plain object that `falconService.sign` will canonicalise itself.
 * @returns {Promise<{
 *   signature: string,
 *   key_id: string,
 *   algorithm: string,
 *   provider: string,
 * }>}
 */
export const signPayload = async (payload) => {
    const activeKey = await keyManagerService.getActivePublicKey();
    const privateKeyBase64 = await keyManagerService.getPrivateKey(
        activeKey.key_id,
        INTERNAL_CRYPTO_SECRET
    );

    const result = await falconService.sign(payload, privateKeyBase64, {
        keyId: activeKey.key_id,
    });

    return {
        signature: result.signature,
        key_id: result.key_id,
        algorithm: result.algorithm ?? ALGORITHM,
        provider: result.provider ?? PROVIDER,
    };
};

/**
 * Verify a Falcon-512 signature.
 *
 * **NEVER throws.** Any malformed input — wrong base64, wrong sizes,
 * mismatched signature, library failure — collapses to `false`. This
 * matches the contract enforced by `falconService.verify`.
 *
 * @param {Object} input
 * @param {string} input.payload    Canonical JSON string that was signed.
 * @param {string} input.signature  Base64 signature.
 * @param {string} input.publicKey  Base64 Falcon-512 public key (897 bytes).
 * @returns {Promise<boolean>}
 */
export const verifyPayloadSignature = async ({ payload, signature, publicKey } = {}) => {
    try {
        return await falconService.verify(payload, signature, publicKey);
    } catch (_err) {
        // Defence-in-depth: falconService.verify already swallows everything,
        // but honour the "never throws" contract regardless.
        return false;
    }
};
