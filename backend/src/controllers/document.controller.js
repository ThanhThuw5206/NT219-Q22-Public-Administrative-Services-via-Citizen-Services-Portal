import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import {
    createPreviewDocument,
    getPreviewById
} from "../services/preview.service.js";
import {
    getDocument,
    getDocuments,
    getSignedDocumentFile,
    getDocumentFile,
    getDocumentsByStatus,
    processDocument,
    submitDocument,
    signDocument,
    verifyDocument
} from "../services/document.service1.js"; 
import {
    validateCT01
} from "../validators/ct01.validator.js";


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
        validateCT01(req.body);

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

        const preview = await getPreviewById(req.body.preview_id);

        if (!preview) {
            return res.status(404).json({
                message: "Preview not found"
            });
        }
      if (preview.expired_at && new Date(preview.expired_at) < new Date()) {

        return res.status(400).json({
            message: "Preview expired"
        });

    }

       const parsedFormData =
            typeof preview.form_data === "string"
                ? JSON.parse(preview.form_data)
                : preview.form_data;

        const result = await processDocument({

            documentId: preview.document_id,

            filePath: preview.preview_path,

            originalName: "CT01.pdf",

            ownerId: req.body.owner_id,

            ipAddress: req.ip,

            formData: parsedFormData

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

export const verifyDocumentByQr = async (req, res) => {
    const result = await verifyDocument({
        documentId: req.params.documentId,
        token: req.query.token,
        actor: req.query.actor || "qr-verifier",
        ipAddress: req.ip
    });

    res.status(result.valid ? 200 : 400).json(result);
};

export const verifyDocumentByUpload = (req, res) => {
    upload.single("file")(req, res, async function (err) {
        if (err) {
            return res.status(400).json({ message: err.message || "Upload error" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const result = await verifyDocument({
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

// ---------------------------------------------------------------------------
// New: Citizen-Officer workflow
// ---------------------------------------------------------------------------

export const submitDocumentHandler = async (req, res) => {
    try {
        validateCT01(req.body);

        const preview = await createPreviewDocument(req.body);

        const result = await submitDocument({
            documentId: preview.document_id,
            filePath: preview.file_path,
            originalName: "CT01.pdf",
            ownerId: req.user?.id ? String(req.user.id) : "citizen",
            ipAddress: req.ip
        });

        res.status(201).json({
            message: "Document submitted for review",
            data: {
                document_id: result.document_id,
                status: result.status,
                preview_url: preview.preview_url
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const signDocumentHandler = async (req, res) => {
    try {
        const result = await signDocument({
            documentId: req.params.documentId,
            officerId: req.user?.full_name || "officer",
            ipAddress: req.ip
        });

        res.status(201).json({
            message: "Document signed and issued successfully",
            documentInfo: result
        });
    } catch (error) {
        const status = error.message.includes("not found") ? 404 : 400;
        res.status(status).json({ message: error.message });
    }
};

export const listPendingDocuments = (req, res) => {
    res.json(getDocumentsByStatus("submitted"));
};

export const listIssuedDocuments = (req, res) => {
    res.json(getDocumentsByStatus("issued"));
};

export const downloadDocumentFile = (req, res) => {
    const file = getDocumentFile(req.params.documentId);

    if (!file || !fs.existsSync(file.filePath)) {
        return res.status(404).json({ message: "Document file not found" });
    }

    res.download(file.filePath, file.fileName);
};
