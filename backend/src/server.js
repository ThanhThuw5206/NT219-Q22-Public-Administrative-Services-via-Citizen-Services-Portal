import "dotenv/config";
import app from "./app.js";
import express from "express";
import path from "path";
import { NETWORK_ZONES } from "./config/network.config.js";
import {
    attachNetworkZone,
    requireCryptoZoneAccess,
} from "./middlewares/network-zone.middleware.js";

import cryptoRoutes from "./routes/crypto.routes.js";
import documentRoutes from "./routes/document.routes.js";
import publicRoutes from "./routes/public.routes.js";
//thêm mới so vs bản cũ
import { ensureStorageFolders } from "./utils/storage.util.js";

ensureStorageFolders();

const PORT = 3000;

// Routes
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

app.use(
    "/storage",
    express.static(path.resolve("storage"))
);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});