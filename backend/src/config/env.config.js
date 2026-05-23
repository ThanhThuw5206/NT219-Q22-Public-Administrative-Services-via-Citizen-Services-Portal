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

const INTERNAL_CRYPTO_SECRET =
    process.env.INTERNAL_CRYPTO_SECRET || "change-me-in-production";

const KEY_STORAGE_TYPE = process.env.KEY_STORAGE_TYPE || "file";

const PUBLIC_VERIFY_URL =
    process.env.PUBLIC_VERIFY_URL ||
    "http://localhost:3000/api/public/documents/verify";

/**
 * `true` when running outside of `production`. Useful for relaxing checks
 * (e.g. allowing the default crypto secret) in dev/test.
 */
const IS_DEV = NODE_ENV !== "production";

const env = Object.freeze({
    NODE_ENV,
    INTERNAL_CRYPTO_SECRET,
    KEY_STORAGE_TYPE,
    PUBLIC_VERIFY_URL,
    IS_DEV,
});

export {
    NODE_ENV,
    INTERNAL_CRYPTO_SECRET,
    KEY_STORAGE_TYPE,
    PUBLIC_VERIFY_URL,
    IS_DEV,
};

export default env;
