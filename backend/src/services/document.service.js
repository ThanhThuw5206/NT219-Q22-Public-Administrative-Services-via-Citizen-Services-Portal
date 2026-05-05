import fs from "fs";
import crypto from "crypto";

// tạo document_id
const generateDocumentId = () => {
    return "HS-" + Date.now();
};

// tạo hash SHA-256
const generateFileHash = (filePath) => {
    const fileBuffer = fs.readFileSync(filePath);

    const hash = crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");

    return hash;
};

export const processDocument = (filePath) => {
    const documentId = generateDocumentId();
    const hash = generateFileHash(filePath);

    return {
        document_id: documentId,
        hash: hash,
        file_path: filePath
    };
};