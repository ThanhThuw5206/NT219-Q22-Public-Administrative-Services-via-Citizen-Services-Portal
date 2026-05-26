import { INTERNAL_CRYPTO_SECRET } from "../config/env.config.js";
import * as auditService from "../services/audit.service.js";

export const attachNetworkZone = (zone) => {
    return (req, res, next) => {
        req.networkZone = zone;
        res.setHeader("X-Network-Zone", zone.code);
        next();
    };
};

// Tìm hàm requireCryptoZoneAccess và sửa lại như sau:
export const requireCryptoZoneAccess = async (req, res, next) => { // 1. THÊM TỪ KHÓA async TẠI ĐÂY
    const providedSecret = req.header("x-internal-crypto-secret");

    if (providedSecret !== INTERNAL_CRYPTO_SECRET) {
        try {
            if (typeof auditService.logKeyAccess === "function") {
                await auditService.logKeyAccess({ // 2. THÊM TỪ KHÓA await TẠI ĐÂY
                    keyId: null,
                    userId: null,
                    ipAddress: req.ip,
                    accessType: "crypto_zone_access",
                    result: "fail"
                });
            } else if (typeof auditService.writeAuditLog === "function") {
                await auditService.writeAuditLog({ // 3. THÊM TỪ KHÓA await TẠI ĐÂY
                    action: "key_access",
                    documentId: null,
                    result: "fail",
                    userId: null,
                    ipAddress: req.ip
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
