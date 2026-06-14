/**
 * server.js - Main application entry point.
 * Initializes Express, mounts middleware, routes, and starts listening.
 */
import "dotenv/config";
import app from "./app.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { NETWORK_ZONES } from "./config/network.config.js";
import {
    attachNetworkZone,
    requireCryptoZoneAccess,
    securityHeaders,
} from "./middlewares/network-zone.middleware.js";

import authRoutes from "./routes/auth.routes.js";
import cryptoRoutes from "./routes/crypto.routes.js";
import documentRoutes from "./routes/document.routes.js";
import publicRoutes from "./routes/public.routes.js";
import { ensureStorageFolders } from "./utils/storage.util.js";
import { seedDefaultUsers } from "./services/auth.service.js";
import { globalLimiter, authLimiter, verifyLimiter } from "./middlewares/rate-limit.middleware.js";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.middleware.js";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS: whitelist allowed origins
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map(o => o.trim())
    : ["http://localhost:3000", "http://127.0.0.1:3000"];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. server-to-server, curl)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

// Create storage folders if they don't exist
ensureStorageFolders();

// Seed default users (dev only)
await seedDefaultUsers();

const PORT = process.env.PORT || 3000;

// ===================== ROUTE MOUNTING =====================

// Additional security headers
app.use(securityHeaders);

// Global rate limiter for all API routes
app.use("/api", globalLimiter);

// Xác thực: đăng ký, đăng nhập, thông tin người dùng (stricter rate limit)
app.use("/api/auth", authLimiter, authRoutes);

// Công khai: xác minh tài liệu qua QR/upload (không cần đăng nhập)
app.use("/api/public",
    verifyLimiter,
    attachNetworkZone(NETWORK_ZONES.PUBLIC),
    publicRoutes
);

// Ứng dụng: quản lý hồ sơ, ký số, tải file (cần JWT)
app.use("/api/app/documents",
    attachNetworkZone(NETWORK_ZONES.APPLICATION),
    documentRoutes
);

// Nội bộ: dịch vụ mã hóa Falcon-512 (cần secret header)
app.use(
    "/api/internal/crypto",
    attachNetworkZone(NETWORK_ZONES.CRYPTO),
    requireCryptoZoneAccess,
    cryptoRoutes
);

// Phục vụ file tĩnh frontend (HTML/CSS/JS)
const frontendPath = path.join(__dirname, "../../frontend");
app.use(express.static(frontendPath));

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

// 404 handler for unmatched API routes
app.use("/api", notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
