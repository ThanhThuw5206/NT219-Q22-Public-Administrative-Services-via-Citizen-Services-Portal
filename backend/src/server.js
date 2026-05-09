import "dotenv/config";
import express from "express";
import cors from "cors";
import { NETWORK_ZONES } from "./config/network.config.js";
import {
    attachNetworkZone,
    requireCryptoZoneAccess,
    securityHeaders
} from "./middlewares/network-zone.middleware.js";
import cryptoRoutes from "./routes/crypto.routes.js";
import documentRoutes from "./routes/document.routes.js";
import publicRoutes from "./routes/public.routes.js";

const app = express();

app.set("trust proxy", 1);
app.use(cors());
app.use(securityHeaders);
app.use(express.json());

app.use("/api/public", attachNetworkZone(NETWORK_ZONES.PUBLIC), publicRoutes);
app.use("/api/app/documents", attachNetworkZone(NETWORK_ZONES.APPLICATION), documentRoutes);
app.use("/api/documents", attachNetworkZone(NETWORK_ZONES.APPLICATION), documentRoutes);
app.use(
    "/api/internal/crypto",
    attachNetworkZone(NETWORK_ZONES.CRYPTO),
    requireCryptoZoneAccess,
    cryptoRoutes
);

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
