/**
 * document.service1.js - Điều phối nghiệp vụ tài liệu
 * Xử lý toàn bộ vòng đời tài liệu: nộp hồ sơ → ký số → xác minh
 */
import crypto from "crypto";
import { promises as fsPromises } from "fs";
import fs from "fs";
import { hashFile, hashText } from "../crypto/hash.service.js";
import { saveDocument, updateDocument, findDocumentById, listDocuments, listDocumentsByStatus, listDocumentsByOwner } from "./document.repository.js";
import { createSignature, getLatestSignatureByDocumentId, listSignaturesByDocumentId } from "./signature.repository.js";
import { createChallenge, findChallengeById, markChallengeUsed } from "./signing-challenge.repository.js";
import { buildSignaturePayload, getActiveKey, signPayload, signPayloadWithKey, verifyPayloadSignature } from "../crypto/signature.service.js";
import { getActivePublicKeyForOwner, getOrCreateActivePublicKeyForOwner, getPublicKeyById } from "../crypto/key-manager.service.js";
import { ALLOW_SERVER_SIDE_PERSONAL_KEYS, REQUIRE_OFFICER_DEVICE_SIGNATURE, SIGNING_MODE } from "../config/env.config.js";
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

const getCurrentOriginalFileHash = async (document) => {
    if (!document?.file_path) {
        throw new Error("Original PDF file path is missing");
    }

    const currentHash = await hashFile(document.file_path);
    const recordedHash = document.original_file_hash || document.file_hash || null;
    if (recordedHash && recordedHash !== currentHash) {
        throw new Error("Original PDF hash mismatch; document file may have changed after submission");
    }

    return currentHash;
};

const parseSignaturePayload = (payloadJson) => {
    try {
        return JSON.parse(payloadJson);
    } catch {
        throw new Error("Signing challenge payload is invalid");
    }
};

const DEFAULT_ORGANIZATION = {
    organization_id: process.env.DEFAULT_ORGANIZATION_ID || "PUBLIC-AUTHORITY-DEMO",
    name: process.env.DEFAULT_ORGANIZATION_NAME || "Demo Public Administrative Authority"
};

const normalizeRole = (roles = []) => {
    if (roles.includes("admin")) return "admin";
    if (roles.includes("officer")) return "officer";
    return roles[0] || "officer";
};

const resolveSignerContext = async (officerId) => {
    const officer = await getUserById(officerId);
    const roles = officer?.roles || ["officer"];
    return {
        signer: {
            user_id: String(officer?.id || officerId || "officer"),
            full_name: officer?.full_name || "Authorized Officer",
            role: normalizeRole(roles)
        },
        organization: DEFAULT_ORGANIZATION
    };
};

const getOfficerPersonalKey = async (signer) => {
    if (!ALLOW_SERVER_SIDE_PERSONAL_KEYS) {
        return getActivePublicKeyForOwner({
            ownerType: "user",
            ownerId: signer.user_id
        });
    }
    return getOrCreateActivePublicKeyForOwner({
        ownerType: "user",
        ownerId: signer.user_id,
        ownerName: signer.full_name
    });
};

const normalizeSignatureRecord = (record) => {
    if (!record) return null;
    const payloadJson = record.signature_payload_json || record.signature_payload;
    let payload = null;
    if (payloadJson) {
        try {
            payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
        } catch {
            payload = null;
        }
    }
    return {
        signature_id: record.signature_id || record.id || null,
        signature_type: record.signature_type || "organization_falcon",
        signature_value: record.signature_value || record.signature,
        signature_payload_json: typeof payloadJson === "string" ? payloadJson : JSON.stringify(payloadJson || {}),
        signature_payload: payload,
        payload_hash: record.payload_hash || null,
        signed_file_hash: record.signed_file_hash || record.file_hash,
        original_file_hash: record.original_file_hash || null,
        algorithm: record.algorithm || "FALCON-512",
        key_id: record.key_id || record.public_key_id,
        public_key: record.public_key || null,
        signer: {
            user_id: String(record.signer_user_id || payload?.signer?.user_id || ""),
            full_name: record.signer_full_name || payload?.signer?.full_name || "",
            role: record.signer_role || payload?.signer?.role || ""
        },
        organization: {
            organization_id: record.organization_id || payload?.organization?.organization_id || "",
            name: record.organization_name || payload?.organization?.name || ""
        },
        signed_at: record.signed_at,
        signing_reason: record.signing_reason || payload?.purpose || null,
        signature_status: record.signature_status || "active"
    };
};

