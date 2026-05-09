import { INTERNAL_CRYPTO_SECRET } from "../config/network.config.js";

export const attachNetworkZone = (zone) => {
    return (req, res, next) => {
        req.networkZone = zone;
        res.setHeader("X-Network-Zone", zone.code);
        next();
    };
};

export const requireCryptoZoneAccess = (req, res, next) => {
    const providedSecret = req.header("x-internal-crypto-secret");

    if (providedSecret !== INTERNAL_CRYPTO_SECRET) {
        return res.status(403).json({
            message: "Crypto Zone access denied",
            reason: "MISSING_OR_INVALID_INTERNAL_SECRET"
        });
    }

    next();
};

export const securityHeaders = (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
};
