import fs from "fs";
import crypto from "crypto";

// tạo document_id
export const generateDocumentId = () => {
    return "HS-" + Date.now();
};

// tạo SHA-256 hash
export const generateFileHash = (filePath) => {
    const fileBuffer = fs.readFileSync(filePath);

    return crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");
};

// xử lý document
export const processDocument = (filePath) => {

    const documentId = generateDocumentId();
    const hash = generateFileHash(filePath);

    return {
        document_id: documentId,
        file_hash: hash,
        file_path: filePath
    };
};