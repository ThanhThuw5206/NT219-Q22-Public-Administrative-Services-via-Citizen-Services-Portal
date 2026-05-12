import crypto from "crypto";
import { sha256File, sha256Text } from "../crypto/hash.service.js";
import { saveDocument, findDocumentById, listDocuments } from "./document.repository.js";
import { buildSignaturePayload, getActiveKey, signPayload, verifyPayloadSignature } from "../crypto/signature.service.js";
import { writeAuditLog } from "./audit.service.js";
import { createSignedPdf } from "./signed-pdf.service.js";

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

    const documentId = generateDocumentId();
    const issuedAt = new Date().toISOString();
    const token = generateVerificationToken();
    const activeKey = getActiveKey();
    const verifyUrl = buildVerifyUrl(documentId, token);
    const originalFileHash = sha256File(filePath);

    const documentRecord = {
        document_id: documentId,
        owner_id: ownerId,
        original_name: originalName,
        file_path: filePath,
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

    const signedFilePath = await createSignedPdf({
        sourceFilePath: filePath,
        documentRecord
    });

    documentRecord.signed_file_path = signedFilePath;
    documentRecord.file_hash = sha256File(signedFilePath);

    const payload = buildSignaturePayload({
        documentId,
        fileHash: documentRecord.file_hash,
        issuedAt,
        keyId: activeKey.key_id,
        version: 1
    });
    const signatureInfo = signPayload(payload);

    documentRecord.signature = signatureInfo.signature;
    documentRecord.signature_payload = payload;
    documentRecord.algorithm = signatureInfo.algorithm;
    documentRecord.signature_provider = signatureInfo.provider;
    documentRecord.public_key_id = signatureInfo.key_id;

    const savedDocument = saveDocument(documentRecord);

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
        file_path: savedDocument.signed_file_path,
        signed_file: savedDocument.signed_file_path,
        original_file_hash: savedDocument.original_file_hash,
        signed_pdf_url: `/api/app/documents/${savedDocument.document_id}/signed-pdf`,
        status: savedDocument.status,
        signed_at: savedDocument.signed_at
    };
};

export const verifyDocument = ({ documentId, token, filePath = null, actor = "anonymous", ipAddress = null }) => {
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
    const signatureValid = verifyPayloadSignature({
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
        file_path: document.signed_file_path || document.file_path,
        original_file_hash: document.original_file_hash || null,
        algorithm: document.algorithm,
        signature_provider: document.signature_provider,
        public_key_id: document.public_key_id,
        verify_url: document.verify_url,
        signed_pdf_url: document.signed_file_path ? `/api/app/documents/${document.document_id}/signed-pdf` : null,
        status: document.status,
        created_at: document.created_at,
        signed_at: document.signed_at
    };
};

export const getDocuments = () => {
    return listDocuments().map((document) => getDocument(document.document_id));
};

export const getSignedDocumentFile = (documentId) => {
    const document = findDocumentById(documentId);

    if (!document || !document.signed_file_path) {
        return null;
    }

    return {
        filePath: document.signed_file_path,
        fileName: `${document.document_id}-signed.pdf`
    };
};
