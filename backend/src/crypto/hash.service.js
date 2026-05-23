import fs from "fs";
import fsPromises from "fs/promises";
import crypto from "crypto";

/**
 * SHA-256 hex output regex: 64 lowercase hexadecimal characters.
 * @type {RegExp}
 */
export const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Typed error for hash service failures so callers can branch on `code`
 * without parsing error messages.
 *
 * Codes:
 *  - FILE_NOT_FOUND        — path does not exist or cannot be accessed
 *  - EMPTY_FILE            — file exists but is 0 bytes
 *  - INVALID_PATH          — filePath is not a non-empty string
 *  - INVALID_BUFFER        — input is not a Buffer / Uint8Array
 *  - INVALID_TEXT          — input is not a string
 *  - INVALID_EXPECTED_HASH — expectedHash does not match SHA-256 hex format
 *  - HASH_READ_FAILED      — stream/IO error while hashing
 */
export class HashServiceError extends Error {
    constructor(message, code, cause = undefined) {
        super(message);
        this.name = "HashServiceError";
        this.code = code;
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}

const assertHexHash = (hash) => {
    if (typeof hash !== "string" || !HEX_SHA256_PATTERN.test(hash)) {
        throw new HashServiceError(
            "Hash must be a 64-character lowercase hexadecimal string",
            "INVALID_EXPECTED_HASH"
        );
    }
};

const assertNonEmptyPath = (filePath) => {
    if (typeof filePath !== "string" || filePath.length === 0) {
        throw new HashServiceError(
            "filePath must be a non-empty string",
            "INVALID_PATH"
        );
    }
};

/**
 * Compute SHA-256 hash of a file using a streamed read so the entire file
 * never has to live in memory. Suitable for PDFs >10MB.
 *
 * @param {string} filePath Absolute or relative path to the file to hash.
 * @returns {Promise<string>} 64-character lowercase hex digest.
 * @throws {HashServiceError} when the file is missing, empty, or unreadable.
 */
export const hashFile = async (filePath) => {
    assertNonEmptyPath(filePath);

    let stat;
    try {
        stat = await fsPromises.stat(filePath);
    } catch (error) {
        throw new HashServiceError(
            `File not found or inaccessible: ${filePath}`,
            "FILE_NOT_FOUND",
            error
        );
    }

    if (!stat.isFile()) {
        throw new HashServiceError(
            `Path is not a regular file: ${filePath}`,
            "FILE_NOT_FOUND"
        );
    }

    if (stat.size === 0) {
        throw new HashServiceError(
            `Cannot hash empty file: ${filePath}`,
            "EMPTY_FILE"
        );
    }

    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);

        stream.on("data", (chunk) => {
            hash.update(chunk);
        });

        stream.on("error", (error) => {
            reject(
                new HashServiceError(
                    `Failed to read file while hashing: ${filePath}`,
                    "HASH_READ_FAILED",
                    error
                )
            );
        });

        stream.on("end", () => {
            const digest = hash.digest("hex");
            resolve(digest);
        });
    });
};

/**
 * Compute SHA-256 hash of an in-memory buffer.
 *
 * @param {Buffer | Uint8Array} buffer Raw bytes to hash.
 * @returns {string} 64-character lowercase hex digest.
 * @throws {HashServiceError} when the input is not a Buffer/Uint8Array.
 */
export const hashBuffer = (buffer) => {
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
        throw new HashServiceError(
            "hashBuffer expects a Buffer or Uint8Array",
            "INVALID_BUFFER"
        );
    }

    return crypto.createHash("sha256").update(buffer).digest("hex");
};

/**
 * Compute SHA-256 hash of UTF-8 encoded text.
 *
 * @param {string} text UTF-8 text to hash.
 * @returns {string} 64-character lowercase hex digest.
 * @throws {HashServiceError} when the input is not a string.
 */
export const hashText = (text) => {
    if (typeof text !== "string") {
        throw new HashServiceError(
            "hashText expects a string",
            "INVALID_TEXT"
        );
    }

    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
};

/**
 * Verify the SHA-256 hash of a file matches an expected digest.
 *
 * Comparison is case-insensitive on the expected side (we lowercase it first)
 * but we still require the expected digest to match the hex format so we
 * never silently compare against malformed input.
 *
 * @param {string} filePath Path to the file to hash.
 * @param {string} expectedHash 64-character lowercase hex digest.
 * @returns {Promise<boolean>} True iff `hashFile(filePath) === expectedHash`.
 * @throws {HashServiceError} when the file or expected hash is invalid.
 */
export const verifyFileHash = async (filePath, expectedHash) => {
    if (typeof expectedHash !== "string") {
        throw new HashServiceError(
            "expectedHash must be a string",
            "INVALID_EXPECTED_HASH"
        );
    }

    const normalizedExpected = expectedHash.toLowerCase();
    assertHexHash(normalizedExpected);

    const actual = await hashFile(filePath);
    return actual === normalizedExpected;
};

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------
//
// `document.service1.js` (and other existing callers) import `sha256File` and
// `sha256Text` and rely on them being **synchronous** for the file variant.
// To preserve behaviour without breaking those callers we keep a synchronous
// `sha256File` implementation that uses `fs.readFileSync`, and re-expose
// `sha256Text` as a direct alias for `hashText`.
//
// New code should prefer `hashFile`, `hashBuffer`, `hashText`, and
// `verifyFileHash`.

/**
 * @deprecated Use `hashFile` (async, streamed) instead.
 *
 * Synchronous SHA-256 of a file. Kept for backward compatibility with
 * callers that expect a sync return value.
 *
 * @param {string} filePath
 * @returns {string} 64-character lowercase hex digest.
 * @throws {HashServiceError} when the file is missing or empty.
 */
export const sha256File = (filePath) => {
    assertNonEmptyPath(filePath);

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (error) {
        throw new HashServiceError(
            `File not found or inaccessible: ${filePath}`,
            "FILE_NOT_FOUND",
            error
        );
    }

    if (!stat.isFile()) {
        throw new HashServiceError(
            `Path is not a regular file: ${filePath}`,
            "FILE_NOT_FOUND"
        );
    }

    if (stat.size === 0) {
        throw new HashServiceError(
            `Cannot hash empty file: ${filePath}`,
            "EMPTY_FILE"
        );
    }

    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(fileBuffer).digest("hex");
};

/**
 * @deprecated Use `hashText` instead.
 * @param {string} value UTF-8 text.
 * @returns {string} 64-character lowercase hex digest.
 */
export const sha256Text = (value) => hashText(value);
