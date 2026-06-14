/**
 * network-zone.middleware.js - Gắn thông tin vùng mạng và bảo vệ zone nội bộ.
 * 4 vùng: PUBLIC, APPLICATION, CRYPTO, DATA
 */
import crypto from "crypto";
import { INTERNAL_CRYPTO_SECRET } from "../config/env.config.js";
import * as auditService from "../services/audit.service.js";

/** Gắn metadata vùng mạng vào request và set header X-Network-Zone */
export const attachNetworkZone = (zone) => {
    return (req, res, next) => {
        req.networkZone = zone;
        res.setHeader("X-Network-Zone", zone.code);
        next();
    };
};

/** Bảo vệ zone mã hóa: yêu cầu header x-internal-crypto-secret hợp lệ (timing-safe) */
export const requireCryptoZoneAccess = async (req, res, next) => {
    const providedSecret = req.header("x-internal-crypto-secret") || "";

    // Timing-safe comparison để chống timing attack
    const isValid = providedSecret.length === INTERNAL_CRYPTO_SECRET.length &&
        crypto.timingSafeEqual(
            Buffer.from(providedSecret),
            Buffer.from(INTERNAL_CRYPTO_SECRET)
        );

    if (!isValid) {
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

/** Thêm header bảo mật: chống sniffing, clickjacking, rò rỉ referrer */
export const securityHeaders = (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
};
