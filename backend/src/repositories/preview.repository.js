import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../data");
const dataFilePath = path.join(dataDirectory, "previews.json");

const isMySQL = DB_STORAGE_TYPE === "mysql";

// CHẾ ĐỘ FILE JSON
const jsonPreviewRepo = {
    readPreviews() {
        fs.mkdirSync(dataDirectory, { recursive: true });
        if (!fs.existsSync(dataFilePath)) return [];
        return JSON.parse(fs.readFileSync(dataFilePath, "utf8"));
    },
    writePreviews(previews) {
        fs.mkdirSync(dataDirectory, { recursive: true });
        fs.writeFileSync(dataFilePath, JSON.stringify(previews, null, 2));
    },
    savePreview(preview) {
        const previews = this.readPreviews();
        previews.push(preview);
        this.writePreviews(previews);
        return preview;
    },
    findPreviewById(previewId) {
        const previews = this.readPreviews();
        return previews.find(p => p.preview_id === previewId) || null;
    }
};

// CHẾ ĐỘ MYSQL DATABASE
const mysqlPreviewRepo = {
    async savePreview(p) {
        const query = `
            INSERT INTO document_previews (preview_id, document_id, preview_url, document_folder, status, issued_at)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE document_id = ?, preview_url = ?, document_folder = ?, status = ?
        `;
        await db.query(query, [
            p.preview_id, p.document_id || null, p.preview_url || null, p.document_folder || null, p.status || 'pending',
            p.document_id || null, p.preview_url || null, p.document_folder || null, p.status || 'pending'
        ]);
        return p;
    },
    async findPreviewById(previewId) {
        const [rows] = await db.query("SELECT * FROM document_previews WHERE preview_id = ?", [previewId]);
        if (rows.length === 0) return null;
        return rows[0];
    }
};

export const savePreview = isMySQL ? mysqlPreviewRepo.savePreview : jsonPreviewRepo.savePreview;
export const findPreviewById = isMySQL ? mysqlPreviewRepo.findPreviewById : jsonPreviewRepo.findPreviewById;