/**
 * server.js - Main application entry point.
 * Initializes Express, mounts middleware, routes, and starts listening.
 */
import "dotenv/config";
import fs from "fs";
import https from "https";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";

import app from "./app.js";
import { NETWORK_ZONES } from "./config/network.config.js";
import {
    attachNetworkZone,
    requireCryptoZoneAccess,
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

const PORT = process.env.PORT || 3000;
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH;
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH;

// CORS: whitelist allowed origins.
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map(o => o.trim())
    : [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://localhost:3000",
        "https://127.0.0.1:3000",
    ];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. server-to-server, curl).
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

// Create storage folders if they don't exist.
ensureStorageFolders();

// Seed default users (dev only).
await seedDefaultUsers();

// ===================== ROUTE MOUNTING =====================

// Global rate limiter for all API routes.
app.use("/api", globalLimiter);

// Authentication: register, login, user profile.
app.use("/api/auth", authLimiter, authRoutes);

// Public verification endpoints for QR/upload.
app.use("/api/public",
    verifyLimiter,
    attachNetworkZone(NETWORK_ZONES.PUBLIC),
    publicRoutes
);

// Application document management routes.
app.use("/api/app/documents",
    attachNetworkZone(NETWORK_ZONES.APPLICATION),
    documentRoutes
);

// Internal Falcon crypto service.
app.use(
    "/api/internal/crypto",
    attachNetworkZone(NETWORK_ZONES.CRYPTO),
    requireCryptoZoneAccess,
    cryptoRoutes
);

// Serve static frontend files.
const frontendPath = path.join(__dirname, "../../frontend");
app.use(express.static(frontendPath));

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

// 404 handler for unmatched API routes.
app.use("/api", notFoundHandler);

// Global error handler (must be last).
app.use(errorHandler);

if (HTTPS_KEY_PATH && HTTPS_CERT_PATH) {
    const httpsOptions = {
        key: fs.readFileSync(HTTPS_KEY_PATH),
        cert: fs.readFileSync(HTTPS_CERT_PATH),
    };

    https.createServer(httpsOptions, app).listen(PORT, () => {
        console.log(`Server running on https://localhost:${PORT}`);
    });
} else {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
