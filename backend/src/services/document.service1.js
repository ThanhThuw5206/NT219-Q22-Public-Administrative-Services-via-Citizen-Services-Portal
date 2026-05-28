/**
 * document.service1.js - Điều phối nghiệp vụ tài liệu
 * Xử lý toàn bộ vòng đời tài liệu: nộp hồ sơ → ký số → xác minh
 */
import crypto from "crypto";
import fs from "fs";
import { hashFile, hashText } from "../crypto/hash.service.js";
import { saveDocument, updateDocument, findDocumentById, listDocuments } from "./document.repository.js";
import { buildSignaturePayload, getActiveKey, signPayload, verifyPayloadSignature } from "../crypto/signature.service.js";
import { writeAuditLog } from "./audit.service.js";
import { getUserById } from "./auth.service.js";
import path from "path";
import fsExtra from "fs-extra";
import { createDocumentFolder } from "../utils/storage.util.js";
import { generateQrCode } from "./qr.service.js";
import { embedQrIntoPdf } from "./pdf.service.js";

/** Tạo mã hồ sơ duy nhất theo định dạng HS-{NĂM}-{8 ký tự UUID} */
const generateDocumentId = () => {
    return `HS-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
};

/** Tạo token xác minh ngẫu nhiên 32 bytes, mã hóa base64url */
const generateVerificationToken = () => {
    return crypto.randomBytes(32).toString("base64url");
};

/** Tạo URL xác minh công khai từ PUBLIC_VERIFY_URL trong .env */
const buildVerifyUrl = (documentId, token) => {
    const baseUrl = process.env.PUBLIC_VERIFY_URL || "http://localhost:3000/api/public/documents/verify";
    return `${baseUrl}/${documentId}?token=${token}`;
};

/**
 * Xử lý tài liệu trọn gói (legacy): nộp + ký số + sinh QR trong một bước.
 * Dùng cho flow officer upload trực tiếp qua POST /upload.
 * @param {Object} input - { filePath, documentId, originalName, ownerId, ipAddress }
 * @returns {Object} Thông tin tài liệu đã ký
 */
export const processDocument = async (input) => {
    const { filePath, documentId, originalName, ownerId, ipAddress } = input;

    const documentFolder = createDocumentFolder(documentId);
    const originalPdfPath = path.join(documentFolder, "original.pdf");

    await fsExtra.move(filePath, originalPdfPath, { overwrite: true });

    const fileHash = await hashFile(originalPdfPath);
    const activeKey = await getActiveKey();
    const issuedAt = new Date().toISOString();
    const token = generateVerificationToken();
    const verifyUrl = buildVerifyUrl(documentId, token);

    await saveDocument({
        document_id: documentId,
        owner_id: ownerId || "demo-citizen",
        original_name: originalName || "document.pdf",
        file_path: originalPdfPath,
        original_file_hash: fileHash,
        file_hash: fileHash,
        status: "submitted",
        created_at: issuedAt,
        signature: "",
        token_hash: "",
        public_key_id: 0,
        signed_at: null,
        signature_payload: null,
        signed_pdf_path: null,
        verify_url: null,
        qr_payload: null,
        algorithm: null,
        signature_provider: null
    });

    const qrPath = await generateQrCode({ documentId, verifyUrl, token, status: "issued", ownerName: "" });

    const signedPath = await embedQrIntoPdf({
        sourceFilePath: originalPdfPath,
        qrPath,
        outputFilePath: path.join(documentFolder, "signed.pdf"),
        metadata: { document_id: documentId, verify_url: verifyUrl, issued_at: issuedAt, status: "issued", owner_name: "" }
    });

    const signedHash = await hashFile(signedPath);

    const payload = buildSignaturePayload({
        documentId,
        fileHash: signedHash,
        issuedAt,
        keyId: activeKey.key_id,
        version: 1
    });

    const signature = await signPayload(payload);

    const saved = await updateDocument(documentId, {
        status: "issued",
        file_hash: signedHash,
        signed_pdf_path: signedPath,
        signature: signature.signature,
        signature_payload: payload,
        public_key_id: activeKey.key_id,
        token_hash: hashText(token),
        verify_url: verifyUrl,
        qr_payload: { document_id: documentId, verify_url: verifyUrl, token, status: "issued", owner_name: "" },
        signed_at: issuedAt
    });

    await writeAuditLog({
        action: "sign",
        documentId,
        userId: ownerId,
        ipAddress,
        result: "success"
    });

    return saved;
};

/**
 * Xác minh tính hợp lệ của tài liệu: kiểm tra token, hash file, chữ ký Falcon-512.
 * @param {Object} params - { documentId, token, filePath (tùy chọn), userId, ipAddress }
 * @returns {Object} Kết quả xác minh: valid, reason, hash_matched, signature_valid, ...
 */
export const verifyDocument = async ({ documentId, token, filePath = null, userId = null, ipAddress = null }) => {
    const document = await findDocumentById(documentId);

    if (!document) {
        await writeAuditLog({ action: "verify", documentId, userId, ipAddress, result: "fail" });
        return {
            valid: false,
            reason: "DOCUMENT_NOT_FOUND"
        };
    }

    if (document.token_hash !== hashText(token || "")) {
        await writeAuditLog({ action: "verify", documentId, userId, ipAddress, result: "fail" });
        return {
            valid: false,
            reason: "INVALID_TOKEN"
        };
    }

    if (document.status !== "issued") {
        await writeAuditLog({ action: "verify", documentId, userId, ipAddress, result: "fail" });
        return {
            valid: false,
            reason: "DOCUMENT_NOT_ACTIVE",
            status: document.status
        };
    }

    // Khi không có file upload → hash file thật trên đĩa để phát hiện giả mạo
    // Không được dùng document.file_hash để so sánh với chính nó (luôn khớp)
    let currentHash;
    if (filePath) {
        currentHash = await hashFile(filePath);
    } else if (document.signed_pdf_path && fs.existsSync(document.signed_pdf_path)) {
        currentHash = await hashFile(document.signed_pdf_path);
    } else {
        currentHash = document.file_hash;
    }
    const hashMatched = currentHash === document.file_hash;

    // Lấy issuedAt từ signature_payload đã lưu để giữ đúng precision (ms)
    // MySQL TIMESTAMP chỉ lưu đến giây → document.signed_at mất milliseconds
    const sp = document.signature_payload;
    const issuedAt = (sp && typeof sp === "object" ? sp.issued_at : null)
        || (document.signed_at instanceof Date
            ? document.signed_at.toISOString()
            : String(document.signed_at || ""));

    const payload = buildSignaturePayload({
        documentId,
        fileHash: currentHash,
        issuedAt,
        keyId: document.public_key_id,
        version: 1
    });
    const signatureValid = await verifyPayloadSignature({
        payload,
        signature: document.signature,
        publicKey: document.public_key
    });
    const valid = hashMatched && signatureValid;

    await writeAuditLog({
        action: "verify",
        documentId,
        userId,
        ipAddress,
        result: valid ? "success" : "fail"
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

/** Lấy thông tin chi tiết một tài liệu theo documentId, bao gồm tên người nộp */
export const getDocument = async (documentId) => {
    const document = await findDocumentById(documentId);

    if (!document) {
        return null;
    }

    // Tra cứu tên người nộp từ bảng users
    let owner_name = null;
    try {
        const owner = await getUserById(document.owner_id);
        if (owner) owner_name = owner.full_name;
    } catch (_) { /* bỏ qua nếu không tìm thấy */ }

    return {
        document_id: document.document_id,
        owner_id: document.owner_id,
        owner_name,
        original_name: document.original_name,
        file_hash: document.file_hash,
        hash: document.file_hash,
        file_path: document.signed_pdf_path || document.file_path,
        original_file_hash: document.original_file_hash || null,
        signature: document.signature || null,
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

/** Lấy danh sách tài liệu thuộc về một công dân cụ thể */
export const getDocumentsByOwner = async (ownerId) => {
    const allDocs = await listDocuments();
    const filteredDocs = allDocs.filter((doc) => doc.owner_id === ownerId);
    const docs = await Promise.all(filteredDocs.map((doc) => getDocument(doc.document_id)));
    docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return docs;
};

/** Lấy đường dẫn file PDF đã ký để tải xuống */
export const getSignedDocumentFile = async (documentId) => {
    const document = await findDocumentById(documentId);

    if (!document || !document.signed_pdf_path) {
        return null;
    }

    return {
        filePath: document.signed_pdf_path,
        fileName: `${document.document_id}-signed.pdf`
    };
};

// ---------------------------------------------------------------------------
// Quy trình Citizen - Officer
// ---------------------------------------------------------------------------

/**
 * Công dân nộp hồ sơ: lưu file PDF, tạo bản ghi trạng thái "submitted".
 * @param {Object} params - { documentId, filePath, originalName, ownerId, ipAddress }
 * @returns {Object} Thông tin hồ sơ đã nộp
 */
export const submitDocument = async ({ documentId, filePath, originalName, ownerId = "citizen", ipAddress = null }) => {
    const folder = createDocumentFolder(documentId);
    const originalPdfPath = path.join(folder, "original.pdf");

    await fsExtra.move(filePath, originalPdfPath, { overwrite: true });

    const originalFileHash = await hashFile(originalPdfPath);
    const createdAt = new Date().toISOString();
    const token = generateVerificationToken();
    const tokenHash = hashText(token);

    const record = {
        document_id: documentId,
        owner_id: ownerId,
        original_name: originalName,
        file_path: originalPdfPath,
        original_file_hash: originalFileHash,
        status: "submitted",
        created_at: createdAt,
        signature: "",
        file_hash: originalFileHash,
        token_hash: tokenHash,
        public_key_id: 0,
        signed_at: null,
        signature_payload: null,
        signed_pdf_path: null,
        verify_url: null,
        qr_payload: null,
        algorithm: null,
        signature_provider: null
    };

    const saved = await saveDocument(record);

    fs.writeFileSync(
        path.join(folder, "metadata.json"),
        JSON.stringify(saved, null, 2)
    );

    await writeAuditLog({
        action: "submit",
        documentId,
        userId: ownerId,
        ipAddress,
        result: "success"
    });

    return {
        document_id: saved.document_id,
        status: saved.status,
        created_at: saved.created_at
    };
};

/**
 * Cán bộ ký số hồ sơ: sinh QR, nhúng vào PDF, ký Falcon-512, chuyển trạng thái "issued".
 * @param {Object} params - { documentId, officerId, ipAddress }
 * @returns {Object} Thông tin tài liệu đã ký và phát hành
 */
export const signDocument = async ({ documentId, officerId = "officer", ipAddress = null }) => {
    const document = await findDocumentById(documentId);

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

    // Look up owner name for QR payload
    let ownerName = "";
    try {
        const owner = await getUserById(document.owner_id);
        if (owner) ownerName = owner.full_name;
    } catch (_) { /* ignore if not found */ }

    // 1. Generate QR
    const qrImagePath = await generateQrCode({ documentId, verifyUrl, token, status: "issued", ownerName });

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
            issued_at: issuedAt,
            status: "issued",
            owner_name: ownerName
        }
    });

    // 3. Hash signed PDF
    const fileHash = await hashFile(signedFilePath);

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
    const updated = await updateDocument(documentId, {
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
        token_hash: hashText(token),
        verify_url: verifyUrl,
        qr_payload: {
            document_id: documentId,
            verify_url: verifyUrl,
            token,
            status: "issued",
            owner_name: ownerName
        }
    });

    // 6. Update metadata.json
    fs.writeFileSync(
        path.join(documentFolder, "metadata.json"),
        JSON.stringify(updated, null, 2)
    );

    // 7. Audit
    await writeAuditLog({
        action: "sign",
        documentId,
        userId: officerId,
        ipAddress,
        result: "success"
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

/** Lấy toàn bộ danh sách tài liệu (dành cho officer/admin) */
export const getDocuments = async () => {
    const allDocs = await listDocuments();
    return Promise.all(
        allDocs.map((doc) => getDocument(doc.document_id))
    );
};

/** Lấy danh sách tài liệu theo trạng thái (submitted, issued, ...) */
export const getDocumentsByStatus = async (status) => {
    const allDocs = await listDocuments();
    const filteredDocs = allDocs.filter((doc) => doc.status === status);

    const docs = await Promise.all(
        filteredDocs.map((doc) => getDocument(doc.document_id))
    );

    // Sắp xếp mới nhất lên đầu
    const dateField = status === "issued" ? "signed_at" : "created_at";
    docs.sort((a, b) => new Date(b[dateField]) - new Date(a[dateField]));

    return docs;
};

/** Lấy đường dẫn file PDF (gốc hoặc đã ký) để tải xuống */
export const getDocumentFile = async (documentId) => {
    const document = await findDocumentById(documentId);
    if (!document) return null;

    const filePath = document.signed_pdf_path || document.file_path;
    if (!filePath) return null;

    const suffix = document.status === "issued" ? "signed" : "original";
    return {
        filePath,
        fileName: `${document.document_id}-${suffix}.pdf`
    };
};
