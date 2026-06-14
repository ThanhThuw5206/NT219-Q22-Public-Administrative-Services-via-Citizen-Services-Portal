import fs from "fs";
import path from "path";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const toMySQL = (val) => {
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    const pad = n => String(n).padStart(2, "0");
    // Dùng local-time methods để khớp với timezone của MySQL server (UTC+7)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const jsonFilePath = path.resolve("src/data/documents.json");

// ==========================================
// THỰC THI BẰNG FILE JSON (Logic hiện tại của bạn bạn)
// ==========================================
const jsonRepo = {
    findDocumentById(documentId) {
        if (!fs.existsSync(jsonFilePath)) return null;
        const documents = JSON.parse(fs.readFileSync(jsonFilePath, "utf8") || "[]");
        return documents.find(doc => doc.document_id === documentId) || null;
    },

    saveDocument(documentData) {
        let documents = [];
        if (fs.existsSync(jsonFilePath)) {
            documents = JSON.parse(fs.readFileSync(jsonFilePath, "utf8") || "[]");
        }
        documents.push(documentData);
        fs.writeFileSync(jsonFilePath, JSON.stringify(documents, null, 2), "utf8");
        return documentData;
    },

    updateDocument(documentId, updatedData) {
        if (!fs.existsSync(jsonFilePath)) return null;
        let documents = JSON.parse(fs.readFileSync(jsonFilePath, "utf8") || "[]");
        const index = documents.findIndex(doc => doc.document_id === documentId);
        if (index !== -1) {
            documents[index] = { ...documents[index], ...updatedData };
            fs.writeFileSync(jsonFilePath, JSON.stringify(documents, null, 2), "utf8");
            return documents[index];
        }
        return null;
    },

    listDocuments() {
        if (!fs.existsSync(jsonFilePath)) return [];
        return JSON.parse(fs.readFileSync(jsonFilePath, "utf8") || "[]");
    }
};

// ==========================================
// THỰC THI BẰNG MYSQL (Phần database của bạn)
// ==========================================
const mysqlRepo = {
    async findDocumentById(documentId) {
        const [rows] = await db.query("SELECT * FROM documents WHERE document_id = ?", [documentId]);
        if (rows.length === 0) return null;

        const doc = rows[0];
        if (doc.qr_payload && typeof doc.qr_payload === "string") {
            try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e){}
        }
        // Parse signature_payload — handle double-stringify từ lúc lưu
        if (doc.signature_payload) {
            try {
                let sp = typeof doc.signature_payload === "string" ? JSON.parse(doc.signature_payload) : doc.signature_payload;
                if (typeof sp === "string") sp = JSON.parse(sp); // double-stringify fallback
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
            doc.document_id,
            doc.owner_id,
            doc.signature || null,
            doc.public_key_id || null,
            doc.public_key || null,
            doc.token_hash || null,
            doc.file_hash || null,
            doc.status || "submitted",
            doc.file_path || null,
            doc.original_name || null,
            doc.original_file_hash || null,
            doc.algorithm || null,
            doc.signature_provider || null,
            doc.verify_url || null,
            doc.qr_payload ? JSON.stringify(doc.qr_payload) : null
        ]);
        return doc;
    },

    async updateDocument(documentId, updated) {
        const fieldMap = {
            status: value => value,
            signature: value => value,
            public_key_id: value => value,
            public_key: value => value,
            signed_pdf_path: value => value,
            file_hash: value => value,
            signed_file_hash: value => value,
            token_hash: value => value,
            verify_url: value => value,
            signature_payload: value =>
                typeof value === "string" ? value : JSON.stringify(value),
            algorithm: value => value,
            signature_provider: value => value,
            qr_payload: value => JSON.stringify(value),
            signed_at: value => toMySQL(value),
            rejection_reason: value => value,
            rejected_at: value => toMySQL(value),
            signature_evidence_path: value => value
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
            await db.query(
                `UPDATE documents SET ${assignments.join(", ")} WHERE document_id = ?`,
                values
            );
        }
        // Trả về toàn bộ document sau khi cập nhật
        const [rows] = await db.query("SELECT * FROM documents WHERE document_id = ?", [documentId]);
        if (rows.length === 0) return null;
        const doc = rows[0];
        if (doc.qr_payload && typeof doc.qr_payload === "string") {
            try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e) {}
        }
        if (doc.signature_payload && typeof doc.signature_payload === "string") {
            try { doc.signature_payload = JSON.parse(doc.signature_payload); } catch(e) {}
        }
        return doc;
    },

    async listDocuments() {
        const [rows] = await db.query("SELECT * FROM documents");
        return rows.map(doc => {
            if (doc.qr_payload && typeof doc.qr_payload === "string") {
                try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e){}
            }
            return doc;
        });
    }
};

const isMySQL = DB_STORAGE_TYPE === "mysql";

// Xuất các hàm ra ngoài theo đúng cú pháp document.service1.js đang chờ import
export const findDocumentById = isMySQL ? mysqlRepo.findDocumentById : jsonRepo.findDocumentById;
export const saveDocument = isMySQL ? mysqlRepo.saveDocument : jsonRepo.saveDocument;
export const updateDocument = isMySQL ? mysqlRepo.updateDocument : jsonRepo.updateDocument;
export const listDocuments = isMySQL ? mysqlRepo.listDocuments : jsonRepo.listDocuments;
