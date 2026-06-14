import { NETWORK_ZONES } from "../config/network.config.js";
import { getActiveKey } from "../crypto/signature.service.js";
import { getPublicKeyById } from "../crypto/key-manager.service.js";

export const getNetworkModel = (req, res) => {
    res.json({
        model: "public-application-crypto-data-zones",
        zones: NETWORK_ZONES,
        request_zone: req.networkZone || null,
        rules: [
            "Public Zone only exposes QR/document verification entrypoints.",
            "Application Zone handles upload, document business flow and access control.",
            "Crypto Zone is internal-only and requires x-internal-crypto-secret.",
            "Data Zone is never exposed as an HTTP route."
        ]
    });
};

export const getCryptoPublicKey = async (req, res) => {
    try {
        const activeKey = await getActiveKey();

        res.json({
            key_id: activeKey.key_id,
            algorithm: activeKey.algorithm,
            provider: activeKey.provider,
            status: activeKey.status,
            public_key: activeKey.public_key,
            created_at: activeKey.created_at
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to load active signing key",
            reason: error.message
        });
    }
};

export const getPublicSigningKey = async (req, res) => {
    try {
        const key = await getPublicKeyById(req.params.keyId);
        res.json({
            key_id: key.key_id,
            algorithm: key.algorithm,
            provider: key.provider,
            status: key.status,
            owner_type: key.owner_type,
            owner_id: key.owner_id,
            owner_name: key.owner_name,
            valid_from: key.valid_from,
            valid_to: key.valid_to,
            public_key: key.public_key,
            created_at: key.created_at,
            rotated_at: key.rotated_at || null,
            revoked_at: key.revoked_at || null
        });
    } catch (error) {
        res.status(404).json({
            message: "Signing key not found",
            reason: error.message
        });
    }
};