const createFalconSignatureRecord = async ({
    document,
    signedFileHash,
    issuedAt,
    activeKey,
    signatureInfo,
    payload,
    signer,
    organization,
    ipAddress,
    reason = "Issue public administrative document",
    signatureType = "organization_falcon",
}) => {
    return createSignature({
        document_id: document.document_id,
        signature_type: signatureType,
        signature_value: signatureInfo.signature,
        signature_payload_json: payload,
        payload_hash: hashText(payload),
        signed_file_hash: signedFileHash,
        file_hash: signedFileHash,
        original_file_hash: document.original_file_hash || null,
        algorithm: signatureInfo.algorithm,
        key_id: signatureInfo.key_id,
        public_key_id: signatureInfo.key_id,
        public_key: activeKey.public_key,
        signer_user_id: signer.user_id,
        signer_full_name: signer.full_name,
        signer_role: signer.role,
        organization_id: organization.organization_id,
        organization_name: organization.name,
        signed_at: issuedAt,
        signing_ip: ipAddress,
        signing_reason: reason,
        signature_status: "active"
    });
};

const writeSignatureEvidenceFile = async (documentFolder, evidence) => {
    const evidencePath = path.join(documentFolder, "signature-evidence.json");
    await fsPromises.writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    return evidencePath;
};

const listSignatureSummaries = async (documentId) => {
    try {
        const records = await listSignaturesByDocumentId(documentId);
        return records.map((record) => {
            const normalized = normalizeSignatureRecord(record);
            return {
                signature_id: normalized.signature_id,
                signature_type: normalized.signature_type,
                key_id: normalized.key_id,
                algorithm: normalized.algorithm,
                signer: normalized.signer,
                organization: normalized.organization,
                signed_at: normalized.signed_at,
                signing_reason: normalized.signing_reason,
                signature_status: normalized.signature_status,
                signed_file_hash: normalized.signed_file_hash
            };
        });
    } catch {
        return [];
    }
};

const verifySignatureRecord = async ({ record, currentSignedHash, originalHash }) => {
    const normalized = normalizeSignatureRecord(record);
    let publicKey = normalized.public_key;
    let publicKeyStatus = "unknown";
    try {
        const key = await getPublicKeyById(normalized.key_id);
        publicKey = key.public_key;
        publicKeyStatus = key.status;
    } catch {
        publicKeyStatus = publicKey ? "snapshot" : "missing";
    }

    const expectedHash = normalized.signed_file_hash;
    const comparisonHash = normalized.signature_type === "officer_personal_falcon"
        ? originalHash
        : currentSignedHash;
    const hashMatched = expectedHash ? comparisonHash === expectedHash : false;
    const signatureValid = await verifyPayloadSignature({
        payload: normalized.signature_payload_json,
        signature: normalized.signature_value,
        publicKey
    });

    return {
        signature_id: normalized.signature_id,
        signature_type: normalized.signature_type,
        key_id: normalized.key_id,
        algorithm: normalized.algorithm,
        signer: normalized.signer,
        organization: normalized.organization,
        signed_at: normalized.signed_at,
        signing_reason: normalized.signing_reason,
        signature_status: normalized.signature_status,
        signed_file_hash: expectedHash,
        current_hash: comparisonHash,
        hash_matched: hashMatched,
        signature_valid: signatureValid,
        valid: hashMatched && signatureValid && normalized.signature_status === "active",
        public_key_status: publicKeyStatus
    };
};

