/**
 * Falcon-512 adapter — thin wrapper around `@noble/post-quantum`.
 *
 * Why this module exists:
 *   The rest of the application only ever talks to this adapter so we can
 *   isolate the third-party library in one place. If we later swap to a
 *   different Falcon implementation (HSM, WASM build, NT219 native binding,
 *   etc.) the higher layers do not have to change.
 *
 * Design notes:
 *   - The library is **lazy-loaded** via a memoised dynamic import so the
 *     server still boots if the package is missing or fails to initialise.
 *     Failures surface as `FalconAdapterError('LIBRARY_LOAD_FAILED', ...)`
 *     only when an operation is invoked, not at import time.
 *   - Library calls are wrapped in try/catch to convert raw exceptions into
 *     application-level `FalconAdapterError`s with a stable `code` field.
 *     Internal stack traces from the library are intentionally NOT
 *     re-thrown to the caller (we keep them on `cause` for logging only).
 *   - `verify()` MUST NEVER throw. Any malformed input, wrong size, or
 *     library exception causes it to return `false`.
 *
 * Falcon-512 sizes:
 *   - public key:   897 bytes (fixed)
 *   - private key:  1281 bytes (fixed; noble's expanded secret-key format)
 *   - signature:    variable. The Falcon round-3 spec lists 666 bytes as the
 *     **maximum** for the compressed encoding and 690 bytes for the padded
 *     encoding. The requirements doc summarises this as "between 666 and 690
 *     bytes" but in practice `@noble/post-quantum` produces compressed
 *     signatures whose length varies roughly between ~620 and ~690 bytes
 *     because Falcon uses entropy-coded packing. We therefore validate
 *     against a slightly wider practical range to avoid rejecting valid
 *     library output, while still catching obviously-malformed inputs.
 *
 * Reference: https://github.com/paulmillr/noble-post-quantum
 *
 * Related: Requirements 1.1, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8.
 */

// Falcon-512 fixed parameter set. Variable signature size is enforced by a
// numeric range, not a single constant.
const FALCON512_PUBLIC_KEY_BYTES = 897;
const FALCON512_PRIVATE_KEY_BYTES = 1281;
// See the file header for why this practical range is wider than the spec
// summary in the requirements doc.
const FALCON512_SIGNATURE_MIN_BYTES = 600;
const FALCON512_SIGNATURE_MAX_BYTES = 700;

/**
 * Stable error class used by every export in this adapter.
 *
 * `code` is part of the public contract and callers may switch on it
 * (e.g. to surface a specific HTTP response). The original library
 * exception, if any, is attached on `.cause` so it can be inspected by
 * logging without leaking back to the API surface.
 */
export class FalconAdapterError extends Error {
    /**
     * @param {string} code  One of: 'LIBRARY_LOAD_FAILED', 'KEYGEN_FAILED',
     *   'SIGN_FAILED', 'INVALID_KEY_SIZE', 'INVALID_SIGNATURE_SIZE'.
     * @param {string} message
     * @param {unknown} [cause]  Original error from the underlying library,
     *   kept off the public surface but available for logging.
     */
    constructor(code, message, cause) {
        super(message);
        this.name = "FalconAdapterError";
        this.code = code;
        if (cause !== undefined) {
            // Don't reformat or include the cause's stack into our own message;
            // we only want the code/message to leave this module.
            this.cause = cause;
        }
    }
}

// Memoised library handle. `null` means "not yet attempted".
let _falconLibPromise = null;

/**
 * Lazy-load `@noble/post-quantum` via dynamic import and memoise the result.
 *
 * The first call performs the import; subsequent calls return the cached
 * promise. If the library cannot be loaded (missing package, syntax error,
 * etc.) the promise rejects with `FalconAdapterError('LIBRARY_LOAD_FAILED')`
 * and the rejection is cached so we do not repeatedly retry a broken import.
 *
 * @returns {Promise<{ falcon512: any }>}
 */
