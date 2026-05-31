/**
 * migrate.js - Tự động khởi tạo và cập nhật schema MySQL khi server khởi động.
 *
 * Bước 1: Đọc DB/db.sql, tạo tất cả bảng nếu chưa tồn tại (IF NOT EXISTS).
 * Bước 2: Chạy các migration incremental để thêm cột / sửa ENUM.
 *
 * Idempotent: chạy nhiều lần không lỗi. Bỏ qua nếu DB_STORAGE_TYPE !== "mysql".
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// DB/db.sql nằm ở gốc project, 3 cấp trên migrate.js
const SCHEMA_PATH = path.resolve(__dirname, "../../../DB/db.sql");

// ---------------------------------------------------------------------------
// Bước 1 – Tạo bảng từ db.sql (idempotent)
// ---------------------------------------------------------------------------
async function runBaseSchema() {
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.warn("[migrate] Không tìm thấy DB/db.sql, bỏ qua base schema.");
        return;
    }

    let sql = fs.readFileSync(SCHEMA_PATH, "utf8");

    // Xóa comment dòng --
    sql = sql.replace(/--[^\n]*/g, "");

    // Đổi CREATE TABLE → CREATE TABLE IF NOT EXISTS (tránh lỗi khi bảng đã có)
    sql = sql.replace(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi,
                      "CREATE TABLE IF NOT EXISTS ");

    // Tách thành từng câu lệnh theo dấu ;
    const statements = sql
        .split(";")
        .map(s => s.trim())
        .filter(s => s.length > 0);

    for (const stmt of statements) {
        // Bỏ qua lệnh cấp database (đã kết nối sẵn đúng DB)
        if (/^(CREATE\s+DATABASE|USE\s)/i.test(stmt)) continue;

        // Bỏ qua ALTER TABLE trong db.sql (xử lý riêng ở bước 2)
        if (/^ALTER\s+TABLE/i.test(stmt)) continue;

        try {
            await db.query(stmt);
        } catch (err) {
            // Duplicate key name (index đã tồn tại) → bỏ qua
            if (err.errno === 1061 || err.message.includes("Duplicate key name")) continue;
            console.warn(`[migrate] ⚠ ${err.message.slice(0, 100)}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Bước 2 – Incremental migrations (thêm cột / sửa ENUM)
// ---------------------------------------------------------------------------
const migrations = [
    {
        name: "add_rejection_fields_to_documents",
        async run() {
            const [cols] = await db.query(`
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME   = 'documents'
                  AND COLUMN_NAME IN ('rejection_reason', 'rejected_at')
            `);
            const existing = new Set(cols.map(c => c.COLUMN_NAME));

            if (!existing.has("rejection_reason"))
                await db.query("ALTER TABLE documents ADD COLUMN rejection_reason TEXT NULL");
            if (!existing.has("rejected_at"))
                await db.query("ALTER TABLE documents ADD COLUMN rejected_at TIMESTAMP NULL");

            // MODIFY COLUMN ENUM an toàn khi chạy lại
            await db.query(`
                ALTER TABLE documents
                MODIFY COLUMN status
                    ENUM('submitted','issued','revoked','rejected') DEFAULT 'submitted'
            `);
        }
    },
    {
        name: "add_reject_action_to_audit_logs",
        async run() {
            await db.query(`
                ALTER TABLE audit_logs
                MODIFY COLUMN action
                    ENUM('submit','sign','verify','download','login','logout','key_access','reject') NOT NULL
            `);
        }
    }
];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export const runMigrations = async () => {
    if (DB_STORAGE_TYPE !== "mysql") return;

    console.log("[migrate] Khởi tạo schema và áp dụng migrations...");

    await runBaseSchema();
    console.log("[migrate] ✓ Base schema (tất cả bảng đã sẵn sàng)");

    for (const m of migrations) {
        try {
            await m.run();
            console.log(`[migrate] ✓ ${m.name}`);
        } catch (err) {
            console.error(`[migrate] ✗ ${m.name}: ${err.message}`);
            throw err;
        }
    }

    console.log("[migrate] Hoàn tất.");
};
