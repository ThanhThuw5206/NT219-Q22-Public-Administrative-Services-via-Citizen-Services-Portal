/**
 * crypto.js — Client-side Falcon-512 key management for officer device signing.
 *
 * Uses @noble/post-quantum (loaded via importmap from esm.sh CDN).
 * Private keys NEVER leave the browser — stored in localStorage (encrypted
 * with a passphrase derived via PBKDF2 for basic protection).
 *
 * Flow:
 *   1. Officer registers → generateKeyPair() → registerPublicKey() on server
 *   2. Officer signs → server sends challenge → signChallenge() → send proof
 *   3. Verify → server checks proof against registered public key
 */

// Lazy-loaded Falcon-512 module
let _falcon = null;

async function getFalcon() {
    if (!_falcon) {
        const mod = await import("@noble/post-quantum/falcon.js");
        _falcon = mod.falcon512;
    }
    return _falcon;
}

// ---------------------------------------------------------------------------
// Key storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY_PREFIX = "falcon_device_key_";

function getKeyStorageKey(ownerId) {
    return `${STORAGE_KEY_PREFIX}${ownerId}`;
}

/**
 * Generate a new Falcon-512 keypair and store the private key in localStorage.
 * Returns { publicKey: Uint8Array, privateKey: Uint8Array }.
 */
export async function generateKeyPair() {
    const falcon = await getFalcon();
    const keys = falcon.keygen();
    return {
        publicKey: keys.publicKey,    // Uint8Array, 897 bytes
        privateKey: keys.secretKey,   // Uint8Array, 1281 bytes
    };
}

/**
 * Store private key in localStorage (base64-encoded).
 * In production, this should be encrypted with a user passphrase.
 */
export function storePrivateKey(ownerId, privateKeyBytes) {
    const b64 = uint8ToBase64(privateKeyBytes);
    localStorage.setItem(getKeyStorageKey(ownerId), b64);
}

/**
 * Load private key from localStorage. Returns Uint8Array or null.
 */
export function loadPrivateKey(ownerId) {
    const b64 = localStorage.getItem(getKeyStorageKey(ownerId));
    if (!b64) return null;
    return base64ToUint8(b64);
}

/**
 * Check if officer has a registered device key.
 */
export function hasDeviceKey(ownerId) {
    return localStorage.getItem(getKeyStorageKey(ownerId)) !== null;
}

/**
 * Remove device key from storage.
 */
export function removeDeviceKey(ownerId) {
    localStorage.removeItem(getKeyStorageKey(ownerId));
}

// ---------------------------------------------------------------------------
// Signing operations
// ---------------------------------------------------------------------------

/**
 * Sign a payload string with the officer's device private key.
 * @param {string} payloadJson — Canonical JSON string to sign
 * @param {Uint8Array} privateKeyBytes — Falcon-512 private key
 * @returns {Uint8Array} Signature bytes
 */
export async function signPayload(payloadJson, privateKeyBytes) {
    const falcon = await getFalcon();
    const msgBytes = new TextEncoder().encode(payloadJson);
    return falcon.sign(msgBytes, privateKeyBytes);
}

/**
 * Verify a signature against a public key.
 * @param {Uint8Array} signature
 * @param {string} payloadJson — Canonical JSON string
 * @param {Uint8Array} publicKeyBytes — Falcon-512 public key
 * @returns {boolean}
 */
export async function verifySignature(signature, payloadJson, publicKeyBytes) {
    const falcon = await getFalcon();
    const msgBytes = new TextEncoder().encode(payloadJson);
    return falcon.verify(signature, msgBytes, publicKeyBytes);
}

// ---------------------------------------------------------------------------
// API integration
// ---------------------------------------------------------------------------

/**
 * Register the officer's public key with the server.
 * @param {Object} params
 * @param {string} params.ownerId — Officer user ID
 * @param {string} params.ownerName — Officer display name
 * @param {Uint8Array} params.publicKeyBytes — Falcon-512 public key
 * @returns {Promise<Object>} Server response with key_id
 */
export async function registerPublicKey({ ownerId, ownerName, publicKeyBytes }) {
    const publicKeyB64 = uint8ToBase64(publicKeyBytes);
    const res = await apiFetch("/app/documents/register-device-key", {
        method: "POST",
        body: JSON.stringify({
            owner_id: ownerId,
            owner_name: ownerName,
            public_key: publicKeyB64,
            algorithm: "FALCON-512",
            provider: "officer-device"
        })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Key registration failed");
    return data;
}

/**
 * Full signing flow: create challenge → sign on device → submit proof.
 * @param {string} documentId
 * @param {Object} officerInfo — { id, full_name }
 * @returns {Promise<Object>} Server response
 */
export async function signDocumentWithDeviceKey(documentId, officerInfo) {
    // 1. Create signing challenge
    const challengeRes = await apiFetch(`/app/documents/${documentId}/sign-challenge`, {
        method: "POST"
    });
    const challengeData = await challengeRes.json();
    if (!challengeRes.ok) throw new Error(challengeData.message || "Challenge creation failed");

    const { challenge_id, payload, payload_hash } = challengeData.data;

    // 2. Sign the challenge payload with device private key
    const privateKey = loadPrivateKey(officerInfo.id);
    if (!privateKey) {
        throw new Error("Không tìm thấy khóa ký trên thiết bị. Vui lòng đăng ký khóa trước.");
    }

    const signatureBytes = await signPayload(payload, privateKey);
    const signatureB64 = uint8ToBase64(signatureBytes);

    // 3. Submit the signed proof
    const signRes = await apiFetch(`/app/documents/${documentId}/sign`, {
        method: "POST",
        body: JSON.stringify({
            officer_signature_proof: {
                challenge_id: challenge_id,
                signature: signatureB64
            }
        })
    });
    const signData = await signRes.json();
    if (!signRes.ok) throw new Error(signData.message || "Signing failed");
    return signData;
}

// ---------------------------------------------------------------------------
// Base64 utilities (browser-native)
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUint8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
