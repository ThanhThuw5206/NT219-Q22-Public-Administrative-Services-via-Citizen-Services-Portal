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
 *   - New private-key entries use AES-256-GCM with a 32-byte key derived via
 *     scrypt from `INTERNAL_CRYPTO_SECRET`.
 *   - Older AES-256-CBC entries are still readable as a legacy compatibility
 *     path when the original secret is available.
 *
 * Initialisation:
 *   - We do NOT auto-generate keys at module load time (avoids surprise
 *     side effects on `import`). Production read-only paths also never
 *     generate key material implicitly; keys must be provisioned explicitly.
 *     Local/demo write paths may create encrypted file-backed keys.
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

const KDF = "scrypt";
const SCRYPT_KEY_BYTES = 32; // AES-256
const SCRYPT_SALT_BYTES = 16;
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const AES_GCM_CIPHER = "aes-256-gcm";
const FALCON512_PUBLIC_KEY_BYTES = 897;
const VALID_OWNER_TYPES = new Set(["user", "organization"]);
const VALID_EXTERNAL_PROVIDERS = new Set(["external-device", "officer-device", "smartcard", "pkcs11", "hsm", "kms"]);

const LEGACY_PBKDF2_ITERATIONS = 10000;
const LEGACY_PBKDF2_KEY_BYTES = 32;
const LEGACY_PBKDF2_SALT_BYTES = 16;
const LEGACY_AES_IV_BYTES = 16;
const LEGACY_AES_CIPHER = "aes-256-cbc";

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
function deriveScryptKey(password, salt) {
    return crypto.scryptSync(password, salt, SCRYPT_KEY_BYTES);
}

