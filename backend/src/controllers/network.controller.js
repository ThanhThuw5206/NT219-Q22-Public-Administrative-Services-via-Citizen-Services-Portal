import { NETWORK_ZONES } from "../config/network.config.js";
import { getActiveKey } from "../crypto/signature.service.js";

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
