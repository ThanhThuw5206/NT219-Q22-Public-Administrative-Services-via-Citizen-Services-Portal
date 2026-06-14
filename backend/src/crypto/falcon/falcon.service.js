/**
 * Falcon Signature Service — application-level signing API.
 *
 * Sits one layer above `falcon.adapter.js`. The adapter speaks raw bytes;
 * this service speaks the project's domain (canonical JSON payloads, base64
 * keys/signatures, ISO timestamps, structured metadata).
 *
 * Design contract:
 *   - `signaturePayload(...)` produces the SAME bytes for the SAME logical
 *     input on any machine, so signatures are reproducible. Keys are emitted
 *     in alphabetical order, snake_case, with no whitespace, and `version`
 *     is always the string "1.0" (NOT the number 1).
 *   - `sign(...)` accepts either a payload object (canonicalised here) or a
 *     pre-built JSON string (used verbatim, e.g. when re-signing an existing
 *     payload). Either way the bytes that hit Falcon are exactly the JSON
 *     string interpreted as UTF-8.
 *   - `verify(...)` NEVER throws. Bad base64, wrong key sizes, malformed
 *     signatures, library exceptions — all collapse to `false`. This lets
 *     verification endpoints treat any unparseable input as "not valid"
 *     without leaking exceptions to the HTTP layer.
 *
 * Related: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.10, 5.1, 5.2, 5.3,
 *          5.7, 5.8, 5.9, 5.11.
 */

import {
    FALCON512,
    FalconAdapterError,
    sign as falconSign,
    verify as falconVerify,
} from "./falcon.adapter.js";

const ALGORITHM = "FALCON-512";
const PROVIDER = "crypto-zone";
const PAYLOAD_VERSION_DEFAULT = "1.0";

// SHA-256 hex (lowercase, 64 chars). Matches the contract enforced by
// hash.service.js so a hash that came from there will always pass here.
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function snakeCaseKey(key) {
    return String(key)
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[\s-]+/g, "_")
        .toLowerCase();
}

function normalizeForCanonicalJson(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeForCanonicalJson);
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            const normalized = normalizeForCanonicalJson(value[key]);
            if (normalized !== undefined) {
                out[snakeCaseKey(key)] = normalized;
            }
        }
        return out;
    }
    if (value === undefined) {
        return undefined;
    }
    return value;
}

function canonicalStringify(value) {
    return JSON.stringify(normalizeForCanonicalJson(value));
}

/**
 * Stable error class used by every export in this service.
 *
 * `code` is part of the public contract. The optional `cause` carries the
 * original error (e.g. a `FalconAdapterError`) for logging without leaking
 * internal stack traces back to the caller.
 */
export class FalconServiceError extends Error {
    /**
     * @param {string} code  One of: 'INVALID_PAYLOAD', 'INVALID_PRIVATE_KEY',
     *   'INVALID_KEY_ID', 'SIGN_FAILED'.
     * @param {string} message
     * @param {unknown} [cause]
     */
    constructor(code, message, cause) {
        super(message);
        this.name = "FalconServiceError";
        this.code = code;
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}

/**
 * Internal helper: assert that `value` is a non-empty string. Used to
 * validate the string-typed fields of the signature payload.
 *
 * @param {unknown} value
 * @param {string} field  Field name, used in the error message only.
 * @throws {FalconServiceError} 'INVALID_PAYLOAD'
 */
function assertNonEmptyString(value, field) {
    if (typeof value !== "string" || value.length === 0) {
        throw new FalconServiceError(
            "INVALID_PAYLOAD",
            `Signature payload field '${field}' must be a non-empty string`
        );
    }
}

/**
 * Build the canonical JSON string that gets signed (or that will be passed
 * to `verify`).
 *
 * The output is deterministic:
 *   - keys are snake_case
 *   - keys are emitted in alphabetical order, recursively
 *   - there is no whitespace (compact JSON)
 *   - `version` is always a STRING. Defaults to "1.0".
 *
 * Example output:
 *   {"document_id":"HS-2026-XXX","file_hash":"abc...","issued_at":"2026-01-15T10:30:00Z","key_id":"falcon-prod-key-001","version":"1.0"}
 *
 * @param {Object} input
 * @param {string} input.documentId
 * @param {string} input.fileHash         SHA-256 hex (64 lowercase chars).
 * @param {string} input.issuedAt         ISO 8601 timestamp.
 * @param {string} input.keyId
 * @param {string} [input.version]        Defaults to "1.0".
 * @param {string} [input.documentType]
 * @param {string} [input.hashAlgorithm]
 * @param {string} [input.algorithm]
 * @param {string} [input.purpose]
 * @param {Object} [input.signer]
 * @param {Object} [input.organization]
 * @returns {string} canonical JSON string
 * @throws {FalconServiceError} 'INVALID_PAYLOAD'
 */
export function signaturePayload(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new FalconServiceError(
            "INVALID_PAYLOAD",
            "signaturePayload expects a plain object"
        );
    }

