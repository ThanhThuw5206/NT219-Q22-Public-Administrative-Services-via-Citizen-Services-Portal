import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import { createPreviewDocument } from "../services/preview.service.js";
import {
    getDocument,
    getDocuments,
    getSignedDocumentFile,
    processDocument,
    verifyDocument
} from "../services/document.service1.js";//dùng file mới 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDirectory = path.resolve(__dirname, "../uploads");

// đảm bảo folder tồn tại
const uploadFolder = "src/uploads/";

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
}

// cấu hình storage
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
  //mới thêm(nếu thấy r có thể xóa  cmt)
export const previewDocument = async (req, res) => {

    try {

        const result = await createPreviewDocument(req.body);

        res.status(200).json({
            message: "Preview generated",
            data: result
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};

export const issueDocument = async (req, res) => {

    try {

        const result = await processDocument({

            filePath: req.body.filePath,
            originalName: req.body.originalName,
            ownerId: req.body.owner_id || "demo-citizen",
            ipAddress: req.ip

        });

        res.status(201).json({

            message: "Document issued successfully",

            documentInfo: result

        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};
//.
export const uploadDocument = (req, res) => {
    upload.single("file")(req, res, async function (err) {
        if (err) {
            return res.status(400).json({ message: err.message || "Upload error" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        try {
             const result = await processDocument({
                 filePath: req.file.path,
                 originalName: req.file.originalname,
                 ownerId: req.body.owner_id || "demo-citizen",
                 ipAddress: req.ip
             });

            //  Tạo preview document
            //  const preview = await createPreviewDocument({
            //      documentId: result.document_id,
            //      filePath: req.file.path
            //  });
            // đã tạo preview trong processDocument nên ko cần tạo nữa
            

             res.status(201).json({
                 message: "Upload, hash, digital signature and signed PDF OK",
                 file: req.file.path,
                 documentInfo: result
             });
            //thay thành
            
        //.
        } catch (error) {
            res.status(500).json({
                message: "Document signing failed",
                reason: error.message
            });
        }

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

export const downloadSignedDocument = (req, res) => {
    const signedFile = getSignedDocumentFile(req.params.documentId);

    if (!signedFile || !fs.existsSync(signedFile.filePath)) {
        return res.status(404).json({ message: "Signed PDF not found" });
    }

    res.download(signedFile.filePath, signedFile.fileName);
};
