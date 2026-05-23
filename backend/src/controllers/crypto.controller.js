/**
 * Crypto Zone Controller — sign, verify, and public-key endpoints.
 *
 * All routes served by this controller live behind `requireCryptoZoneAccess`
 * (applied at the router mount in `server.js`), so authentication is already
 * enforced before any handler executes.
 *
 * Related: Requirements 9.4, 9.10, 12.11, 12.12, 12.13.
 */

import {
    buildSignaturePayload,
    signPayload,
    verifyPayloadSignature,
    getActiveKey,
} from "../crypto/signature.service.js";
import * as auditService from "../services/audit.service.js";

/**
 * Defensive audit helper — works regardless of which audit methods exist.
 */
function logAudit({ keyId, actor, ipAddress, accessType, result, details }) {
    if (typeof auditService.logKeyAccess === "function") {
        auditService.logKeyAccess({ keyId, actor, ipAddress, accessType, result, details });
    } else if (typeof auditService.writeAuditLog === "function") {
        auditService.writeAuditLog({
            action: `crypto.${accessType}`,
            documentId: null,
            result: result || "success",
            actor: actor || "internal",
            ipAddress,
            details: { keyId, accessType, ...details },
        });
    }
}

/**
 * POST /sign
 *
 * Accepts `{ payload }` where payload is an object with:
 *   { documentId, fileHash, issuedAt, keyId }
 *
 * Signs the canonical JSON with the active Falcon-512 key.
 *
 * Returns: { signature, key_id, algorithm, provider, signed_at }
 */
export const cryptoSign = async (req, res) => {
    try {
        const { payload } = req.body;

        if (!payload || typeof payload !== "object") {
            return res.status(400).json({
                message: "Request body must contain a 'payload' object with documentId, fileHash, issuedAt, keyId",
            });
        }

        const canonicalPayload = buildSignaturePayload(payload);
        const result = await signPayload(canonicalPayload);

        logAudit({
            keyId: result.key_id,
            actor: req.ip || "internal",
            ipAddress: req.ip,
            accessType: "sign",
            result: "success",
        });

        return res.json({
            signature: result.signature,
            key_id: result.key_id,
            algorithm: result.algorithm,
            provider: result.provider,
            signed_at: new Date().toISOString(),
        });
    } catch (error) {
        logAudit({
            keyId: null,
            actor: req.ip || "internal",
            ipAddress: req.ip,
            accessType: "sign",
            result: "error",
            details: { error: error.message },
        });

        return res.status(500).json({
            message: "Signing failed",
            reason: error.message,
        });
    }
};

/**
 * POST /verify
 *
 * Accepts `{ payload, signature, public_key }` — all strings:
 *   - payload: the canonical JSON string that was signed
 *   - signature: base64 encoded Falcon-512 signature
 *   - public_key: base64 encoded Falcon-512 public key (897 bytes)
 *
 * Returns: { valid: boolean }
 */
export const cryptoVerify = async (req, res) => {
    try {
        const { payload, signature, public_key } = req.body;

        if (!payload || !signature || !public_key) {
            return res.status(400).json({
                message: "Request body must contain 'payload' (string), 'signature' (base64), and 'public_key' (base64)",
            });
        }

        const valid = await verifyPayloadSignature({
            payload,
            signature,
            publicKey: public_key,
        });

        logAudit({
            keyId: null,
            actor: req.ip || "internal",
            ipAddress: req.ip,
            accessType: "verify",
            result: valid ? "valid" : "invalid",
        });

        return res.json({ valid });
    } catch (error) {
        logAudit({
            keyId: null,
            actor: req.ip || "internal",
            ipAddress: req.ip,
            accessType: "verify",
            result: "error",
            details: { error: error.message },
        });

        return res.status(500).json({
            message: "Verification failed",
            reason: error.message,
        });
    }
};

/**
 * GET /public-key
 *
 * Returns the active Falcon-512 public key metadata.
 * (Replaces the version in network.controller.js for this route file.)
 */
export const cryptoGetPublicKey = async (req, res) => {
    try {
        const activeKey = await getActiveKey();

        logAudit({
            keyId: activeKey.key_id,
            actor: req.ip || "internal",
            ipAddress: req.ip,
            accessType: "read_public",
            result: "success",
        });

        return res.json({
            key_id: activeKey.key_id,
            algorithm: activeKey.algorithm,
            provider: activeKey.provider,
            status: activeKey.status,
            public_key: activeKey.public_key,
            created_at: activeKey.created_at,
        });
    } catch (error) {
        return res.status(500).json({
            message: "Failed to load active signing key",
            reason: error.message,
        });
    }
};