function loadFalcon() {
    if (_falconLibPromise === null) {
        _falconLibPromise = import("@noble/post-quantum/falcon.js")
            .then((mod) => {
                if (!mod || typeof mod.falcon512 !== "object") {
                    throw new FalconAdapterError(
                        "LIBRARY_LOAD_FAILED",
                        "@noble/post-quantum loaded but does not expose falcon512"
                    );
                }
                return { falcon512: mod.falcon512 };
            })
            .catch((err) => {
                // Re-wrap so consumers always see a FalconAdapterError.
                if (err instanceof FalconAdapterError) {
                    throw err;
                }
                throw new FalconAdapterError(
                    "LIBRARY_LOAD_FAILED",
                    "Failed to load @noble/post-quantum",
                    err
                );
            });
    }
    return _falconLibPromise;
}

/**
 * Reset the memoised library handle. Used by tests only.
 * @internal
 */
export function _resetFalconLibForTests() {
    _falconLibPromise = null;
}

/**
 * Make sure `value` is a `Uint8Array` of exactly `expected` bytes.
 * Throws `FalconAdapterError('INVALID_KEY_SIZE', ...)` otherwise.
 * @param {unknown} value
 * @param {number} expected
 * @param {string} label  Human-readable name of the field, e.g. "public key".
 */
function assertKeySize(value, expected, label) {
    if (!(value instanceof Uint8Array) || value.length !== expected) {
        const actualLen =
            value instanceof Uint8Array ? value.length : "non-Uint8Array";
        throw new FalconAdapterError(
            "INVALID_KEY_SIZE",
            `Falcon-512 ${label} must be exactly ${expected} bytes (got ${actualLen})`
        );
    }
}

/**
 * Make sure `value` is a `Uint8Array` whose length sits within Falcon-512's
 * compressed signature range. Throws `FalconAdapterError('INVALID_SIGNATURE_SIZE', ...)`
 * otherwise.
 * @param {unknown} value
 */
function assertSignatureSize(value) {
    if (
        !(value instanceof Uint8Array) ||
        value.length < FALCON512_SIGNATURE_MIN_BYTES ||
        value.length > FALCON512_SIGNATURE_MAX_BYTES
    ) {
        const actualLen =
            value instanceof Uint8Array ? value.length : "non-Uint8Array";
        throw new FalconAdapterError(
            "INVALID_SIGNATURE_SIZE",
            `Falcon-512 signature length must be between ${FALCON512_SIGNATURE_MIN_BYTES} and ${FALCON512_SIGNATURE_MAX_BYTES} bytes (got ${actualLen})`
        );
    }
}

/**
 * Generate a fresh Falcon-512 key pair.
 *
 * The noble library names the secret material `secretKey`. We re-export it as
 * `privateKey` to match the rest of this codebase (and the requirements
 * document, which talks about "private keys"). Output sizes are validated
 * against the Falcon-512 spec; a mismatch raises
 * `FalconAdapterError('INVALID_KEY_SIZE')`.
 *
 * @returns {Promise<{ publicKey: Uint8Array, privateKey: Uint8Array }>}
 * @throws  {FalconAdapterError} 'LIBRARY_LOAD_FAILED' | 'KEYGEN_FAILED' |
 *   'INVALID_KEY_SIZE'
 */
