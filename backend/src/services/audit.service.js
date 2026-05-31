import fs from "fs";
import path from "path";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

// JSON file path for 'json' storage mode
const jsonFilePath = path.resolve("src/data/audit_logs.json");

// Ensure directory and file exist
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
// JSON FILE STORAGE
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
// MYSQL STORAGE
// ==========================================

// Whitelist of valid table names to prevent SQL injection
const VALID_TABLES = new Set(["audit_logs"]);
const LOG_TABLE_NAME = VALID_TABLES.has(process.env.AUDIT_TABLE)
    ? process.env.AUDIT_TABLE
    : "audit_logs";

const mysqlAudit = {
    async writeLog(entry) {
        // Table name is from whitelist — safe to interpolate
        const query = `
            INSERT INTO ${LOG_TABLE_NAME} (user_id, action, document_id, ip_address, result)
            VALUES (?, ?, ?, ?, ?)
        `;

        await db.query(query, [
            entry.user_id || null,
            entry.action,
            entry.document_id || null,
            entry.ip_address || null,
            entry.result
        ]);
        return entry;
    },

    async listLogs() {
        const query = `SELECT * FROM ${LOG_TABLE_NAME} ORDER BY created_at DESC`;
        const [rows] = await db.query(query);
        return rows.map(row => {
            if (row.details && typeof row.details === "string") {
                try { row.details = JSON.parse(row.details); } catch(e) {}
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
const VALID_ACTIONS = new Set(["submit", "sign", "verify", "download", "login", "logout", "key_access", "reject"]);

export const writeAuditLog = async ({ action, documentId = null, result, userId = null, ipAddress = null }) => {
    const safeAction = VALID_ACTIONS.has(action) ? action : "key_access";
    const entry = {
        user_id: userId,
        action: safeAction,
        document_id: documentId,
        ip_address: ipAddress,
        result,
        created_at: new Date().toISOString()
    };

    try {
        if (isMySQL) {
            return await mysqlAudit.writeLog(entry);
        } else {
            return jsonAudit.writeLog(entry);
        }
    } catch (err) {
        console.warn("[audit] Failed to write audit log:", err.message);
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
export const logKeyAccess = async ({ userId, ipAddress, result }) => {
    return await writeAuditLog({
        action: "key_access",
        documentId: null,
        result,
        userId,
        ipAddress
    });
};