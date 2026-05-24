import "dotenv/config";
import app from "./app.js";
import express from "express";
import path from "path";
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

ensureStorageFolders();
await seedDefaultUsers();

const PORT = 3000;

// Auth
app.use("/api/auth", authRoutes);

// API Routes
app.use("/api/public",
    attachNetworkZone(NETWORK_ZONES.PUBLIC),
    publicRoutes
);

app.use("/api/app/documents",
    attachNetworkZone(NETWORK_ZONES.APPLICATION),
    documentRoutes
);

app.use(
    "/api/internal/crypto",
    attachNetworkZone(NETWORK_ZONES.CRYPTO),
    requireCryptoZoneAccess,
    cryptoRoutes
);

// Static files
app.use("/storage", express.static(path.resolve("storage")));
app.use(express.static(path.resolve("../frontend")));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});