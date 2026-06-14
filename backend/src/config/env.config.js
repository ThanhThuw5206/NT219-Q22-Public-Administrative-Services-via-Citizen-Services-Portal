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
 * Signing mode: "hsm" | "device"
 *
 * - "hsm" (default): Server acts as a simulated HSM.
 *   Officer authenticates via JWT, server holds personal keys in encrypted
 *   keystore and signs on officer's behalf. Identity binding comes from JWT
 *   + audit trail. Officer does NOT need a device key.
 *
 * - "device": Officer holds Falcon-512 private key on their device (browser).
 *   Server only stores the public key. Officer signs challenges client-side
 *   and sends proof to server. Strongest identity proof — private key never
 *   leaves the device.
 */
const SIGNING_MODE = process.env.SIGNING_MODE || "hsm";

// Derived from SIGNING_MODE for backward compatibility
const ALLOW_SERVER_SIDE_PERSONAL_KEYS =
    process.env.ALLOW_SERVER_SIDE_PERSONAL_KEYS !== undefined
        ? process.env.ALLOW_SERVER_SIDE_PERSONAL_KEYS === "true"
        : SIGNING_MODE === "hsm";

const REQUIRE_OFFICER_DEVICE_SIGNATURE =
    process.env.REQUIRE_OFFICER_DEVICE_SIGNATURE !== undefined
        ? process.env.REQUIRE_OFFICER_DEVICE_SIGNATURE === "true"
        : SIGNING_MODE === "device";

const ALLOW_FILE_ORGANIZATION_SEAL_IN_PRODUCTION =
    process.env.ALLOW_FILE_ORGANIZATION_SEAL_IN_PRODUCTION === "true";

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
        // In dev/test, use a stable fallback so the local encrypted keystore
        // remains readable across process restarts. Production still requires
        // explicit non-default secrets.
        return `dev-only-${name.toLowerCase()}-local-secret`;
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
    SIGNING_MODE,
    ALLOW_SERVER_SIDE_PERSONAL_KEYS,
    REQUIRE_OFFICER_DEVICE_SIGNATURE,
    ALLOW_FILE_ORGANIZATION_SEAL_IN_PRODUCTION,
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
    SIGNING_MODE,
    ALLOW_SERVER_SIDE_PERSONAL_KEYS,
    REQUIRE_OFFICER_DEVICE_SIGNATURE,
    ALLOW_FILE_ORGANIZATION_SEAL_IN_PRODUCTION,
};

export default env;
