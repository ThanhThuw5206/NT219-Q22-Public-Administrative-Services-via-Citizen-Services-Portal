import crypto from "crypto";
import { sha256File, sha256Text } from "../crypto/hash.service.js";
import { saveDocument, findDocumentById, listDocuments } from "./document.repository.js";
import { buildSignaturePayload, getActiveKey, signPayload, verifyPayloadSignature } from "../crypto/signature.service.js";
import { writeAuditLog } from "./audit.service.js";

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

export const processDocument = ({ filePath, originalName, ownerId = "demo-citizen", ipAddress = null }) => {
    const documentId = generateDocumentId();
    const issuedAt = new Date().toISOString();
    const token = generateVerificationToken();
    const activeKey = getActiveKey();
    const fileHash = sha256File(filePath);
    const payload = buildSignaturePayload({
        documentId,
        fileHash,
        issuedAt,
        keyId: activeKey.key_id,
        version: 1
    });
    const signatureInfo = signPayload(payload);
    const verifyUrl = buildVerifyUrl(documentId, token);

    const documentRecord = saveDocument({
        document_id: documentId,
        owner_id: ownerId,
        original_name: originalName,
        file_path: filePath,
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
        },
        status: "issued",
        created_at: issuedAt,
        signed_at: issuedAt
    });

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
        document_id: documentRecord.document_id,
        file_hash: documentRecord.file_hash,
        signature: documentRecord.signature,
        algorithm: documentRecord.algorithm,
        signature_provider: documentRecord.signature_provider,
        public_key_id: documentRecord.public_key_id,
        verify_url: documentRecord.verify_url,
        qr_payload: documentRecord.qr_payload,
        status: documentRecord.status,
        signed_at: documentRecord.signed_at
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
    const hashMatched = currentHash === document.file_hash;
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
        algorithm: document.algorithm,
        signature_provider: document.signature_provider,
        public_key_id: document.public_key_id,
        verify_url: document.verify_url,
        status: document.status,
        created_at: document.created_at,
        signed_at: document.signed_at
    };
};

export const getDocuments = () => {
    return listDocuments().map((document) => getDocument(document.document_id));
};