function encryptPrivateKey(privateKeyBytes, password) {
    const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
    const key = deriveScryptKey(password, salt);
    const iv = crypto.randomBytes(GCM_IV_BYTES);
    const cipher = crypto.createCipheriv(AES_GCM_CIPHER, key, iv, {
        authTagLength: GCM_AUTH_TAG_BYTES,
    });
    const encrypted = Buffer.concat([
        cipher.update(privateKeyBytes),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
        kdf: KDF,
        cipher: "AES-256-GCM",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: encrypted.toString("base64"),
    };
}

/**
 * Legacy reverse of the old AES-256-CBC encrypted blob. Kept so existing
 * development/demo keystores remain readable when the original secret exists.
 *
 * @param {Buffer} encryptedBuffer  salt(16) || iv(16) || ciphertext
 * @param {string} password
 * @returns {Buffer}  Plaintext private-key bytes.
 */
function decryptLegacyCbcPrivateKey(encryptedBuffer, password) {
    if (
        !Buffer.isBuffer(encryptedBuffer) ||
        encryptedBuffer.length <= LEGACY_PBKDF2_SALT_BYTES + LEGACY_AES_IV_BYTES
    ) {
        throw new KeyManagerError(
            "DECRYPT_FAILED",
            "Encrypted private key buffer is malformed"
        );
    }
    try {
        const salt = encryptedBuffer.subarray(0, LEGACY_PBKDF2_SALT_BYTES);
        const iv = encryptedBuffer.subarray(
            LEGACY_PBKDF2_SALT_BYTES,
            LEGACY_PBKDF2_SALT_BYTES + LEGACY_AES_IV_BYTES
        );
        const ciphertext = encryptedBuffer.subarray(
            LEGACY_PBKDF2_SALT_BYTES + LEGACY_AES_IV_BYTES
        );
        const key = crypto.pbkdf2Sync(
            password,
            salt,
            LEGACY_PBKDF2_ITERATIONS,
            LEGACY_PBKDF2_KEY_BYTES,
            "sha256"
        );
        const decipher = crypto.createDecipheriv(LEGACY_AES_CIPHER, key, iv);
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

function decryptGcmPrivateKey(encrypted, password) {
    if (
        !encrypted ||
        typeof encrypted !== "object" ||
        encrypted.cipher !== "AES-256-GCM" ||
        encrypted.kdf !== KDF
    ) {
        throw new KeyManagerError(
            "DECRYPT_FAILED",
            "Encrypted private key metadata is malformed"
        );
    }

    try {
        const salt = Buffer.from(encrypted.salt, "base64");
        const iv = Buffer.from(encrypted.iv, "base64");
        const tag = Buffer.from(encrypted.tag, "base64");
        const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
        const key = deriveScryptKey(password, salt);
        const decipher = crypto.createDecipheriv(AES_GCM_CIPHER, key, iv, {
            authTagLength: GCM_AUTH_TAG_BYTES,
        });
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
        throw new KeyManagerError(
            "DECRYPT_FAILED",
            "Failed to decrypt private key (wrong secret or corrupted data)",
            err
        );
    }
}

function decryptPrivateKey(encrypted, password) {
    if (typeof encrypted === "string") {
        return decryptLegacyCbcPrivateKey(Buffer.from(encrypted, "base64"), password);
    }
    return decryptGcmPrivateKey(encrypted, password);
}

function canDecryptPrivateKey(entry) {
    if (!entry?.encrypted_private_key) {
        return false;
    }
    try {
        decryptPrivateKey(entry.encrypted_private_key, INTERNAL_CRYPTO_SECRET);
        return true;
    } catch {
        return false;
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
                userId: entry.userId || entry.actor || null,
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
                userId: entry.userId || entry.actor || null,
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
function newKeyId({ ownerType = "organization", ownerId = "default" } = {}) {
    const envSegment = NODE_ENV || "development";
    const random = crypto.randomBytes(4).toString("hex"); // 8 hex chars
    const safeOwnerType = String(ownerType).replace(/[^a-z0-9-]/gi, "").toLowerCase() || "owner";
    const safeOwnerId = String(ownerId).replace(/[^a-z0-9-]/gi, "").toLowerCase() || "default";
    return `falcon-${safeOwnerType}-${safeOwnerId}-${envSegment}-${random}`;
}

/**
 * Generate a Falcon-512 key pair via the adapter and turn it into a fully
 * populated keystore entry (including the encrypted private key).
 *
 * @param {string} password  The encryption password (== INTERNAL_CRYPTO_SECRET).
 * @returns {Promise<Object>} New keystore entry.
 */
async function createKeyEntry(password, options = {}) {
    const {
        ownerType = "organization",
        ownerId = "default",
        ownerName = "Default Public Service Authority",
        validFrom = new Date().toISOString(),
        validTo = null,
    } = options;
    const { publicKey, privateKey } = await falconGenerateKeyPair();
    const encrypted = encryptPrivateKey(privateKey, password);

    return {
        key_id: newKeyId({ ownerType, ownerId }),
        algorithm: ALGORITHM,
        provider: PROVIDER,
        status: "active",
        owner_type: ownerType,
        owner_id: String(ownerId),
        owner_name: ownerName,
        public_key: Buffer.from(publicKey).toString("base64"),
        encrypted_private_key: encrypted,
        valid_from: validFrom,
        valid_to: validTo,
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

function readKeystoreIfExists() {
    if (!keystoreExists()) {
        return { keys: [] };
    }
    return readKeystore();
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
        owner_type: entry.owner_type || "organization",
        owner_id: entry.owner_id || "default",
        owner_name: entry.owner_name || "Default Public Service Authority",
        valid_from: entry.valid_from || entry.created_at,
        valid_to: entry.valid_to || null,
        created_at: entry.created_at,
    };
    if (entry.rotated_at) {
        out.rotated_at = entry.rotated_at;
    }
    if (entry.revoked_at) {
        out.revoked_at = entry.revoked_at;
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
    const keystore = env.IS_DEV ? await ensureKeystoreInitialized() : readKeystoreIfExists();
    let active = keystore.keys.find((k) => k.status === "active");

    if (!active) {
        throw new KeyManagerError(
            "NO_ACTIVE_KEY",
            "Keystore contains no active Falcon-512 key"
        );
    }

    if (env.IS_DEV && active.encrypted_private_key && !canDecryptPrivateKey(active)) {
        active.status = "revoked";
        active.revoked_at = new Date().toISOString();
        active.revocation_reason = "dev key could not be decrypted with current local secret";
        active = await createKeyEntry(INTERNAL_CRYPTO_SECRET, {
            ownerType: active.owner_type || "organization",
            ownerId: active.owner_id || "default",
            ownerName: active.owner_name || "Default Public Service Authority",
        });
        keystore.keys.push(active);
        writeKeystore(keystore);
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
        owner_type: active.owner_type || "organization",
        owner_id: active.owner_id || "default",
        owner_name: active.owner_name || "Default Public Service Authority",
        valid_from: active.valid_from || active.created_at,
        valid_to: active.valid_to || null,
    };
}

/**
 * Return the active public key for a specific owner. This supports both:
 *   - organization seal keys (`ownerType: "organization"`)
 *   - officer personal keys (`ownerType: "user"`)
 *
 * @param {{ ownerType?: string, ownerId?: string }} input
 * @returns {Promise<Object>}
 */
export async function getActivePublicKeyForOwner({ ownerType = "organization", ownerId = "default" } = {}) {
    const keystore = readKeystoreIfExists();
    let active = keystore.keys.find((k) =>
        k.status === "active" &&
        String(k.owner_type || "organization") === String(ownerType) &&
        String(k.owner_id || "default") === String(ownerId)
    );

    if (!active) {
        throw new KeyManagerError(
            "NO_ACTIVE_KEY",
            `No active Falcon-512 key for ${ownerType}:${ownerId}`
        );
    }

    if (env.IS_DEV && active.encrypted_private_key && !canDecryptPrivateKey(active)) {
        active.status = "revoked";
        active.revoked_at = new Date().toISOString();
        active.revocation_reason = "dev owner key could not be decrypted with current local secret";
        active = await createKeyEntry(INTERNAL_CRYPTO_SECRET, {
            ownerType: active.owner_type || ownerType,
            ownerId: active.owner_id || ownerId,
            ownerName: active.owner_name || "Local Demo Key Owner",
        });
        keystore.keys.push(active);
        writeKeystore(keystore);
    }

    return {
        ...toPublicMetadata(active),
        public_key: active.public_key,
    };
}

/**
 * Return an active owner key, creating one when no active key exists. This is
 * useful for demo/local encrypted backup flows. Production can provision keys
 * explicitly and avoid this helper.
 *
 * @param {{ ownerType?: string, ownerId?: string, ownerName?: string }} input
 * @returns {Promise<Object>}
 */
export async function getOrCreateActivePublicKeyForOwner({
    ownerType = "organization",
    ownerId = "default",
    ownerName = "Default Public Service Authority",
} = {}) {
    try {
        return await getActivePublicKeyForOwner({ ownerType, ownerId });
    } catch (err) {
        if (!(err instanceof KeyManagerError) || err.code !== "NO_ACTIVE_KEY") {
            throw err;
        }
    }

    const keystore = keystoreExists() ? readKeystore() : { keys: [] };
    const entry = await createKeyEntry(INTERNAL_CRYPTO_SECRET, {
        ownerType,
        ownerId,
        ownerName,
    });
    keystore.keys.push(entry);
    writeKeystore(keystore);

    safeAuditKeyAccess({
        keyId: entry.key_id,
        actor: "system",
        ipAddress: null,
        accessType: "generate",
        result: "success",
    });

    return {
        ...toPublicMetadata(entry),
        public_key: entry.public_key,
    };
}

/**
 * Register a public-only key owned by a user/device or organization. This is
 * the production path for officer personal keys: the backend stores only the
 * public key and verifies signatures created by the officer's device/token.
 *
 * @param {{
 *   ownerType?: "user" | "organization",
 *   ownerId: string,
 *   ownerName?: string,
 *   publicKey: string,
 *   algorithm?: string,
 *   provider?: string,
 *   validFrom?: string,
 *   validTo?: string | null,
 * }} input
 * @returns {Promise<Object>}
 */
export async function registerExternalPublicKeyForOwner({
    ownerType = "user",
    ownerId,
    ownerName = "",
    publicKey,
    algorithm = ALGORITHM,
    provider = "external-device",
    validFrom = new Date().toISOString(),
    validTo = null,
} = {}) {
    if (!VALID_OWNER_TYPES.has(ownerType)) {
        throw new KeyManagerError("INVALID_KEY_OWNER", "ownerType must be 'user' or 'organization'");
    }
    if (!ownerId || typeof ownerId !== "string") {
        throw new KeyManagerError("INVALID_KEY_OWNER", "ownerId is required");
    }
    if (algorithm !== ALGORITHM) {
        throw new KeyManagerError("INVALID_ALGORITHM", `algorithm must be ${ALGORITHM}`);
    }
    if (!VALID_EXTERNAL_PROVIDERS.has(provider)) {
        throw new KeyManagerError("INVALID_PROVIDER", "provider is not allowed for external public keys");
    }
    if (!publicKey || typeof publicKey !== "string") {
        throw new KeyManagerError("INVALID_PUBLIC_KEY", "publicKey is required");
    }

    const decoded = Buffer.from(publicKey, "base64");
    if (decoded.length !== FALCON512_PUBLIC_KEY_BYTES) {
        throw new KeyManagerError(
            "INVALID_PUBLIC_KEY",
            `Falcon-512 public key must decode to ${FALCON512_PUBLIC_KEY_BYTES} bytes`
        );
    }

    const keystore = readKeystoreIfExists();
    const now = new Date().toISOString();
    for (const key of keystore.keys) {
        if (
            key.status === "active" &&
            String(key.owner_type || "organization") === String(ownerType) &&
            String(key.owner_id || "default") === String(ownerId)
        ) {
            key.status = "retired";
            key.rotated_at = now;
        }
    }

    const entry = {
        key_id: newKeyId({ ownerType, ownerId }),
        algorithm,
        provider,
        status: "active",
        owner_type: ownerType,
        owner_id: String(ownerId),
        owner_name: ownerName || String(ownerId),
        public_key: publicKey,
        private_key_ref: "external",
        valid_from: validFrom,
        valid_to: validTo,
        created_at: now,
    };
    keystore.keys.push(entry);
    writeKeystore(keystore);

    safeAuditKeyAccess({
        keyId: entry.key_id,
        actor: "system",
        ipAddress: null,
        accessType: "generate",
        result: "success",
    });

    return {
        ...toPublicMetadata(entry),
        public_key: entry.public_key,
    };
}

/**
 * Return public key material and metadata by key id. Never returns private key
 * material.
 *
 * @param {string} keyId
 * @returns {Promise<Object>}
 */
export async function getPublicKeyById(keyId) {
    const keystore = readKeystoreIfExists();
    const entry = keystore.keys.find((k) => k.key_id === keyId);
    if (!entry) {
        throw new KeyManagerError(
            "KEY_NOT_FOUND",
            `No key with key_id '${keyId}'`
        );
    }
    return {
        ...toPublicMetadata(entry),
        public_key: entry.public_key,
    };
}

/**
 * List public keys, optionally filtered by owner type/id.
 *
 * @param {{ ownerType?: string, ownerId?: string }} filter
 * @returns {Promise<Array<Object>>}
 */
export async function listPublicKeys({ ownerType = null, ownerId = null } = {}) {
    const keystore = readKeystoreIfExists();
    return keystore.keys
        .filter((entry) => !ownerType || String(entry.owner_type || "organization") === String(ownerType))
        .filter((entry) => !ownerId || String(entry.owner_id || "default") === String(ownerId))
        .map((entry) => ({
            ...toPublicMetadata(entry),
            public_key: entry.public_key,
        }));
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
            result: "fail",
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
            result: "fail",
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
            result: "fail",
            details: { reason: "KEY_NOT_FOUND" },
        });
        throw new KeyManagerError(
            "KEY_NOT_FOUND",
            `No key with key_id '${keyId}'`
        );
    }
    if (!entry.encrypted_private_key) {
        safeAuditKeyAccess({
            keyId,
            actor,
            ipAddress,
            accessType: "read_private",
            result: "fail",
            details: { reason: "PUBLIC_ONLY_KEY" },
        });
        throw new KeyManagerError(
            "PUBLIC_ONLY_KEY",
            `Key '${keyId}' is public-only; private signing must happen on the owner device`
        );
    }

    let plaintext;
    try {
        plaintext = decryptPrivateKey(entry.encrypted_private_key, INTERNAL_CRYPTO_SECRET);
    } catch (err) {
        safeAuditKeyAccess({
            keyId,
            actor,
            ipAddress,
            accessType: "read_private",
            result: "fail",
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
            k.status = "retired";
            k.rotated_at = rotatedAt;
        }
    }

    const previous = keystore.keys.find((k) => k.rotated_at === rotatedAt);
    const newEntry = await createKeyEntry(INTERNAL_CRYPTO_SECRET, {
        ownerType: previous?.owner_type || "organization",
        ownerId: previous?.owner_id || "default",
        ownerName: previous?.owner_name || "Default Public Service Authority",
    });
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
 * Revoke a key. Existing signatures can still be evaluated against the
 * signature timestamp by callers, but revoked keys are never selected for new
 * signing.
 *
 * @param {string} keyId
 * @param {{ reason?: string }} context
 * @returns {Promise<Object>}
 */
export async function revokeKey(keyId, context = {}) {
    const keystore = await ensureKeystoreInitialized();
    const entry = keystore.keys.find((k) => k.key_id === keyId);
    if (!entry) {
        throw new KeyManagerError(
            "KEY_NOT_FOUND",
            `No key with key_id '${keyId}'`
        );
    }
    entry.status = "revoked";
    entry.revoked_at = new Date().toISOString();
    entry.revocation_reason = context.reason || "revoked";
    writeKeystore(keystore);

    safeAuditKeyAccess({
        keyId,
        actor: context.actor || "system",
        ipAddress: context.ipAddress || null,
        accessType: "rotate",
        result: "success",
    });

    return toPublicMetadata(entry);
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
    const keystore = readKeystoreIfExists();
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
