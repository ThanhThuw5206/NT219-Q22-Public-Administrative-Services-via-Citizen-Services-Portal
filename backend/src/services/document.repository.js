import { promises as fs } from "fs";
import path from "path";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const toMySQL = (val) => {
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const jsonFilePath = path.resolve("src/data/documents.json");

async function ensureFile() {
    const dir = path.dirname(jsonFilePath);
    await fs.mkdir(dir, { recursive: true });
    try { await fs.access(jsonFilePath); } catch { await fs.writeFile(jsonFilePath, "[]", "utf8"); }
}

async function readAll() {
    await ensureFile();
    try { return JSON.parse(await fs.readFile(jsonFilePath, "utf8") || "[]"); } catch { return []; }
}

async function writeAll(docs) {
    await ensureFile();
    await fs.writeFile(jsonFilePath, JSON.stringify(docs, null, 2), "utf8");
}

// ==========================================
// JSON FILE STORAGE
// ==========================================
const jsonRepo = {
    async findDocumentById(documentId) {
        const documents = await readAll();
        return documents.find(doc => doc.document_id === documentId) || null;
    },

    async saveDocument(documentData) {
        const documents = await readAll();
        documents.push(documentData);
        await writeAll(documents);
        return documentData;
    },

    async updateDocument(documentId, updatedData) {
        const documents = await readAll();
        const index = documents.findIndex(doc => doc.document_id === documentId);
        if (index === -1) return null;
        documents[index] = { ...documents[index], ...updatedData };
        await writeAll(documents);
        return documents[index];
    },

    async listDocuments() {
        return readAll();
    }
};

// ==========================================
// MYSQL STORAGE
// ==========================================
const mysqlRepo = {
    async findDocumentById(documentId) {
        const [rows] = await db.query("SELECT * FROM documents WHERE document_id = ?", [documentId]);
        if (rows.length === 0) return null;
        const doc = rows[0];
        if (doc.qr_payload && typeof doc.qr_payload === "string") {
            try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e){}
        }
        if (doc.signature_payload) {
            try {
                let sp = typeof doc.signature_payload === "string" ? JSON.parse(doc.signature_payload) : doc.signature_payload;
                if (typeof sp === "string") sp = JSON.parse(sp);
                doc.signature_payload = sp;
            } catch(e){}
        }
        return doc;
    },

    async saveDocument(doc) {
        const query = `
            INSERT INTO documents (
                document_id, owner_id, signature, public_key_id, public_key, token_hash, file_hash, status,
                file_path, original_name, original_file_hash,
                algorithm, signature_provider, verify_url, qr_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await db.query(query, [
            doc.document_id, doc.owner_id, doc.signature || null, doc.public_key_id || null,
            doc.public_key || null, doc.token_hash || null, doc.file_hash || null, doc.status || "submitted",
            doc.file_path || null, doc.original_name || null, doc.original_file_hash || null,
            doc.algorithm || null, doc.signature_provider || null, doc.verify_url || null,
            doc.qr_payload ? JSON.stringify(doc.qr_payload) : null
        ]);
        return doc;
    },

    async updateDocument(documentId, updated) {
        const fieldMap = {
            status: v => v, signature: v => v, public_key_id: v => v, public_key: v => v,
            signed_pdf_path: v => v, file_hash: v => v, signed_file_hash: v => v, token_hash: v => v,
            verify_url: v => v, algorithm: v => v, signature_provider: v => v,
            signature_payload: v => typeof v === "string" ? v : JSON.stringify(v),
            qr_payload: v => JSON.stringify(v),
            signed_at: v => toMySQL(v), rejection_reason: v => v, rejected_at: v => toMySQL(v),
            signature_evidence_path: v => v
        };
        const assignments = [];
        const values = [];
        for (const [field, transform] of Object.entries(fieldMap)) {
            if (Object.prototype.hasOwnProperty.call(updated, field)) {
                assignments.push(`${field} = ?`);
                values.push(transform(updated[field]));
            }
        }
        if (assignments.length > 0) {
            values.push(documentId);
            await db.query(`UPDATE documents SET ${assignments.join(", ")} WHERE document_id = ?`, values);
        }
        const [rows] = await db.query("SELECT * FROM documents WHERE document_id = ?", [documentId]);
        if (rows.length === 0) return null;
        const doc = rows[0];
        if (doc.qr_payload && typeof doc.qr_payload === "string") { try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e){} }
        if (doc.signature_payload && typeof doc.signature_payload === "string") { try { doc.signature_payload = JSON.parse(doc.signature_payload); } catch(e){} }
        return doc;
    },

    async listDocuments() {
        const [rows] = await db.query("SELECT * FROM documents");
        return rows.map(doc => {
            if (doc.qr_payload && typeof doc.qr_payload === "string") { try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e){} }
            return doc;
        });
    },

    async listDocumentsByStatus(status) {
        const [rows] = await db.query("SELECT * FROM documents WHERE status = ? ORDER BY created_at DESC", [status]);
        return rows.map(doc => {
            if (doc.qr_payload && typeof doc.qr_payload === "string") { try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e){} }
            return doc;
        });
    },

    async listDocumentsByOwner(ownerId) {
        const [rows] = await db.query("SELECT * FROM documents WHERE owner_id = ? ORDER BY created_at DESC", [ownerId]);
        return rows.map(doc => {
            if (doc.qr_payload && typeof doc.qr_payload === "string") { try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e){} }
            return doc;
        });
    }
};

const isMySQL = DB_STORAGE_TYPE === "mysql";

export const findDocumentById = isMySQL ? mysqlRepo.findDocumentById : jsonRepo.findDocumentById;
export const saveDocument = isMySQL ? mysqlRepo.saveDocument : jsonRepo.saveDocument;
export const updateDocument = isMySQL ? mysqlRepo.updateDocument : jsonRepo.updateDocument;
export const listDocuments = isMySQL ? mysqlRepo.listDocuments : jsonRepo.listDocuments;
export const listDocumentsByStatus = isMySQL ? mysqlRepo.listDocumentsByStatus : null;
export const listDocumentsByOwner = isMySQL ? mysqlRepo.listDocumentsByOwner : null;
