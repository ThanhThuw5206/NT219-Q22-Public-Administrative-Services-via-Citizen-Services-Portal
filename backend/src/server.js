/**
 * server.js - Điểm khởi động chính của ứng dụng
 * Khởi tạo Express, gắn middleware, mount routes và lắng nghe kết nối.
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
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cho phép truy cập từ frontend dev server và chính backend
app.use(cors({
    origin: true
}));

// Áp dụng header bảo mật cho mọi response
app.use(securityHeaders);

// Tạo thư mục storage nếu chưa có
ensureStorageFolders();

// Tạo tài khoản mặc định (officer, admin) nếu database trống
await seedDefaultUsers();

const PORT = process.env.PORT || 3000;

// ===================== ROUTE MOUNTING =====================

// Xác thực: đăng ký, đăng nhập, thông tin người dùng
app.use("/api/auth", authRoutes);

// Công khai: xác minh tài liệu qua QR/upload (không cần đăng nhập)
app.use("/api/public",
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
