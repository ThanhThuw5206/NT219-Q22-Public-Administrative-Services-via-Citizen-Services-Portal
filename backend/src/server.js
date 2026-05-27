import "dotenv/config";
import app from "./app.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
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
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors({
    origin: [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://localhost:3000"
    ]
}));
ensureStorageFolders();
await seedDefaultUsers();


const PORT = process.env.PORT || 3000;

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
//frontend routes
// Static frontend files. Document storage is intentionally not exposed
// directly; PDFs are served through authenticated/token-checked controllers.

// FRONTEND
const frontendPath = path.join(__dirname, "../../frontend");

app.use(express.static(frontendPath));

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
