/**
 * Centralised environment configuration.
 *
 * Loads variables from `process.env` (populated by `dotenv/config` in
 * `server.js`) and re-exports them with sensible development defaults so the
 * rest of the codebase never has to read `process.env` directly.
 *
 * Defaults are tuned for local development only — production deployments
 * MUST override `INTERNAL_CRYPTO_SECRET`, `PUBLIC_VERIFY_URL`, and any
 * storage-type values via real environment variables.
 *
 * Related: Requirements 15.1.
 */

const NODE_ENV = process.env.NODE_ENV || "development";

const INTERNAL_CRYPTO_SECRET = process.env.INTERNAL_CRYPTO_SECRET || "";

const KEY_STORAGE_TYPE = process.env.KEY_STORAGE_TYPE || "file";

const PUBLIC_VERIFY_URL =
    process.env.PUBLIC_VERIFY_URL ||
    "http://localhost:3000/api/public/documents/verify";

const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

const DB_STORAGE_TYPE = process.env.DB_STORAGE_TYPE || "json";

/**
 * `true` when running outside of `production`. Useful for relaxing checks
 * (e.g. allowing the default crypto secret) in dev/test.
 */
const IS_DEV = NODE_ENV !== "production";

// --- Startup validation ---
const DEFAULT_SECRETS = [
    "change-me-in-production",
    "change-me-in-production-jwt-secret",
    "secret",
    "password",
    "123456",
];

function validateSecret(name, value) {
    if (!value) {
        if (!IS_DEV) {
            throw new Error(`[env] ${name} must be set in production (NODE_ENV=production)`);
        }
        // In dev, generate a random fallback so the app still boots
        return `dev-only-${name.toLowerCase()}-${Date.now()}`;
    }
    if (!IS_DEV && DEFAULT_SECRETS.includes(value.toLowerCase())) {
        throw new Error(
            `[env] ${name} must not use a default/weak secret in production. ` +
            `Current value is in the blocklist.`
        );
    }
    return value;
}

const resolvedCryptoSecret = validateSecret("INTERNAL_CRYPTO_SECRET", INTERNAL_CRYPTO_SECRET);
const resolvedJwtSecret = validateSecret("JWT_SECRET", JWT_SECRET);

const env = Object.freeze({
    NODE_ENV,
    INTERNAL_CRYPTO_SECRET: resolvedCryptoSecret,
    KEY_STORAGE_TYPE,
    PUBLIC_VERIFY_URL,
    JWT_SECRET: resolvedJwtSecret,
    JWT_EXPIRES_IN,
    IS_DEV,
    DB_STORAGE_TYPE,
});

export {
    NODE_ENV,
    resolvedCryptoSecret as INTERNAL_CRYPTO_SECRET,
    KEY_STORAGE_TYPE,
    PUBLIC_VERIFY_URL,
    resolvedJwtSecret as JWT_SECRET,
    JWT_EXPIRES_IN,
    IS_DEV,
    DB_STORAGE_TYPE,
};

export default env;
