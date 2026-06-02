/**
 * Key Manager — owns the lifecycle of Falcon-512 key material.
 *
 * Responsibilities:
 *   - Generate fresh Falcon-512 key pairs via the adapter.
 *   - Persist them to a local encrypted keystore (`falcon-keystore.json`).
 *   - Hand out the active *public* key freely.
 *   - Hand out the *private* key only to callers that present the matching
 *     `INTERNAL_CRYPTO_SECRET`, and audit every attempt (success or denied).
 *   - Support key rotation by flipping the previous active key to `inactive`.
 *
 * Storage format (`backend/src/crypto/keys/falcon-keystore.json`):
 *   {
 *     "keys": [
 *       {
 *         "key_id": "falcon-development-key-ab12cd34",
 *         "algorithm": "FALCON-512",
 *         "provider": "file",
 *         "status": "active" | "inactive" | "revoked",
 *         "public_key": "<base64 of 897 bytes>",
 *         "encrypted_private_key": "<base64 of (salt(16) || iv(16) || ciphertext)>",
 *         "created_at": "2026-01-15T10:30:00.000Z",
 *         "rotated_at": "2026-02-01T08:00:00.000Z"  // optional
 *       },
 *       ...
 *     ]
 *   }
 *
 * Encryption:
 *   - AES-256-CBC with a 32-byte key derived via PBKDF2-HMAC-SHA256 (10000
 *     iterations, 16-byte random salt) from `INTERNAL_CRYPTO_SECRET`.
 *   - 16-byte random IV per encryption. Salt + IV are stored alongside the
 *     ciphertext so each key entry is independently decryptable.
 *
 * Lazy initialisation:
 *   - We do NOT auto-generate keys at module load time (avoids surprise
 *     side effects on `import`). Instead, the first call to
 *     `getActivePublicKey()` (or any other read/write) will detect a
 *     missing keystore and create one fresh active key.
 *
 * File permissions:
 *   - We `chmod 0600` the keystore on every write. On Windows this is
 *     largely a no-op, so we swallow EPERM/ENOSYS/etc. and move on.
 *
 * Related: Requirements 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateKeyPair as falconGenerateKeyPair } from "./falcon/falcon.adapter.js";
import * as auditService from "../services/audit.service.js";
import env, { INTERNAL_CRYPTO_SECRET, NODE_ENV } from "../config/env.config.js";

const ALGORITHM = "FALCON-512";
const PROVIDER = "file";

const PBKDF2_ITERATIONS = 10000;
const PBKDF2_KEY_BYTES = 32; // AES-256
const PBKDF2_SALT_BYTES = 16;
const AES_IV_BYTES = 16;
const AES_CIPHER = "aes-256-cbc";

// Resolve the keystore path relative to this file so it survives any
// `process.cwd()` change (e.g. when run from project root vs. backend/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYSTORE_DIR = path.join(__dirname, "keys");
const KEYSTORE_PATH = path.join(KEYSTORE_DIR, "falcon-keystore.json");

/**
 * Stable error class. `code` is part of the public contract so callers can
 * switch on it for HTTP responses or recovery logic without parsing
 * messages.
 *
 * Codes:
 *   - UNAUTHORIZED          internalSecret did not match the env secret
 *   - KEY_NOT_FOUND         no key with the requested key_id
 *   - NO_ACTIVE_KEY         keystore exists but has no active entry
 *   - KEYSTORE_READ_FAILED  keystore file is missing/corrupt/unreadable
 *   - KEYSTORE_WRITE_FAILED could not persist changes to the keystore
 *   - DECRYPT_FAILED        ciphertext could not be decrypted (wrong secret,
 *                           corrupted data, etc.)
 */
