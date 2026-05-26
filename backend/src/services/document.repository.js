import fs from "fs";
import path from "path";
import db from "../config/db.js"; 
import { DB_STORAGE_TYPE } from "../config/env.config.js"; 

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
        // Đảm bảo qr_payload từ dạng chuỗi TEXT trong MySQL được parse ngược lại thành Object JSON
        if (doc.qr_payload && typeof doc.qr_payload === "string") {
            try { doc.qr_payload = JSON.parse(doc.qr_payload); } catch(e){}
        }
        return doc;
    },

    async saveDocument(doc) {
        const query = `
            INSERT INTO documents (
                document_id, owner_id, public_key_id, token_hash, status, 
                file_path, original_name, file_hash, original_file_hash, 
                algorithm, signature_provider, verify_url, qr_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await db.query(query, [
            doc.document_id,
            doc.owner_id,
            doc.public_key_id || null,
            doc.token_hash || null,
            doc.status || "submitted",
            doc.signed_pdf_path || doc.file_path || null,
            doc.original_name || null,
            doc.file_hash || null,
            doc.original_file_hash || null,
            doc.algorithm || null,
            doc.signature_provider || null,
            doc.verify_url || null,
            doc.qr_payload ? JSON.stringify(doc.qr_payload) : null // Chuyển Object thành chuỗi để lưu vào DB
        ]);
        return doc;
    },

    async updateDocument(documentId, updated) {
        const query = `
            UPDATE documents 
            SET status = ?, 
                signature = ?, 
                public_key_id = ?, 
                file_path = ?, 
                algorithm = ?,
                signature_provider = ?,
                qr_payload = ?,
                signed_at = NOW()
            WHERE document_id = ?
        `;
        await db.query(query, [
            updated.status,
            updated.signature || null,
            updated.public_key_id || null,
            updated.signed_pdf_path || updated.file_path || null,
            updated.algorithm || null,
            updated.signature_provider || null,
            updated.qr_payload ? JSON.stringify(updated.qr_payload) : null,
            documentId
        ]);
        return updated;
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