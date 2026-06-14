import { promises as fs } from "fs";
import path from "path";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const jsonFilePath = path.resolve("src/data/audit_logs.json");
const isMySQL = DB_STORAGE_TYPE === "mysql";

async function ensureFile() {
    const dir = path.dirname(jsonFilePath);
    await fs.mkdir(dir, { recursive: true });
    try { await fs.access(jsonFilePath); } catch { await fs.writeFile(jsonFilePath, "[]", "utf8"); }
}

async function readLogs() {
    await ensureFile();
    try { return JSON.parse(await fs.readFile(jsonFilePath, "utf8") || "[]"); } catch { return []; }
}

async function writeLogs(logs) {
    await ensureFile();
    await fs.writeFile(jsonFilePath, JSON.stringify(logs, null, 2), "utf8");
}

const VALID_TABLES = new Set(["audit_logs"]);
const LOG_TABLE_NAME = VALID_TABLES.has(process.env.AUDIT_TABLE) ? process.env.AUDIT_TABLE : "audit_logs";

const VALID_ACTIONS = new Set([
    "submit", "preview", "sign", "verify", "download", "login", "logout",
    "key_access", "key_generate", "key_rotate", "key_revoke", "reject"
]);

export const writeAuditLog = async ({ action, documentId = null, result, userId = null, ipAddress = null }) => {
    const safeAction = VALID_ACTIONS.has(action) ? action : "key_access";
    const entry = { user_id: userId, action: safeAction, document_id: documentId, ip_address: ipAddress, result, created_at: new Date().toISOString() };
    try {
        if (isMySQL) {
            await db.query(`INSERT INTO ${LOG_TABLE_NAME} (user_id, action, document_id, ip_address, result) VALUES (?, ?, ?, ?, ?)`,
                [entry.user_id, entry.action, entry.document_id, entry.ip_address, entry.result]);
        } else {
            const logs = await readLogs();
            logs.push(entry);
            await writeLogs(logs);
        }
    } catch (err) {
        console.warn("[audit] Failed to write audit log:", err.message);
    }
};

export const listAuditLogs = async () => {
    if (isMySQL) {
        const [rows] = await db.query(`SELECT * FROM ${LOG_TABLE_NAME} ORDER BY created_at DESC`);
        return rows.map(row => { if (row.details && typeof row.details === "string") { try { row.details = JSON.parse(row.details); } catch(e){} } return row; });
    }
    return readLogs();
};

export const logKeyAccess = async ({ userId, ipAddress, result }) => {
    return writeAuditLog({ action: "key_access", documentId: null, result, userId, ipAddress });
};