export class KeyManagerError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {unknown} [cause]  Original error, kept for logging only.
     */
    constructor(code, message, cause) {
        super(message);
        this.name = "KeyManagerError";
        this.code = code;
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt raw private-key bytes with AES-256-CBC, deriving the key from
 * `password` via PBKDF2-HMAC-SHA256.
 *
 * Output layout: `salt(16) || iv(16) || ciphertext` as a single Buffer.
 *
 * @param {Uint8Array | Buffer} privateKeyBytes
 * @param {string} password
 * @returns {Buffer}
 */
function encryptPrivateKey(privateKeyBytes, password) {
    const salt = crypto.randomBytes(PBKDF2_SALT_BYTES);
    const key = crypto.pbkdf2Sync(
        password,
        salt,
        PBKDF2_ITERATIONS,
        PBKDF2_KEY_BYTES,
        "sha256"
    );
    const iv = crypto.randomBytes(AES_IV_BYTES);
    const cipher = crypto.createCipheriv(AES_CIPHER, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(privateKeyBytes),
        cipher.final(),
    ]);
    return Buffer.concat([salt, iv, encrypted]);
}

/**
 * Reverse of `encryptPrivateKey`. Throws `KeyManagerError('DECRYPT_FAILED')`
 * on any failure (wrong password, truncated buffer, padding error, ...).
 *
 * @param {Buffer} encryptedBuffer  Output of `encryptPrivateKey`.
 * @param {string} password
 * @returns {Buffer}  Plaintext private-key bytes.
 */