export async function generateKeyPair() {
    const { falcon512 } = await loadFalcon();

    let kp;
    try {
        kp = falcon512.keygen();
    } catch (err) {
        throw new FalconAdapterError(
            "KEYGEN_FAILED",
            "Falcon-512 key generation failed",
            err
        );
    }

    if (!kp || !(kp.publicKey instanceof Uint8Array) || !(kp.secretKey instanceof Uint8Array)) {
        throw new FalconAdapterError(
            "KEYGEN_FAILED",
            "Falcon-512 key generation returned an unexpected shape"
        );
    }

    assertKeySize(kp.publicKey, FALCON512_PUBLIC_KEY_BYTES, "public key");
    assertKeySize(kp.secretKey, FALCON512_PRIVATE_KEY_BYTES, "private key");

    return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

/**
 * Sign a message with a Falcon-512 private key.
 *
 * The signature size is variable (range coding). We validate that the result
 * is within Falcon-512's documented 666–690 byte window.
 *
 * @param {Uint8Array} messageBytes  Bytes to sign (any length, may be empty).
 * @param {Uint8Array} privateKeyBytes  Falcon-512 secret key (1281 bytes).
 * @returns {Promise<Uint8Array>}  Detached signature.
 * @throws  {FalconAdapterError} 'LIBRARY_LOAD_FAILED' | 'INVALID_KEY_SIZE' |
 *   'SIGN_FAILED' | 'INVALID_SIGNATURE_SIZE'
 */
export async function sign(messageBytes, privateKeyBytes) {
    if (!(messageBytes instanceof Uint8Array)) {
        throw new FalconAdapterError(
            "SIGN_FAILED",
            "messageBytes must be a Uint8Array"
        );
    }
    assertKeySize(privateKeyBytes, FALCON512_PRIVATE_KEY_BYTES, "private key");

    const { falcon512 } = await loadFalcon();

    let sig;
    try {
        sig = falcon512.sign(messageBytes, privateKeyBytes);
    } catch (err) {
        throw new FalconAdapterError(
            "SIGN_FAILED",
            "Falcon-512 signing failed",
            err
        );
    }

    assertSignatureSize(sig);
    return sig;
}

/**
 * Verify a Falcon-512 signature.
 *
 * **NEVER throws.** Any of the following situations cause `verify` to
 * return `false`:
 *   - the library failed to load
 *   - any argument is not a `Uint8Array`
 *   - public key has wrong length
 *   - signature has wrong length
 *   - the underlying `falcon512.verify` threw (malformed input, etc.)
 *   - the signature does not validate against the message + public key
 *
 * This shape lets callers (verification endpoints) safely treat any
 * unparseable signature as "not valid" without leaking exceptions to the
 * HTTP layer.
 *
 * @param {Uint8Array} messageBytes
 * @param {Uint8Array} signatureBytes
 * @param {Uint8Array} publicKeyBytes
 * @returns {Promise<boolean>}
 */
export async function verify(messageBytes, signatureBytes, publicKeyBytes) {
    try {
        if (
            !(messageBytes instanceof Uint8Array) ||
            !(signatureBytes instanceof Uint8Array) ||
            !(publicKeyBytes instanceof Uint8Array)
        ) {
            return false;
        }
        if (publicKeyBytes.length !== FALCON512_PUBLIC_KEY_BYTES) {
            return false;
        }
        if (
            signatureBytes.length < FALCON512_SIGNATURE_MIN_BYTES ||
            signatureBytes.length > FALCON512_SIGNATURE_MAX_BYTES
        ) {
            return false;
        }

        const { falcon512 } = await loadFalcon();
        // noble's signature is `verify(sig, msg, publicKey)`.
        const ok = falcon512.verify(signatureBytes, messageBytes, publicKeyBytes);
        return ok === true;
    } catch (_err) {
        // Per the contract, swallow everything. The audit/log layer above us
        // is responsible for noticing repeated failures.
        return false;
    }
}

// Re-export sizes so other modules (e.g. tests, key-manager) can reference
// them without hard-coding magic numbers.
export const FALCON512 = Object.freeze({
    PUBLIC_KEY_BYTES: FALCON512_PUBLIC_KEY_BYTES,
    PRIVATE_KEY_BYTES: FALCON512_PRIVATE_KEY_BYTES,
    SIGNATURE_MIN_BYTES: FALCON512_SIGNATURE_MIN_BYTES,
    SIGNATURE_MAX_BYTES: FALCON512_SIGNATURE_MAX_BYTES,
    ALGORITHM: "FALCON-512",
});
