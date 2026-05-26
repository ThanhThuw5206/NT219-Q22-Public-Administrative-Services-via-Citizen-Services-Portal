import fs from "fs";
import path from "path";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

// Đường dẫn file JSON dùng để lưu log cố định khi chạy ở chế độ 'json'
const jsonFilePath = path.resolve("src/data/audit_logs.json");

// Hàm bổ trợ đảm bảo thư mục và file JSON luôn tồn tại
const ensureJsonFile = () => {
    const dir = path.dirname(jsonFilePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(jsonFilePath)) {
        fs.writeFileSync(jsonFilePath, "[]", "utf8");
    }
};

// ==========================================
// CHẾ ĐỘ LƯU TRỮ BẰNG FILE JSON (Persistence)
// ==========================================
const jsonAudit = {
    readLogs() {
        ensureJsonFile();
        try {
            return JSON.parse(fs.readFileSync(jsonFilePath, "utf8") || "[]");
        } catch (error) {
            return [];
        }
    },
    writeLog(entry) {
        ensureJsonFile();
        const logs = this.readLogs();
        logs.push(entry);
        fs.writeFileSync(jsonFilePath, JSON.stringify(logs, null, 2), "utf8");
        return entry;
    }
};

// ==========================================
// CHẾ ĐỘ LƯU TRỮ BẰNG DATABASE MYSQL
// ==========================================
// LƯU Ý: Bạn hãy kiểm tra lại bảng trong file db.sql của bạn tên là 'verification_logs' hay 'audit_logs' nhé!
const LOG_TABLE_NAME = "verification_logs"; 

const mysqlAudit = {
    async writeLog(entry) {
        const query = `
            INSERT INTO ${LOG_TABLE_NAME} (log_id, action, document_id, actor, ip_address, result, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        
        await db.query(query, [
            entry.log_id,
            entry.action,
            entry.document_id,
            entry.actor,
            entry.ip_address,
            entry.result,
            entry.details ? JSON.stringify(entry.details) : null
        ]);
        return entry;
    },

    async listLogs() {
        const query = `SELECT * FROM ${LOG_TABLE_NAME} ORDER BY created_at DESC`;
        const [rows] = await db.query(query);
        return rows.map(row => {
            // Khôi phục trường details từ chuỗi JSON trong DB thành Object
            if (row.details && typeof row.details === "string") {
                try { row.details = JSON.parse(row.details); } catch(e){}
            }
            return row;
        });
    }
};

const isMySQL = DB_STORAGE_TYPE === "mysql";

// ==========================================
// EXPORT CÁC HÀM SERVICE RA NGOÀI
// ==========================================

/**
 * Ghi nhận nhật ký hệ thống (Audit Log)
 */
export const writeAuditLog = async ({ action, documentId = null, result, actor = "anonymous", ipAddress = null, details = {} }) => {
    // Tạo mã log_id độc nhất không phụ thuộc vào độ dài mảng
    const logId = `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const entry = {
        log_id: logId,
        action,
        document_id: documentId,
        actor,
        ip_address: ipAddress,
        result,
        details,
        created_at: new Date().toISOString()
    };

    if (isMySQL) {
        return await mysqlAudit.writeLog(entry);
    } else {
        return jsonAudit.writeLog(entry);
    }
};

/**
 * Lấy toàn bộ danh sách nhật ký
 */
export const listAuditLogs = async () => {
    if (isMySQL) {
        return await mysqlAudit.listLogs();
    } else {
        return jsonAudit.readLogs();
    }
};

/**
 * Hàm bổ trợ logKeyAccess theo cấu trúc gọi của network-zone.middleware.js
 */
export const logKeyAccess = async ({ keyId, actor, ipAddress, accessType, result }) => {
    return await writeAuditLog({
        action: accessType || "crypto_zone_access",
        documentId: keyId,
        result,
        actor,
        ipAddress,
        details: { message: `Yêu cầu truy cập vùng Crypto: ${accessType}` }
    });
};