function decryptPrivateKey(encryptedBuffer, password) {
    if (
        !Buffer.isBuffer(encryptedBuffer) ||
        encryptedBuffer.length <= PBKDF2_SALT_BYTES + AES_IV_BYTES
    ) {
        throw new KeyManagerError(
            "DECRYPT_FAILED",
            "Encrypted private key buffer is malformed"
        );
    }
    try {
        const salt = encryptedBuffer.subarray(0, PBKDF2_SALT_BYTES);
        const iv = encryptedBuffer.subarray(
            PBKDF2_SALT_BYTES,
            PBKDF2_SALT_BYTES + AES_IV_BYTES
        );
        const ciphertext = encryptedBuffer.subarray(
            PBKDF2_SALT_BYTES + AES_IV_BYTES
        );
        const key = crypto.pbkdf2Sync(
            password,
            salt,
            PBKDF2_ITERATIONS,
            PBKDF2_KEY_BYTES,
            "sha256"
        );
        const decipher = crypto.createDecipheriv(AES_CIPHER, key, iv);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
        // Don't leak the underlying OpenSSL error message, but keep it on
        // .cause for logging by the caller.
        throw new KeyManagerError(
            "DECRYPT_FAILED",
            "Failed to decrypt private key (wrong secret or corrupted data)",
            err
        );
    }
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

/**
 * Defensive audit logger. Tries `auditService.logKeyAccess` first (the
 * canonical name added in Phase 3), falls back to the existing
 * `writeAuditLog` shim, and ultimately swallows any error so that a broken
 * audit subsystem can never block a key operation.
 *
 * @param {{
 *   keyId: string | null,
 *   userId?: string,
 *   ipAddress?: string | null,
 *   accessType: "read_public" | "read_private" | "sign" | "verify" | "rotate" | "generate",
 *   result: "success" | "fail",
 *   details?: Record<string, unknown>,
 * }} entry
 */
function safeAuditKeyAccess(entry) {
    try {
        if (typeof auditService.logKeyAccess === "function") {
            // Canonical API (added in Phase 3 of the spec).
            auditService.logKeyAccess({
                keyId: entry.keyId,
                userId: entry.userId || null,
                ipAddress: entry.ipAddress || null,
                accessType: entry.accessType,
                result: entry.result
            });
            return;
        }
        if (typeof auditService.writeAuditLog === "function") {
            // Compatibility shim against the current in-memory logger,
            // which only knows the generic `writeAuditLog({action, ...})`
            // shape.
            auditService.writeAuditLog({
                action: "key_access",
                documentId: null,
                result: entry.result,
                userId: entry.userId || null,
                ipAddress: entry.ipAddress || null
            });
            return;
        }
        // No logger available — that's fine in early-bring-up environments.
    } catch (_err) {
        // Audit MUST NOT crash key operations. Intentionally swallow.
    }
}

// ---------------------------------------------------------------------------
// Keystore I/O
// ---------------------------------------------------------------------------

/**
 * @returns {boolean} `true` if the keystore file currently exists on disk.
 */
function keystoreExists() {
    try {
        return fs.existsSync(KEYSTORE_PATH);
    } catch (_err) {
        return false;
    }
}

/**
 * Read & parse the keystore. Throws `KeyManagerError('KEYSTORE_READ_FAILED')`
 * on missing file, malformed JSON, or wrong shape.
 *
 * @returns {{ keys: Array<Object> }}
 */
function readKeystore() {
    if (!keystoreExists()) {
        throw new KeyManagerError(
            "KEYSTORE_READ_FAILED",
            `Keystore not found at ${KEYSTORE_PATH}`
        );
    }
    let raw;
    try {
        raw = fs.readFileSync(KEYSTORE_PATH, "utf8");
    } catch (err) {
        throw new KeyManagerError(
            "KEYSTORE_READ_FAILED",
            "Failed to read keystore file",
            err
        );
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new KeyManagerError(
            "KEYSTORE_READ_FAILED",
            "Keystore file is not valid JSON",
            err
        );
    }
    if (!parsed || !Array.isArray(parsed.keys)) {
        throw new KeyManagerError(
            "KEYSTORE_READ_FAILED",
            "Keystore JSON is missing the 'keys' array"
        );
    }
    return parsed;
}

/**
 * Atomically (best-effort) write the keystore and tighten its permissions.
 * On Windows `fs.chmod` mostly doesn't do anything useful — we still call
 * it but swallow failures.
 *
 * @param {{ keys: Array<Object> }} keystore
 */
function writeKeystore(keystore) {
    try {
        if (!fs.existsSync(KEYSTORE_DIR)) {
            fs.mkdirSync(KEYSTORE_DIR, { recursive: true });
        }
        const json = JSON.stringify(keystore, null, 2);
        fs.writeFileSync(KEYSTORE_PATH, json, { encoding: "utf8" });
    } catch (err) {
        throw new KeyManagerError(
            "KEYSTORE_WRITE_FAILED",
            "Failed to persist keystore",
            err
        );
    }
    try {
        fs.chmodSync(KEYSTORE_PATH, 0o600);
    } catch (_err) {
        // Windows / non-POSIX FS — chmod is unsupported. That's expected;
        // production deployments are responsible for actual ACLs.
    }
}

// ---------------------------------------------------------------------------
// Key creation
// ---------------------------------------------------------------------------

/**
 * Build a fresh `key_id` of the form `falcon-{env}-key-{8-hex-random}`.
 * The env segment comes from `NODE_ENV` (default "development").
 */
function newKeyId() {
    const envSegment = NODE_ENV || "development";
    const random = crypto.randomBytes(4).toString("hex"); // 8 hex chars
    return `falcon-${envSegment}-key-${random}`;
}

/**
 * Generate a Falcon-512 key pair via the adapter and turn it into a fully
 * populated keystore entry (including the encrypted private key).
 *
 * @param {string} password  The encryption password (== INTERNAL_CRYPTO_SECRET).
 * @returns {Promise<Object>} New keystore entry.
 */
async function createKeyEntry(password) {
    const { publicKey, privateKey } = await falconGenerateKeyPair();
    const encrypted = encryptPrivateKey(privateKey, password);

    return {
        key_id: newKeyId(),
        algorithm: ALGORITHM,
        provider: PROVIDER,
        status: "active",
        public_key: Buffer.from(publicKey).toString("base64"),
        encrypted_private_key: encrypted.toString("base64"),
        created_at: new Date().toISOString(),
    };
}

/**
 * If the keystore file is missing, generate one active key and persist it.
 * Idempotent: if the file already exists this is a no-op.
 *
 * @returns {Promise<{ keys: Array<Object> }>}  The (possibly freshly-created)
 *   keystore.
 */
async function ensureKeystoreInitialized() {
    if (keystoreExists()) {
        return readKeystore();
    }
    const entry = await createKeyEntry(INTERNAL_CRYPTO_SECRET);
    const keystore = { keys: [entry] };
    writeKeystore(keystore);
    return keystore;
}

/**
 * Strip the on-disk entry down to the public-safe metadata shape returned
 * to API callers. Never includes private-key material.
 */
function toPublicMetadata(entry) {
    const out = {
        key_id: entry.key_id,
        algorithm: entry.algorithm,
        provider: entry.provider,
        status: entry.status,
        created_at: entry.created_at,
    };
    if (entry.rotated_at) {
        out.rotated_at = entry.rotated_at;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a fresh Falcon-512 key pair and persist it to the keystore.
 *
 * The new key is appended with `status: "active"`. NOTE: this does NOT
 * automatically demote any other active key — use `rotateKeys()` for the
 * "atomic flip" semantics. This entrypoint exists primarily for first-time
 * provisioning and admin tooling.
 *
 * @returns {Promise<Object>} Public metadata for the newly-created key
 *   (no private-key fields).
 */
export async function generateKeyPair() {
    const keystore = keystoreExists()
        ? readKeystore()
        : { keys: [] };

    const entry = await createKeyEntry(INTERNAL_CRYPTO_SECRET);
    keystore.keys.push(entry);
    writeKeystore(keystore);

    safeAuditKeyAccess({
        keyId: entry.key_id,
        actor: "system",
        ipAddress: null,
        accessType: "generate",
        result: "success",
    });

    return toPublicMetadata(entry);
}

/**
 * Return the active public key plus its metadata.
 *
 * Lazy-initialises the keystore with one active key on first call if the
 * file does not yet exist (see file header for rationale).
 *
 * The returned object **never** contains `private_key` or
 * `encrypted_private_key`. The shape is:
 *   { key_id, algorithm, status, created_at, public_key, provider }
 *
 * @returns {Promise<Object>}
 * @throws {KeyManagerError} 'NO_ACTIVE_KEY' if the keystore exists but has
 *   no entry with `status === "active"`.
 */
export async function getActivePublicKey() {
    const keystore = await ensureKeystoreInitialized();
    const active = keystore.keys.find((k) => k.status === "active");

    if (!active) {
        throw new KeyManagerError(
            "NO_ACTIVE_KEY",
            "Keystore contains no active Falcon-512 key"
        );
    }

    safeAuditKeyAccess({
        keyId: active.key_id,
        actor: "system",
        ipAddress: null,
        accessType: "read_public",
        result: "success",
    });

    return {
        key_id: active.key_id,
        algorithm: active.algorithm,
        status: active.status,
        created_at: active.created_at,
        public_key: active.public_key,
        provider: active.provider,
    };
}

/**
 * Retrieve the (decrypted) private key for `keyId`, base64-encoded.
 *
 * **Authentication**: `internalSecret` MUST equal
 * `process.env.INTERNAL_CRYPTO_SECRET` (read here via `env.config.js`).
 * Mismatches throw `KeyManagerError('UNAUTHORIZED')` AND emit a denied
 * audit entry. They never leak whether the key exists.
 *
 * On success, the matching ciphertext is decrypted via AES-256-CBC + PBKDF2
 * and the resulting Falcon-512 secret-key bytes (1281 bytes) are returned
 * as a base64 string suitable for handing to `falcon.service.js#sign`.
 *
 * @param {string} keyId
 * @param {string} internalSecret
 * @param {{ actor?: string, ipAddress?: string | null }} [context]
 *   Optional caller info for the audit entry.
 * @returns {Promise<string>}  Base64-encoded private key.
 * @throws {KeyManagerError} 'UNAUTHORIZED' | 'KEY_NOT_FOUND' |
 *   'KEYSTORE_READ_FAILED' | 'DECRYPT_FAILED'
 */
export async function getPrivateKey(keyId, internalSecret, context = {}) {
    const actor = context.actor ?? "internal-service";
    const ipAddress = context.ipAddress ?? null;

    // Auth check FIRST — never read the keystore for unauthorised callers
    // (and never leak whether the key exists).
    if (
        typeof internalSecret !== "string" ||
        internalSecret.length === 0 ||
        internalSecret !== INTERNAL_CRYPTO_SECRET
    ) {
        safeAuditKeyAccess({
            keyId,
            actor,
            ipAddress,
            accessType: "read_private",
            result: "denied",
        });
        throw new KeyManagerError(
            "UNAUTHORIZED",
            "Invalid internal secret for private key access"
        );
    }

    let keystore;
    try {
        keystore = await ensureKeystoreInitialized();
    } catch (err) {
        safeAuditKeyAccess({
            keyId,
            actor,
            ipAddress,
            accessType: "read_private",
            result: "failed",
        });
        throw err;
    }

    const entry = keystore.keys.find((k) => k.key_id === keyId);
    if (!entry) {
        safeAuditKeyAccess({
            keyId,
            actor,
            ipAddress,
            accessType: "read_private",
            result: "failed",
            details: { reason: "KEY_NOT_FOUND" },
        });
        throw new KeyManagerError(
            "KEY_NOT_FOUND",
            `No key with key_id '${keyId}'`
        );
    }

    let plaintext;
    try {
        const encryptedBuffer = Buffer.from(entry.encrypted_private_key, "base64");
        plaintext = decryptPrivateKey(encryptedBuffer, INTERNAL_CRYPTO_SECRET);
    } catch (err) {
        safeAuditKeyAccess({
            keyId,
            actor,
            ipAddress,
            accessType: "read_private",
            result: "failed",
            details: { reason: "DECRYPT_FAILED" },
        });
        throw err;
    }

    safeAuditKeyAccess({
        keyId,
        actor,
        ipAddress,
        accessType: "read_private",
        result: "success",
    });

    return plaintext.toString("base64");
}

/**
 * Rotate to a fresh active key.
 *
 * Behaviour:
 *   1. Every entry currently `status === "active"` is flipped to
 *      `"inactive"` and stamped with `rotated_at = <now>`.
 *   2. A new Falcon-512 key pair is generated and appended with
 *      `status: "active"`.
 *   3. The keystore is rewritten in one go.
 *
 * Returns the public metadata for the newly-active key (no private-key
 * fields).
 *
 * @returns {Promise<Object>}
 */
export async function rotateKeys() {
    const keystore = await ensureKeystoreInitialized();
    const rotatedAt = new Date().toISOString();

    for (const k of keystore.keys) {
        if (k.status === "active") {
            k.status = "inactive";
            k.rotated_at = rotatedAt;
        }
    }

    const newEntry = await createKeyEntry(INTERNAL_CRYPTO_SECRET);
    keystore.keys.push(newEntry);
    writeKeystore(keystore);

    safeAuditKeyAccess({
        keyId: newEntry.key_id,
        actor: "system",
        ipAddress: null,
        accessType: "rotate",
        result: "success",
    });

    return toPublicMetadata(newEntry);
}

/**
 * Return public-safe metadata for `keyId`.
 *
 * Output shape: `{ key_id, algorithm, status, created_at, provider, rotated_at? }`.
 * Never includes `public_key`, `private_key`, or `encrypted_private_key`.
 *
 * @param {string} keyId
 * @returns {Promise<Object>}
 * @throws {KeyManagerError} 'KEY_NOT_FOUND'
 */
export async function getKeyMetadata(keyId) {
    const keystore = await ensureKeystoreInitialized();
    const entry = keystore.keys.find((k) => k.key_id === keyId);
    if (!entry) {
        throw new KeyManagerError(
            "KEY_NOT_FOUND",
            `No key with key_id '${keyId}'`
        );
    }
    return toPublicMetadata(entry);
}

// Re-export the keystore path for tests / admin tooling that need to
// inspect or wipe the file. Not part of the public service contract.
export const _KEYSTORE_PATH = KEYSTORE_PATH;
