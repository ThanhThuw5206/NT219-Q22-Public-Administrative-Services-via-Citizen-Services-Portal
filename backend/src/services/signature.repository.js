import { promises as fs } from "fs";
import path from "path";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const jsonFilePath = path.resolve("src/data/document_signatures.json");
const isMySQL = DB_STORAGE_TYPE === "mysql";

async function ensureFile() {
    const dir = path.dirname(jsonFilePath);
    await fs.mkdir(dir, { recursive: true });
    try { await fs.access(jsonFilePath); } catch { await fs.writeFile(jsonFilePath, "[]", "utf8"); }
}

async function readJson() {
    await ensureFile();
    try { return JSON.parse(await fs.readFile(jsonFilePath, "utf8") || "[]"); } catch { return []; }
}

async function writeJson(rows) {
    await ensureFile();
    await fs.writeFile(jsonFilePath, JSON.stringify(rows, null, 2), "utf8");
}

const jsonRepo = {
    async createSignature(record) {
        const rows = await readJson();
        const saved = {
            signature_id: record.signature_id || `SIG-${Date.now()}-${rows.length + 1}`,
            signature_status: "active",
            created_at: new Date().toISOString(),
            ...record,
        };
        rows.push(saved);
        await writeJson(rows);
        return saved;
    },

    async getLatestSignatureByDocumentId(documentId, signatureType = null) {
        const rows = (await readJson())
            .filter((row) => row.document_id === documentId)
            .filter((row) => !signatureType || row.signature_type === signatureType)
            .sort((a, b) => new Date(b.signed_at || b.created_at) - new Date(a.signed_at || a.created_at));
        return rows[0] || null;
    },

    async listSignaturesByDocumentId(documentId) {
        return (await readJson())
            .filter((row) => row.document_id === documentId)
            .sort((a, b) => new Date(b.signed_at || b.created_at) - new Date(a.signed_at || a.created_at));
    },
};

const mysqlRepo = {
    async createSignature(record) {
        const query = `
            INSERT INTO document_signatures (
                document_id, file_hash, signature, algorithm, public_key_id,
                signed_at, signature_type, signature_payload_json, payload_hash,
                original_file_hash, signer_user_id, signer_full_name, signer_role,
                organization_id, organization_name, signing_ip, signing_reason,
                signature_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await db.query(query, [
            record.document_id, record.signed_file_hash || record.file_hash, record.signature_value || record.signature,
            record.algorithm, record.key_id || record.public_key_id,
            record.signed_at ? new Date(record.signed_at) : new Date(),
            record.signature_type || "organization_falcon", record.signature_payload_json, record.payload_hash,
            record.original_file_hash || null, record.signer_user_id || null, record.signer_full_name || null,
            record.signer_role || null, record.organization_id || null, record.organization_name || null,
            record.signing_ip || null, record.signing_reason || null, record.signature_status || "active",
        ]);
        return record;
    },

    async getLatestSignatureByDocumentId(documentId, signatureType = null) {
        const params = [documentId];
        let where = "document_id = ?";
        if (signatureType) { where += " AND signature_type = ?"; params.push(signatureType); }
        const [rows] = await db.query(`SELECT * FROM document_signatures WHERE ${where} ORDER BY signed_at DESC, id DESC LIMIT 1`, params);
        return rows[0] || null;
    },

    async listSignaturesByDocumentId(documentId) {
        const [rows] = await db.query("SELECT * FROM document_signatures WHERE document_id = ? ORDER BY signed_at DESC, id DESC", [documentId]);
        return rows;
    },
};

const repo = isMySQL ? mysqlRepo : jsonRepo;
export const createSignature = repo.createSignature.bind(repo);
export const getLatestSignatureByDocumentId = repo.getLatestSignatureByDocumentId.bind(repo);
export const listSignaturesByDocumentId = repo.listSignaturesByDocumentId.bind(repo);