    const {
        documentId,
        fileHash,
        issuedAt,
        keyId,
        version,
        documentType,
        hashAlgorithm,
        algorithm,
        purpose,
        signer,
        organization,
    } = input;

    assertNonEmptyString(documentId, "documentId");
    assertNonEmptyString(fileHash, "fileHash");
    assertNonEmptyString(issuedAt, "issuedAt");
    assertNonEmptyString(keyId, "keyId");

    if (!SHA256_HEX_RE.test(fileHash)) {
        throw new FalconServiceError(
            "INVALID_PAYLOAD",
            "Signature payload field 'fileHash' must be a 64-character lowercase hex string"
        );
    }

    // Loose ISO 8601 sanity check — we don't try to parse every variant, just
    // make sure we're not handed a number or a Date object. Strict ISO format
    // validation is the caller's job.
    if (Number.isNaN(Date.parse(issuedAt))) {
        throw new FalconServiceError(
            "INVALID_PAYLOAD",
            "Signature payload field 'issuedAt' must be an ISO 8601 timestamp"
        );
    }

    const versionValue = version === undefined ? PAYLOAD_VERSION_DEFAULT : version;
    if (typeof versionValue !== "string" || versionValue.length === 0) {
        throw new FalconServiceError(
            "INVALID_PAYLOAD",
            "Signature payload field 'version' must be a non-empty string"
        );
    }

    const canonical = {
        algorithm: algorithm || ALGORITHM,
        document_id: documentId,
        document_type: documentType || "CT01",
        file_hash: fileHash,
        hash_algorithm: hashAlgorithm || "SHA-256",
        issued_at: issuedAt,
        key_id: keyId,
        organization: organization || null,
        purpose: purpose || "Issue public administrative document",
        signer: signer || null,
        version: versionValue,
    };

    return canonicalStringify(canonical);
}

/**
 * Resolve the payload bytes + key_id for `sign(...)`.
 *
 * Two input shapes are accepted:
 *   1. an object — canonicalised via `signaturePayload`; key_id comes from
 *      the object's `keyId` field.
 *   2. a JSON string — used verbatim as the bytes to sign; key_id is parsed
 *      out of the JSON's `key_id` field if present, or pulled from the
 *      `options.keyId` override.
 *
 * @param {Object | string} payloadInput
 * @param {{ keyId?: string }} options
 * @returns {{ payloadJson: string, keyId: string }}
 * @throws {FalconServiceError} 'INVALID_PAYLOAD' | 'INVALID_KEY_ID'
 */
function resolvePayload(payloadInput, options) {
    if (typeof payloadInput === "string") {
        let parsed;
        try {
            parsed = JSON.parse(payloadInput);
        } catch (err) {
            // Pre-built JSON string. If we can't parse it we still need a
            // key_id from somewhere — fall through to the override.
            parsed = null;
        }

        const overrideKeyId = options.keyId;
        const fromJson =
            parsed && typeof parsed === "object" ? parsed.key_id : undefined;
        const keyId = overrideKeyId ?? fromJson;

        if (typeof keyId !== "string" || keyId.length === 0) {
            throw new FalconServiceError(
                "INVALID_KEY_ID",
                "key_id could not be derived from the JSON payload; pass options.keyId"
            );
        }

        return { payloadJson: payloadInput, keyId };
    }

    if (payloadInput === null || typeof payloadInput !== "object") {
        throw new FalconServiceError(
            "INVALID_PAYLOAD",
            "sign() expects an object or a JSON string"
        );
    }

    // Object input: build the canonical JSON via signaturePayload, which
    // also validates that keyId is present.
    const payloadJson = signaturePayload(payloadInput);
    const keyId = options.keyId ?? payloadInput.keyId;

    if (typeof keyId !== "string" || keyId.length === 0) {
        // In practice signaturePayload already enforced this, but guard
        // anyway in case a future change loosens it.
        throw new FalconServiceError(
            "INVALID_KEY_ID",
            "key_id is required to sign a payload"
        );
    }

    return { payloadJson, keyId };
}

/**
 * Decode a base64 string into a `Uint8Array`. Throws our typed error on
 * malformed input so callers see a stable code instead of a `TypeError`
 * from Buffer.
 *
 * @param {string} b64
 * @param {string} field  e.g. "private_key", used in the error message.
 * @param {string} errorCode  Code to throw on failure.
 * @returns {Uint8Array}
 */
