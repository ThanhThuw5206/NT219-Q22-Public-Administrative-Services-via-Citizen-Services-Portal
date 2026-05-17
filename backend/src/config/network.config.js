export const NETWORK_ZONES = {
    PUBLIC: {
        name: "Public Zone",
        code: "public",
        purpose: "External entrypoint for citizens and QR verification pages",
        path_prefixes: ["/api/public"]
    },
    APPLICATION: {
        name: "Application Zone",
        code: "application",
        purpose: "Business APIs behind the public gateway",
        path_prefixes: ["/api/app", "/api/documents"]
    },
    CRYPTO: {
        name: "Crypto Zone",
        code: "crypto",
        purpose: "Signature operations and key metadata access",
        path_prefixes: ["/api/internal/crypto"]
    },
    DATA: {
        name: "Data Zone",
        code: "data",
        purpose: "Document metadata, upload storage and audit records",
        path_prefixes: ["backend/src/data", "backend/src/uploads"]
    }
};

export const INTERNAL_CRYPTO_SECRET = process.env.INTERNAL_CRYPTO_SECRET || "change-this-crypto-zone-secret";
