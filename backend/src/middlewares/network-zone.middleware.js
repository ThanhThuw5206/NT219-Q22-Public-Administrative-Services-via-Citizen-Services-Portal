import { INTERNAL_CRYPTO_SECRET } from "../config/network.config.js";
import * as auditService from "../services/audit.service.js";

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
        // Audit log the denied access attempt (defensive — never crash on audit failure)
        try {
            if (typeof auditService.logKeyAccess === "function") {
                auditService.logKeyAccess({
                    keyId: null,
                    actor: req.ip,
                    ipAddress: req.ip,
                    accessType: "crypto_zone_access",
                    result: "denied",
                });
            } else if (typeof auditService.writeAuditLog === "function") {
                auditService.writeAuditLog({
                    action: "key_access",
                    documentId: null,
                    result: "denied",
                    actor: req.ip || "anonymous",
                    ipAddress: req.ip,
                    details: { reason: "MISSING_OR_INVALID_INTERNAL_SECRET" },
                });
            }
        } catch (_err) {
            // Audit MUST NOT block the rejection response. Intentionally swallow.
        }

        return res.status(401).json({
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
