import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import {
    getDocument,
    getDocuments,
    processDocument,
    verifyDocument
} from "../services/document.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDirectory = path.resolve(__dirname, "../uploads");

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        fs.mkdirSync(uploadDirectory, { recursive: true });
        cb(null, uploadDirectory);
    },
    filename: function (req, file, cb) {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const pdfOnly = (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
        return cb(new Error("Only PDF files are allowed"));
    }

    cb(null, true);
};

const upload = multer({ storage, fileFilter: pdfOnly });

export const uploadDocument = (req, res) => {
    upload.single("file")(req, res, function (err) {
        if (err) {
            return res.status(400).json({ message: err.message || "Upload error" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const result = processDocument({
            filePath: req.file.path,
            originalName: req.file.originalname,
            ownerId: req.body.owner_id || "demo-citizen",
            ipAddress: req.ip
        });

        res.status(201).json({
            message: "Upload, hash and digital signature OK",
            file: req.file.path,
            documentInfo: result
        });
    });
};

export const verifyDocumentByQr = (req, res) => {
    const result = verifyDocument({
        documentId: req.params.documentId,
        token: req.query.token,
        actor: req.query.actor || "qr-verifier",
        ipAddress: req.ip
    });

    res.status(result.valid ? 200 : 400).json(result);
};

export const verifyDocumentByUpload = (req, res) => {
    upload.single("file")(req, res, function (err) {
        if (err) {
            return res.status(400).json({ message: err.message || "Upload error" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const result = verifyDocument({
            documentId: req.params.documentId,
            token: req.body.token || req.query.token,
            filePath: req.file.path,
            actor: req.body.actor || "upload-verifier",
            ipAddress: req.ip
        });

        res.status(result.valid ? 200 : 400).json(result);
    });
};

export const getDocumentDetail = (req, res) => {
    const document = getDocument(req.params.documentId);

    if (!document) {
        return res.status(404).json({ message: "Document not found" });
    }

    res.json(document);
};

export const listDocumentDetails = (req, res) => {
    res.json(getDocuments());
};