function decodeBase64(b64, field, errorCode) {
    if (typeof b64 !== "string" || b64.length === 0) {
        throw new FalconServiceError(
            errorCode,
            `${field} must be a non-empty base64 string`
        );
    }
    let buf;
    try {
        buf = Buffer.from(b64, "base64");
    } catch (err) {
        throw new FalconServiceError(
            errorCode,
            `${field} is not valid base64`,
            err
        );
    }
    // `Buffer.from(s, 'base64')` is permissive — it returns an empty buffer
    // for total garbage rather than throwing. Treat that as malformed input.
    if (buf.length === 0) {
        throw new FalconServiceError(
            errorCode,
            `${field} decoded to zero bytes`
        );
    }
    // Return a *plain* Uint8Array view backed by the same memory. The
    // adapter does `instanceof Uint8Array` checks, and Buffer extends
    // Uint8Array so this is fine, but we copy to a clean Uint8Array to
    // avoid surprising downstream code that might mutate it.
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Sign a payload with a Falcon-512 private key.
 *
 * `payloadInput` may be:
 *   - an object: canonicalised via `signaturePayload`. Validates fields.
 *   - a JSON string: used as-is for the bytes being signed.
 *
 * The returned `key_id` is, in priority order:
 *   1. `options.keyId` (explicit override)
 *   2. the `keyId` field on the payload object (or `key_id` on a parsed JSON
 *      payload)
 *
 * If no key_id can be resolved, `FalconServiceError('INVALID_KEY_ID')` is
 * thrown.
 *
 * @param {Object | string} payloadInput
 * @param {string} privateKeyBase64  Base64 of a 1281-byte Falcon-512 secret key.
 * @param {{ keyId?: string }} [options]
 * @returns {Promise<{
 *   signature: string,
 *   key_id: string,
 *   algorithm: 'FALCON-512',
 *   provider: 'crypto-zone',
 *   signed_at: string,
 * }>}
 * @throws {FalconServiceError} 'INVALID_PAYLOAD' | 'INVALID_PRIVATE_KEY' |
 *   'INVALID_KEY_ID' | 'SIGN_FAILED'
 */
export async function sign(payloadInput, privateKeyBase64, options = {}) {
    const { payloadJson, keyId } = resolvePayload(payloadInput, options);

    const privateKeyBytes = decodeBase64(
        privateKeyBase64,
        "private_key",
        "INVALID_PRIVATE_KEY"
    );

    if (privateKeyBytes.length !== FALCON512.PRIVATE_KEY_BYTES) {
        throw new FalconServiceError(
            "INVALID_PRIVATE_KEY",
            `Falcon-512 private key must be exactly ${FALCON512.PRIVATE_KEY_BYTES} bytes (got ${privateKeyBytes.length})`
        );
    }

    const messageBytes = new Uint8Array(Buffer.from(payloadJson, "utf8"));

    let signatureBytes;
    try {
        signatureBytes = await falconSign(messageBytes, privateKeyBytes);
    } catch (err) {
        // The adapter already validated sizes and converts library errors
        // into FalconAdapterError. Re-wrap as a service-level error so
        // callers only have to switch on FalconServiceError codes.
        if (err instanceof FalconAdapterError) {
            throw new FalconServiceError(
                "SIGN_FAILED",
                "Falcon-512 sign operation failed",
                err
            );
        }
        throw new FalconServiceError(
            "SIGN_FAILED",
            "Unexpected error during Falcon-512 signing",
            err
        );
    }

    return {
        signature: Buffer.from(signatureBytes).toString("base64"),
        key_id: keyId,
        algorithm: ALGORITHM,
        provider: PROVIDER,
        signed_at: new Date().toISOString(),
    };
}

/**
 * Verify a Falcon-512 signature.
 *
 * **NEVER throws.** All of the following collapse to `false`:
 *   - any argument is not a string
 *   - signature or public key is not valid base64
 *   - decoded sizes are wrong
 *   - the underlying adapter / library throws
 *   - the signature simply doesn't match the message
 *
 * This shape lets verification endpoints safely treat any unparseable
 * signature as "not valid" without leaking exceptions to the HTTP layer.
 *
 * @param {string} payloadJson      The exact JSON string that was signed.
 * @param {string} signatureBase64
 * @param {string} publicKeyBase64
 * @returns {Promise<boolean>}
 */
export async function verify(payloadJson, signatureBase64, publicKeyBase64) {
    try {
        if (
            typeof payloadJson !== "string" ||
            typeof signatureBase64 !== "string" ||
            typeof publicKeyBase64 !== "string"
        ) {
            return false;
        }

        // Decode without throwing — any failure here is just "not valid".
        let signatureBytes;
        let publicKeyBytes;
        try {
            const sigBuf = Buffer.from(signatureBase64, "base64");
            const pubBuf = Buffer.from(publicKeyBase64, "base64");
            if (sigBuf.length === 0 || pubBuf.length === 0) {
                return false;
            }
            signatureBytes = new Uint8Array(
                sigBuf.buffer,
                sigBuf.byteOffset,
                sigBuf.byteLength
            );
            publicKeyBytes = new Uint8Array(
                pubBuf.buffer,
                pubBuf.byteOffset,
                pubBuf.byteLength
            );
        } catch (_err) {
            return false;
        }

        const messageBytes = new Uint8Array(Buffer.from(payloadJson, "utf8"));

        // Adapter's verify() already swallows exceptions and validates
        // sizes, returning false for any mismatch.
        return await falconVerify(messageBytes, signatureBytes, publicKeyBytes);
    } catch (_err) {
        // Defence-in-depth: even if Buffer.from somehow throws on this
        // platform, we honour the "never throws" contract.
        return false;
    }
}
