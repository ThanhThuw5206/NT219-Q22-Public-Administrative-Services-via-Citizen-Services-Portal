//orchestrator
import crypto from "crypto";
import fs from "fs";
import { sha256File, sha256Text } from "../crypto/hash.service.js";
import { saveDocument, updateDocument, findDocumentById, listDocuments } from "./document.repository.js";
import { buildSignaturePayload, getActiveKey, signPayload, verifyPayloadSignature } from "../crypto/signature.service.js";
import { writeAuditLog } from "./audit.service.js";
//thêm mới so vs bản cũ
import path from "path";
import fsExtra from "fs-extra";
import { createDocumentFolder } from "../utils/storage.util.js";
import { generateQrCode } from "./qr.service.js";
import { embedQrIntoPdf } from "./pdf.service.js";

const generateDocumentId = () => {
    return `HS-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
};

const generateVerificationToken = () => {
    return crypto.randomBytes(32).toString("base64url");
};

const buildVerifyUrl = (documentId, token) => {
    const baseUrl = process.env.PUBLIC_VERIFY_URL || "http://localhost:3000/api/public/documents/verify";
    return `${baseUrl}/${documentId}?token=${token}`;
};

export const processDocument = async (input) => {
    const {
        filePath,
        originalName,
        ownerId = "demo-citizen",
        ipAddress = null
    } = typeof input === "string" ? { filePath: input, originalName: input } : input;

    const documentId = input.documentId || generateDocumentId();
    //thêm mới so vs bản cũ (TẠO FOLDER RIÊNG)
    const documentFolder = createDocumentFolder(documentId);
    //. 
    const issuedAt = new Date().toISOString();
    const token = generateVerificationToken();
    const activeKey = await getActiveKey();
    const verifyUrl = buildVerifyUrl(documentId, token);
    //const originalFileHash = sha256File(filePath);
    //thay câu trên thành
    const originalPdfPath = path.join(
    documentFolder,
    "original.pdf"
);

await fsExtra.move(filePath, originalPdfPath, {
    overwrite: true
});

const originalFileHash = sha256File(originalPdfPath);
//. ĐỂ MOVE FILE GỐC

    const documentRecord = {
        document_id: documentId,
        owner_id: ownerId,
        original_name: originalName,
        //file_path: filePath,
        //thay câu trên thành
        file_path: originalPdfPath,
        //.
        original_file_hash: originalFileHash,
        algorithm: activeKey.algorithm,
        signature_provider: activeKey.provider,
        public_key_id: activeKey.key_id,
        public_key: activeKey.public_key,
        token_hash: sha256Text(token),
        verify_url: verifyUrl,
        qr_payload: {
            document_id: documentId,
            verify_url: verifyUrl,
            token
        },
        status: "issued",
        created_at: issuedAt,
        signed_at: issuedAt
    };

    // const signedFilePath = await createSignedPdf({
    //     sourceFilePath: filePath,
    //     documentRecord
    // });
    // documentRecord.signed_file_path = signedFilePath;
    // documentRecord.file_hash = sha256File(signedFilePath);
    //sửa đoạn trên thành
//1: GENERATE QR
const qrImagePath = await generateQrCode({
    documentId,
    verifyUrl,
    token
});

// EMBED QR INTO PDF
const signedFilePath = await embedQrIntoPdf({
    sourceFilePath: originalPdfPath,
    qrPath: qrImagePath,
    outputFilePath: path.join(
        documentFolder,
        "signed.pdf"
    ),
    metadata: {
        document_id: documentId,
        verify_url: verifyUrl,
        algorithm: activeKey.algorithm,
        key_id: activeKey.key_id,
        issued_at: issuedAt
    }
});

// HASH FINAL PDF
documentRecord.signed_pdf_path = signedFilePath;
documentRecord.file_hash = sha256File(signedFilePath);
//.

    const payload = buildSignaturePayload({
        documentId,
        fileHash: documentRecord.file_hash,
        issuedAt,
        keyId: activeKey.key_id,
        version: 1
    });
    const signatureInfo = await signPayload(payload);

    documentRecord.signature = signatureInfo.signature;
    documentRecord.signature_payload = payload;
    documentRecord.algorithm = signatureInfo.algorithm;
    documentRecord.signature_provider = signatureInfo.provider;
    documentRecord.public_key_id = signatureInfo.key_id;

    const savedDocument = saveDocument(documentRecord);
    //thêm mới so vs bản cũ (TẠO METADATA FILE CHO MỖI DOCUMENT)
    const metadataPath = path.join(
    documentFolder,
    "metadata.json"
    );

    fs.writeFileSync(
        metadataPath,
        JSON.stringify(savedDocument, null, 2)
    );
        
    writeAuditLog({
        action: "sign",
        documentId,
        actor: ownerId,
        ipAddress,
        result: "success",
        details: {
            algorithm: signatureInfo.algorithm,
            provider: signatureInfo.provider
        }
    });

    return {
        document_id: savedDocument.document_id,
        file_hash: savedDocument.file_hash,
        hash: savedDocument.file_hash,
        signature: savedDocument.signature,
        algorithm: savedDocument.algorithm,
        signature_provider: savedDocument.signature_provider,
        public_key_id: savedDocument.public_key_id,
        verify_url: savedDocument.verify_url,
        qr_payload: savedDocument.qr_payload,
        file_path: savedDocument.signed_pdf_path,
        signed_file: savedDocument.signed_pdf_path,
        original_file_hash: savedDocument.original_file_hash,
        signed_pdf_url: `/api/app/documents/${savedDocument.document_id}/signed-pdf`,
        status: savedDocument.status,
        signed_at: savedDocument.signed_at
    };
};

export const verifyDocument = async ({ documentId, token, filePath = null, actor = "anonymous", ipAddress = null }) => {
    const document = findDocumentById(documentId);

    if (!document) {
        writeAuditLog({ action: "verify", documentId, actor, ipAddress, result: "not_found" });
        return {
            valid: false,
            reason: "DOCUMENT_NOT_FOUND"
        };
    }

    if (document.token_hash !== sha256Text(token || "")) {
        writeAuditLog({ action: "verify", documentId, actor, ipAddress, result: "denied" });
        return {
            valid: false,
            reason: "INVALID_TOKEN"
        };
    }

    if (document.status !== "issued") {
        writeAuditLog({ action: "verify", documentId, actor, ipAddress, result: "revoked" });
        return {
            valid: false,
            reason: "DOCUMENT_NOT_ACTIVE",
            status: document.status
        };
    }

    const currentHash = filePath ? sha256File(filePath) : document.file_hash;
    const hashMatched = currentHash === document.file_hash;
    const payload = buildSignaturePayload({
        documentId,
        fileHash: currentHash,
        issuedAt: document.signed_at,
        keyId: document.public_key_id,
        version: 1
    });
    const signatureValid = await verifyPayloadSignature({
        payload,
        signature: document.signature,
        publicKey: document.public_key
    });
    const valid = hashMatched && signatureValid;

    writeAuditLog({
        action: "verify",
        documentId,
        actor,
        ipAddress,
        result: valid ? "success" : "failed",
        details: {
            hash_matched: hashMatched,
            signature_valid: signatureValid
        }
    });

    return {
        valid,
        reason: valid ? "VALID_DOCUMENT" : "TAMPERED_OR_INVALID_SIGNATURE",
        document_id: document.document_id,
        file_hash: document.file_hash,
        current_hash: currentHash,
        hash_matched: hashMatched,
        signature_valid: signatureValid,
        algorithm: document.algorithm,
        signature_provider: document.signature_provider,
        public_key_id: document.public_key_id,
        status: document.status,
        signed_at: document.signed_at
    };
};

export const getDocument = (documentId) => {
    const document = findDocumentById(documentId);

    if (!document) {
        return null;
    }

    return {
        document_id: document.document_id,
        owner_id: document.owner_id,
        original_name: document.original_name,
        file_hash: document.file_hash,
        hash: document.file_hash,
        file_path: document.signed_pdf_path || document.file_path,
        original_file_hash: document.original_file_hash || null,
        algorithm: document.algorithm,
        signature_provider: document.signature_provider,
        public_key_id: document.public_key_id,
        verify_url: document.verify_url,
        signed_pdf_url: document.signed_pdf_path ? `/api/app/documents/${document.document_id}/signed-pdf` : null,
        status: document.status,
        created_at: document.created_at,
        signed_at: document.signed_at
    };
};

export const getDocuments = () => {
    return listDocuments().map((document) => getDocument(document.document_id));
};

export const getDocumentsByOwner = (ownerId) => {
    return listDocuments()
        .filter((document) => String(document.owner_id) === String(ownerId))
        .map((document) => getDocument(document.document_id));
};

export const getSignedDocumentFile = (documentId) => {
    const document = findDocumentById(documentId);

    if (!document || !document.signed_pdf_path) {
        return null;
    }

    return {
        filePath: document.signed_pdf_path,
        fileName: `${document.document_id}-signed.pdf`
    };
};

// ---------------------------------------------------------------------------
// New: Citizen-Officer workflow
// ---------------------------------------------------------------------------

export const submitDocument = async ({ documentId, filePath, originalName, ownerId = "citizen", ipAddress = null }) => {
    const folder = createDocumentFolder(documentId);
    const originalPdfPath = path.join(folder, "original.pdf");

    await fsExtra.move(filePath, originalPdfPath, { overwrite: true });

    const originalFileHash = sha256File(originalPdfPath);
    const createdAt = new Date().toISOString();

    const record = {
        document_id: documentId,
        owner_id: ownerId,
        original_name: originalName,
        file_path: originalPdfPath,
        original_file_hash: originalFileHash,
        status: "submitted",
        created_at: createdAt,
        signed_at: null,
        signature: null,
        signature_payload: null,
        file_hash: null,
        signed_pdf_path: null,
        token_hash: null,
        verify_url: null,
        qr_payload: null,
        public_key: null,
        public_key_id: null,
        algorithm: null,
        signature_provider: null
    };

    const saved = saveDocument(record);

    fs.writeFileSync(
        path.join(folder, "metadata.json"),
        JSON.stringify(saved, null, 2)
    );

    writeAuditLog({
        action: "submit",
        documentId,
        actor: ownerId,
        ipAddress,
        result: "success",
        details: {}
    });

    return {
        document_id: saved.document_id,
        status: saved.status,
        created_at: saved.created_at
    };
};

export const signDocument = async ({ documentId, officerId = "officer", ipAddress = null }) => {
    const document = findDocumentById(documentId);

    if (!document) {
        throw new Error("Document not found");
    }

    if (document.status !== "submitted") {
        throw new Error(`Cannot sign document with status "${document.status}"`);
    }

    const documentFolder = createDocumentFolder(documentId);
    const issuedAt = new Date().toISOString();
    const activeKey = await getActiveKey();
    const token = generateVerificationToken();
    const verifyUrl = buildVerifyUrl(documentId, token);

    // 1. Generate QR
    const qrImagePath = await generateQrCode({ documentId, verifyUrl, token });

    // 2. Embed QR + metadata into original PDF → signed.pdf
    const signedFilePath = await embedQrIntoPdf({
        sourceFilePath: document.file_path,
        qrPath: qrImagePath,
        outputFilePath: path.join(documentFolder, "signed.pdf"),
        metadata: {
            document_id: documentId,
            verify_url: verifyUrl,
            algorithm: activeKey.algorithm,
            key_id: activeKey.key_id,
            issued_at: issuedAt
        }
    });

    // 3. Hash signed PDF
    const fileHash = sha256File(signedFilePath);

    // 4. Falcon-512 sign
    const payload = buildSignaturePayload({
        documentId,
        fileHash,
        issuedAt,
        keyId: activeKey.key_id,
        version: 1
    });
    const signatureInfo = await signPayload(payload);

    // 5. Update document record
    const updated = updateDocument(documentId, {
        status: "issued",
        signed_at: issuedAt,
        signed_pdf_path: signedFilePath,
        file_hash: fileHash,
        signature: signatureInfo.signature,
        signature_payload: payload,
        algorithm: signatureInfo.algorithm,
        signature_provider: signatureInfo.provider,
        public_key_id: signatureInfo.key_id,
        public_key: activeKey.public_key,
        token_hash: sha256Text(token),
        verify_url: verifyUrl,
        qr_payload: {
            document_id: documentId,
            verify_url: verifyUrl,
            token
        }
    });

    // 6. Update metadata.json
    fs.writeFileSync(
        path.join(documentFolder, "metadata.json"),
        JSON.stringify(updated, null, 2)
    );

    // 7. Audit
    writeAuditLog({
        action: "sign",
        documentId,
        actor: officerId,
        ipAddress,
        result: "success",
        details: {
            algorithm: signatureInfo.algorithm,
            provider: signatureInfo.provider
        }
    });

    return {
        document_id: updated.document_id,
        file_hash: updated.file_hash,
        hash: updated.file_hash,
        signature: updated.signature,
        algorithm: updated.algorithm,
        signature_provider: updated.signature_provider,
        public_key_id: updated.public_key_id,
        verify_url: updated.verify_url,
        qr_payload: updated.qr_payload,
        file_path: updated.signed_pdf_path,
        signed_file: updated.signed_pdf_path,
        original_file_hash: updated.original_file_hash,
        signed_pdf_url: `/api/app/documents/${updated.document_id}/signed-pdf`,
        status: updated.status,
        signed_at: updated.signed_at
    };
};

export const getDocumentsByStatus = (status) => {
    return listDocuments()
        .filter((doc) => doc.status === status)
        .map((doc) => getDocument(doc.document_id));
};

export const getDocumentFile = (documentId) => {
    const document = findDocumentById(documentId);
    if (!document) return null;

    const filePath = document.signed_pdf_path || document.file_path;
    if (!filePath) return null;

    const suffix = document.status === "issued" ? "signed" : "original";
    return {
        filePath,
        fileName: `${document.document_id}-${suffix}.pdf`
    };
};