const verifyAllSignatureRecords = async ({ documentId, currentSignedHash, originalHash }) => {
    const records = await listSignaturesByDocumentId(documentId);
    const verified = [];
    for (const record of records) {
        verified.push(await verifySignatureRecord({ record, currentSignedHash, originalHash }));
    }
    return verified;
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
    const { signer, organization } = await resolveSignerContext(ownerId || "officer");

    const submitted = await saveDocument({
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
        documentType: "CT01",
        algorithm: activeKey.algorithm,
        signer,
        organization,
        purpose: "Issue public administrative document",
    });

    const signature = await signPayload(payload);
    const signatureRecord = await createFalconSignatureRecord({
        document: { ...submitted, original_file_hash: fileHash },
        signedFileHash: signedHash,
        issuedAt,
        activeKey,
        signatureInfo: signature,
        payload,
        signer,
        organization,
        ipAddress
    });
    const evidencePath = await writeSignatureEvidenceFile(documentFolder, {
        document_id: documentId,
        verify_url: verifyUrl,
        signature_type: "organization_falcon",
        signature: signature.signature,
        payload,
        payload_hash: hashText(payload),
        key_id: signature.key_id,
        algorithm: signature.algorithm,
        signer,
        organization,
        signed_file_hash: signedHash,
        original_file_hash: fileHash,
        signed_at: issuedAt,
        signature_record_id: signatureRecord.signature_id || null
    });

    const saved = await updateDocument(documentId, {
        status: "issued",
        file_hash: signedHash,
        signed_file_hash: signedHash,
        signed_pdf_path: signedPath,
        signature: signature.signature,
        signature_payload: payload,
        signature_evidence_path: evidencePath,
        public_key_id: activeKey.key_id,
        public_key: activeKey.public_key,
        token_hash: hashText(token),
        verify_url: verifyUrl,
        qr_payload: { document_id: documentId, verify_url: verifyUrl, status: "issued", owner_name: "" },
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

    const signatureRecord = normalizeSignatureRecord(
        await getLatestSignatureByDocumentId(documentId, "organization_falcon")
    ) || normalizeSignatureRecord({
        document_id: document.document_id,
        signature: document.signature,
        signature_payload: document.signature_payload,
        file_hash: document.file_hash,
        original_file_hash: document.original_file_hash,
        algorithm: document.algorithm,
        public_key_id: document.public_key_id,
        public_key: document.public_key,
        signed_at: document.signed_at,
        signature_status: document.signature ? "active" : "missing",
    });

    if (!signatureRecord?.signature_value || !signatureRecord?.signature_payload_json) {
        await writeAuditLog({ action: "verify", documentId, userId, ipAddress, result: "fail" });
        return {
            valid: false,
            reason: "SIGNATURE_NOT_FOUND",
            status: document.status
        };
    }

    let currentHashV2;
    if (filePath) {
        currentHashV2 = await hashFile(filePath);
    } else if (document.signed_pdf_path && fs.existsSync(document.signed_pdf_path)) {
        currentHashV2 = await hashFile(document.signed_pdf_path);
    } else {
        currentHashV2 = signatureRecord.signed_file_hash || document.file_hash;
    }

    const expectedHash = signatureRecord.signed_file_hash || document.file_hash;
    const hashMatchedV2 = currentHashV2 === expectedHash;
    let publicKey = signatureRecord.public_key || document.public_key;
    let publicKeyStatus = "unknown";
    try {
        const key = await getPublicKeyById(signatureRecord.key_id);
        publicKey = key.public_key;
        publicKeyStatus = key.status;
    } catch {
        publicKeyStatus = publicKey ? "snapshot" : "missing";
    }

    const signatureValidV2 = await verifyPayloadSignature({
        payload: signatureRecord.signature_payload_json,
        signature: signatureRecord.signature_value,
        publicKey
    });
    const originalHash = document.original_file_hash || document.file_hash;
    const verifiedSignatures = await verifyAllSignatureRecords({
        documentId,
        currentSignedHash: currentHashV2,
        originalHash
    });
    const organizationVerified = verifiedSignatures.find(
        (item) => item.signature_type === "organization_falcon"
    );
    const officerVerified = verifiedSignatures.find(
        (item) => item.signature_type === "officer_personal_falcon"
    );
    const validV2 = organizationVerified
        ? organizationVerified.valid
        : hashMatchedV2 && signatureValidV2;

    await writeAuditLog({
        action: "verify",
        documentId,
        userId,
        ipAddress,
        result: validV2 ? "success" : "fail"
    });

    return {
        valid: validV2,
        reason: validV2 ? "VALID_DOCUMENT" : "TAMPERED_OR_INVALID_SIGNATURE",
        document_id: document.document_id,
        file_hash: expectedHash,
        current_hash: currentHashV2,
        hash_matched: hashMatchedV2,
        signature_valid: signatureValidV2,
        algorithm: signatureRecord.algorithm,
        signature_provider: document.signature_provider || "crypto-zone",
        public_key_id: signatureRecord.key_id,
        key_id: signatureRecord.key_id,
        public_key_status: publicKeyStatus,
        signer: signatureRecord.signer,
        organization: signatureRecord.organization,
        status: document.status,
        signed_at: signatureRecord.signed_at || document.signed_at,
        signature_type: signatureRecord.signature_type,
        signature_status: signatureRecord.signature_status,
        officer_signature_valid: officerVerified ? officerVerified.valid : null,
        organization_signature_valid: organizationVerified ? organizationVerified.valid : validV2,
        signatures: verifiedSignatures
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

    let signature_info = null;
    let signature_summaries = [];
    try {
        signature_info = normalizeSignatureRecord(
            await getLatestSignatureByDocumentId(documentId, "organization_falcon")
        );
        signature_summaries = await listSignatureSummaries(documentId);
    } catch (_) { /* ignore signature lookup failures for listing */ }

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
        signer: signature_info?.signer || null,
        organization: signature_info?.organization || null,
        signature_type: signature_info?.signature_type || null,
        signature_status: signature_info?.signature_status || null,
        signatures: signature_summaries,
        signature_evidence_path: document.signature_evidence_path || null,
        verify_url: document.verify_url,
        signed_pdf_url: document.signed_pdf_path ? `/api/app/documents/${document.document_id}/signed-pdf` : null,
        status: document.status,
        created_at: document.created_at,
        signed_at: document.signed_at,
        rejection_reason: document.rejection_reason || null,
        rejected_at: document.rejected_at || null
    };
};

/** Lấy danh sách tài liệu thuộc về một công dân cụ thể */
export const getDocumentsByOwner = async (ownerId) => {
    let filteredDocs;
    if (listDocumentsByOwner) {
        // MySQL: query trực tiếp theo owner_id (không load all)
        filteredDocs = await listDocumentsByOwner(ownerId);
    } else {
        // JSON: filter in-memory
        const allDocs = await listDocuments();
        filteredDocs = allDocs.filter((doc) => doc.owner_id === ownerId);
    }
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

    await fsPromises.writeFile(
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

export const createSigningChallengeForDocument = async ({ documentId, officerId = "officer", ipAddress = null }) => {
    const document = await findDocumentById(documentId);
    if (!document) {
        throw new Error("Document not found");
    }
    if (document.status !== "submitted") {
        throw new Error(`Cannot sign document with status "${document.status}"`);
    }

    const { signer, organization } = await resolveSignerContext(officerId);
    const officerKey = await getOfficerPersonalKey(signer);
    const originalHash = await getCurrentOriginalFileHash(document);
    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomBytes(32).toString("base64url");
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const payload = buildSignaturePayload({
        action: "approve_document",
        challengeId,
        nonce,
        documentId,
        fileHash: originalHash,
        issuedAt,
        keyId: officerKey.key_id,
        documentType: "CT01",
        algorithm: officerKey.algorithm,
        signer,
        organization,
        purpose: "Officer approval before public document issuance",
    });

    await createChallenge({
        challenge_id: challengeId,
        document_id: documentId,
        officer_id: String(officerId),
        key_id: officerKey.key_id,
        payload_json: payload,
        payload_hash: hashText(payload),
        nonce,
        status: "pending",
        expires_at: expiresAt,
        ip_address: ipAddress
    });

    return {
        challenge_id: challengeId,
        document_id: documentId,
        key_id: officerKey.key_id,
        algorithm: officerKey.algorithm,
        payload,
        payload_hash: hashText(payload),
        expires_at: expiresAt,
        signer,
        organization
    };
};

const verifyOfficerSignatureProof = async ({
    documentId,
    officerId,
    proof,
    ipAddress
}) => {
    if (!proof || typeof proof !== "object") {
        if (REQUIRE_OFFICER_DEVICE_SIGNATURE) {
            throw new Error("Officer device signature proof is required");
        }
        return null;
    }

    const { challenge_id: challengeId, signature } = proof;
    if (!challengeId || !signature) {
        throw new Error("Officer signature proof must include challenge_id and signature");
    }

    const challenge = await findChallengeById(challengeId);
    if (!challenge) {
        throw new Error("Signing challenge not found");
    }
    if (challenge.status !== "pending") {
        throw new Error("Signing challenge is not pending");
    }
    if (String(challenge.document_id) !== String(documentId)) {
        throw new Error("Signing challenge document mismatch");
    }
    if (String(challenge.officer_id) !== String(officerId)) {
        throw new Error("Signing challenge officer mismatch");
    }
    if (challenge.expires_at && new Date(challenge.expires_at) < new Date()) {
        throw new Error("Signing challenge expired");
    }

    const publicKey = await getPublicKeyById(challenge.key_id);
    const challengePayload = parseSignaturePayload(challenge.payload_json);
    if (
        challengePayload.action !== "approve_document" ||
        String(challengePayload.document_id) !== String(documentId) ||
        String(challengePayload.key_id) !== String(challenge.key_id) ||
        !challengePayload.file_hash
    ) {
        throw new Error("Signing challenge payload does not match the approval request");
    }
    const signatureValid = await verifyPayloadSignature({
        payload: challenge.payload_json,
        signature,
        publicKey: publicKey.public_key
    });
    if (!signatureValid) {
        throw new Error("Officer device signature is invalid");
    }

    const usedChallenge = await markChallengeUsed(challengeId);
    if (!usedChallenge) {
        throw new Error("Signing challenge was already used");
    }
    const signedAt = new Date().toISOString();

    return {
        signatureInfo: {
            signature,
            key_id: publicKey.key_id,
            algorithm: publicKey.algorithm,
            provider: publicKey.provider || "external-device"
        },
        payload: challenge.payload_json,
        payload_hash: challenge.payload_hash,
        key: publicKey,
        approved_file_hash: challengePayload.file_hash || null,
        signed_at: signedAt
    };
};

/**
 * Cán bộ ký số hồ sơ: sinh QR, nhúng vào PDF, ký Falcon-512, chuyển trạng thái "issued".
 * @param {Object} params - { documentId, officerId, ipAddress }
 * @returns {Object} Thông tin tài liệu đã ký và phát hành
 */
export const signDocument = async ({ documentId, officerId = "officer", ipAddress = null, officerSignatureProof = null }) => {
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
    const { signer, organization } = await resolveSignerContext(officerId);
    const originalHash = await getCurrentOriginalFileHash(document);
    let officerApproval = await verifyOfficerSignatureProof({
        documentId,
        officerId,
        proof: officerSignatureProof,
        ipAddress
    });
    if (officerApproval?.approved_file_hash && officerApproval.approved_file_hash !== originalHash) {
        throw new Error("Officer approval does not match current original PDF hash");
    }
    if (!officerApproval) {
        if (SIGNING_MODE === "device") {
            // DEVICE MODE: Bắt buộc phải có officer signature proof từ thiết bị
            let officerHasKey = false;
            try {
                await getOfficerPersonalKey(signer);
                officerHasKey = true;
            } catch {
                officerHasKey = false;
            }

            if (officerHasKey) {
                throw new Error(
                    "Officer device signature proof is required. " +
                    "Please sign the challenge on your device and provide the proof."
                );
            } else {
                throw new Error(
                    "Officer has not registered a device key. " +
                    "Please register your Falcon-512 device key before signing documents."
                );
            }
        }

        // HSM MODE: Server (HSM) ký thay officer sau khi xác thực JWT
        // Officer identity được đảm bảo bởi JWT authentication + audit log
        const officerKey = await getOfficerPersonalKey(signer);
        const approvalPayload = buildSignaturePayload({
            action: "approve_document",
            documentId,
            fileHash: originalHash,
            issuedAt,
            keyId: officerKey.key_id,
            documentType: "CT01",
            algorithm: officerKey.algorithm,
            signer,
            organization,
            purpose: "Officer approval before public document issuance",
        });
        let officerSignatureInfo;
        try {
            officerSignatureInfo = await signPayloadWithKey(approvalPayload, officerKey.key_id);
        } catch (error) {
            if (error?.code === "PUBLIC_ONLY_KEY") {
                throw new Error(
                    "Officer key is public-only (no private key on server). " +
                    "Either provide a device signature proof, or ensure ALLOW_SERVER_SIDE_PERSONAL_KEYS is enabled."
                );
            }
            throw error;
        }
        officerApproval = {
            signatureInfo: officerSignatureInfo,
            payload: approvalPayload,
            payload_hash: hashText(approvalPayload),
            key: officerKey,
            approved_file_hash: originalHash,
            signed_at: issuedAt
        };
    }

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
            owner_name: ownerName,
            signer_name: signer.full_name,
            organization_name: organization.name
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
        documentType: "CT01",
        algorithm: activeKey.algorithm,
        signer,
        organization,
        purpose: "Issue public administrative document",
    });
    const signatureInfo = await signPayload(payload);
    const officerSignatureRecord = await createFalconSignatureRecord({
        document,
        signedFileHash: originalHash,
        issuedAt: officerApproval.signed_at || issuedAt,
        activeKey: officerApproval.key,
        signatureInfo: officerApproval.signatureInfo,
        payload: officerApproval.payload,
        signer,
        organization,
        ipAddress,
        reason: "Officer approval before public document issuance",
        signatureType: "officer_personal_falcon"
    });
    officerApproval.record = officerSignatureRecord;

    const signatureRecord = await createFalconSignatureRecord({
        document,
        signedFileHash: fileHash,
        issuedAt,
        activeKey,
        signatureInfo,
        payload,
        signer,
        organization,
        ipAddress
    });
    const evidencePath = await writeSignatureEvidenceFile(documentFolder, {
        document_id: documentId,
        verify_url: verifyUrl,
        signatures: [
            {
                signature_type: "officer_personal_falcon",
                signature: officerApproval.signatureInfo.signature,
                payload: officerApproval.payload,
                payload_hash: officerApproval.payload_hash || hashText(officerApproval.payload),
                key_id: officerApproval.signatureInfo.key_id,
                algorithm: officerApproval.signatureInfo.algorithm,
                signed_file_hash: originalHash,
                signed_at: officerApproval.signed_at || issuedAt,
                signature_record_id: officerApproval.record?.signature_id || null
            },
            {
                signature_type: "organization_falcon",
                signature: signatureInfo.signature,
                payload,
                payload_hash: hashText(payload),
                key_id: signatureInfo.key_id,
                algorithm: signatureInfo.algorithm,
                signed_file_hash: fileHash,
                signed_at: issuedAt,
                signature_record_id: signatureRecord.signature_id || null
            }
        ],
        signer,
        organization,
        signed_file_hash: fileHash,
        original_file_hash: originalHash,
        signed_at: issuedAt,
        note: "QR supports public verification; Falcon evidence is verified by backend."
    });

    // 5. Update document record
    const updated = await updateDocument(documentId, {
        status: "issued",
        signed_at: issuedAt,
        signed_pdf_path: signedFilePath,
        file_hash: fileHash,
        signed_file_hash: fileHash,
        signature: signatureInfo.signature,
        signature_payload: payload,
        signature_evidence_path: evidencePath,
        algorithm: signatureInfo.algorithm,
        signature_provider: signatureInfo.provider,
        public_key_id: signatureInfo.key_id,
        public_key: activeKey.public_key,
        token_hash: hashText(token),
        verify_url: verifyUrl,
        qr_payload: {
            document_id: documentId,
            verify_url: verifyUrl,
            status: "issued",
            owner_name: ownerName,
            signer_name: signer.full_name,
            organization_name: organization.name
        }
    });

    // 6. Update metadata.json
    await fsPromises.writeFile(
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
        signer,
        organization,
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
    let filteredDocs;
    if (listDocumentsByStatus) {
        // MySQL: query trực tiếp theo status (không load all)
        filteredDocs = await listDocumentsByStatus(status);
    } else {
        // JSON: filter in-memory
        const allDocs = await listDocuments();
        filteredDocs = allDocs.filter((doc) => doc.status === status);
    }

    const docs = await Promise.all(
        filteredDocs.map((doc) => getDocument(doc.document_id))
    );

    // Sắp xếp mới nhất lên đầu
    const dateField = status === "issued" ? "signed_at" : status === "rejected" ? "rejected_at" : "created_at";
    docs.sort((a, b) => new Date(b[dateField]) - new Date(a[dateField]));

    return docs;
};

/**
 * Cán bộ từ chối hồ sơ: chuyển trạng thái "rejected", lưu lý do.
 * @param {Object} params - { documentId, officerId, reason, ipAddress }
 */
export const rejectDocument = async ({ documentId, officerId = "officer", reason, ipAddress = null }) => {
    const document = await findDocumentById(documentId);
    if (!document) throw new Error("Document not found");
    if (document.status !== "submitted") throw new Error(`Cannot reject document with status "${document.status}"`);

    const rejectedAt = new Date().toISOString();
    const updated = await updateDocument(documentId, {
        status: "rejected",
        rejection_reason: reason || "Không có lý do",
        rejected_at: rejectedAt
    });

    await writeAuditLog({ action: "reject", documentId, userId: officerId, ipAddress, result: "success" });

    return {
        document_id: updated.document_id,
        status: updated.status,
        rejection_reason: updated.rejection_reason,
        rejected_at: updated.rejected_at
    };
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
