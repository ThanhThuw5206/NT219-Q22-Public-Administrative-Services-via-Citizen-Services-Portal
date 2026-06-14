import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../data");
const dataFilePath = path.join(dataDirectory, "previews.json");
const isMySQL = DB_STORAGE_TYPE === "mysql";

async function readPreviews() {
    await fs.mkdir(dataDirectory, { recursive: true });
    try { return JSON.parse(await fs.readFile(dataFilePath, "utf8")); } catch { return []; }
}

async function writePreviews(previews) {
    await fs.mkdir(dataDirectory, { recursive: true });
    await fs.writeFile(dataFilePath, JSON.stringify(previews, null, 2));
}

const jsonPreviewRepo = {
    async savePreview(preview) {
        const previews = await readPreviews();
        previews.push(preview);
        await writePreviews(previews);
        return preview;
    },
    async findPreviewById(previewId) {
        const previews = await readPreviews();
        return previews.find(p => p.preview_id === previewId) || null;
    }
};

const mysqlPreviewRepo = {
    async savePreview(p) {
        const query = `INSERT INTO document_previews (preview_id, document_id, owner_id, preview_path, form_data, preview_url, document_folder, status, expired_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE document_id = ?, owner_id = ?, preview_path = ?, form_data = ?, preview_url = ?, document_folder = ?, status = ?, expired_at = ?`;
        await db.query(query, [p.preview_id, p.document_id||null, p.owner_id||null, p.preview_path||null, p.form_data?JSON.stringify(p.form_data):null, p.preview_url||null, p.document_folder||null, p.status||'preview', p.expired_at||null, p.document_id||null, p.owner_id||null, p.preview_path||null, p.form_data?JSON.stringify(p.form_data):null, p.preview_url||null, p.document_folder||null, p.status||'preview', p.expired_at||null]);
        return p;
    },
    async findPreviewById(previewId) {
        const [rows] = await db.query("SELECT * FROM document_previews WHERE preview_id = ?", [previewId]);
        return rows[0] || null;
    }
};

export const savePreview = isMySQL ? mysqlPreviewRepo.savePreview.bind(mysqlPreviewRepo) : jsonPreviewRepo.savePreview.bind(jsonPreviewRepo);
export const findPreviewById = isMySQL ? mysqlPreviewRepo.findPreviewById.bind(mysqlPreviewRepo) : jsonPreviewRepo.findPreviewById.bind(jsonPreviewRepo);
