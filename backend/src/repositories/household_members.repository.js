import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const isMySQL = DB_STORAGE_TYPE === "mysql";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(__dirname, "../data");
const dataFilePath = path.join(dataDirectory, "household_members.json");

// ==========================================
// CHẾ ĐỘ FILE JSON
// ==========================================
const jsonRepo = {
    readAll() {
        fs.mkdirSync(dataDirectory, { recursive: true });
        if (!fs.existsSync(dataFilePath)) return [];
        return JSON.parse(fs.readFileSync(dataFilePath, "utf8"));
    },
    writeAll(members) {
        fs.mkdirSync(dataDirectory, { recursive: true });
        fs.writeFileSync(dataFilePath, JSON.stringify(members, null, 2));
    },
    async saveMembersForDocument(documentId, members) {
        if (!members || members.length === 0) return;
        const all = this.readAll();
        const maxId = all.length > 0 ? Math.max(...all.map(m => m.id)) : 0;
        const newMembers = members.map((m, idx) => ({
            id: maxId + idx + 1,
            document_id: documentId,
            full_name: m.full_name || "",
            birth_date: m.birth_date || null,
            gender: m.gender || "Nam",
            personal_id: m.personal_id || "",
            relationship_to_head: m.relationship_to_head || null
        }));
        all.push(...newMembers);
        this.writeAll(all);
    },
    async getMembersForDocument(documentId) {
        const all = this.readAll();
        return all
            .filter(m => m.document_id === documentId)
            .sort((a, b) => a.id - b.id);
    }
};

// ==========================================
// CHẾ ĐỘ DATABASE MYSQL
// ==========================================
const mysqlRepo = {
    async saveMembersForDocument(documentId, members) {
        if (!members || members.length === 0) return;
        const values = members.map(m => [
            documentId,
            m.full_name || "",
            m.birth_date || null,
            m.gender || "Nam",
            m.personal_id || "",
            m.relationship_to_head || null
        ]);
        await db.query(
            `INSERT INTO household_member_changes
                (document_id, full_name, birth_date, gender, personal_id, relationship_to_head)
             VALUES ?`,
            [values]
        );
    },
    async getMembersForDocument(documentId) {
        const [rows] = await db.query(
            "SELECT * FROM household_member_changes WHERE document_id = ? ORDER BY id ASC",
            [documentId]
        );
        return rows;
    }
};

// Xuất khẩu: tự động chọn chế độ JSON hoặc MySQL
const repo = isMySQL ? mysqlRepo : jsonRepo;
export const saveMembersForDocument = repo.saveMembersForDocument.bind(repo);
export const getMembersForDocument = repo.getMembersForDocument.bind(repo);
