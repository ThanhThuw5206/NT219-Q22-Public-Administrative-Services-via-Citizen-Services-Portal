<<<<<<< HEAD
<<<<<<< HEAD
import multer from "multer";
import { processDocument } from "../services/document.service.js";

=======
=======
>>>>>>> 23a197e01f4b73f3ec366b487282b0512f2d57f0
/**
 * document.controller.js - Điều khiển các endpoint quản lý tài liệu.
 * Bao gồm: xem trước, nộp hồ sơ, ký số, xác minh, tải file, danh sách.
 */
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
    getDocumentsByOwner,
    processDocument,
    submitDocument,
    signDocument,
    rejectDocument,
    verifyDocument
} from "../services/document.service1.js";
import { hashFile } from "../crypto/hash.service.js";
import {
    validateCT01
} from "../validators/ct01.validator.js";
import { saveMembersForDocument } from "../repositories/household_members.repository.js";
import { validateFilePath } from "../utils/path-validator.util.js";
import { IS_DEV } from "../config/env.config.js";

/**
 * Safe error responses for document endpoints.
 * In production, don't leak internal error details.
 */
function safeError(res, error, statusCode = 500) {
    if (IS_DEV) {
        return res.status(statusCode).json({ message: error.message });
    }
    // Known safe error messages
    const safeMessages = [
        "Document not found",
        "Preview not found",
        "Preview expired",
        "Preview file not found",
        "File not found",
        "Signed PDF not found",
        "Cannot sign document with status",
    ];
    if (safeMessages.some(m => error.message.includes(m))) {
        return res.status(statusCode).json({ message: error.message });
    }
    return res.status(statusCode).json({ message: "An error occurred" });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDirectory = path.resolve(__dirname, "../uploads");

const uploadFolder = "src/uploads/";
if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
}

/** Cấu hình multer: chỉ chấp nhận file PDF, lưu vào thư mục uploads */
<<<<<<< HEAD
>>>>>>> origin/develop
=======
>>>>>>> 23a197e01f4b73f3ec366b487282b0512f2d57f0
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        fs.mkdirSync(uploadDirectory, { recursive: true });
        cb(null, uploadDirectory);
    },
    filename: function (req, file, cb) {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

<<<<<<< HEAD
<<<<<<< HEAD
const upload = multer({ storage }).single("file");

export const uploadDocument = (req, res) => {
    upload(req, res, function (err) {
        if (err) {
            return res.status(500).json({ message: "Upload error" });
=======
=======
>>>>>>> 23a197e01f4b73f3ec366b487282b0512f2d57f0
const pdfOnly = (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
        return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
};

const upload = multer({ storage, fileFilter: pdfOnly });

/** Kiểm tra người dùng có phải officer/admin (quản lý tất cả hồ sơ) */
const canManageAllDocuments = (user) => {
    const roles = user?.roles || [];
    return roles.includes("officer") || roles.includes("admin");
};

/** Kiểm tra người dùng có quyền truy cập tài liệu (là chủ sở hữu hoặc officer/admin) */
const canAccessDocument = (user, document) => {
    if (!user || !document) return false;
    if (canManageAllDocuments(user)) return true;
    return String(document.owner_id) === String(user.id);
};

// ---------------------------------------------------------------------------
// Xem trước hồ sơ CT01
// ---------------------------------------------------------------------------

/** Tạo PDF xem trước từ dữ liệu form CT01 */
export const previewDocument = async (req, res) => {
    try {
        req.body.cccd = req.body.cccd || req.body.citizen_id;
        req.body.reason = req.body.reason || req.body.request_content;

        const dob =
            req.body.dob ||
            (req.body.birth_day && req.body.birth_month && req.body.birth_year
                ? `${req.body.birth_year}-${req.body.birth_month}-${req.body.birth_day}`
                : null);
        req.body.dob = dob;

        validateCT01(req.body);

        const result = await createPreviewDocument({
            ...req.body,
            owner_id: req.user?.id ? String(req.user.id) : null
        });

        res.status(200).json({
            message: "Preview generated",
            data: result
        });
    } catch (error) {
        safeError(res, error);
    }
};

// ---------------------------------------------------------------------------
// Nộp hồ sơ (Citizen nộp từ preview đã xác nhận)
// ---------------------------------------------------------------------------

/** Công dân nộp hồ sơ: kiểm tra preview hợp lệ, chuyển trạng thái submitted */
export const submitDocumentHandler = async (req, res) => {
    try {
        req.body.cccd = req.body.cccd || req.body.citizen_id;
        req.body.reason = req.body.reason || req.body.request_content;

        const dob =
            req.body.dob ||
            (req.body.birth_day && req.body.birth_month && req.body.birth_year
                ? `${req.body.birth_year}-${req.body.birth_month}-${req.body.birth_day}`
                : null);
        req.body.dob = dob;

        validateCT01(req.body);

        const preview = await getPreviewById(req.body.preview_id);
        if (!preview) {
            return res.status(404).json({ message: "Preview not found" });
        }
        if (preview.expired_at && new Date(preview.expired_at) < new Date()) {
            return res.status(400).json({ message: "Preview expired" });
        }

        const previewOwnerId = preview.owner_id ? String(preview.owner_id) : null;
        if (previewOwnerId && previewOwnerId !== String(req.user.id)) {
            return res.status(403).json({ message: "You do not have access to this preview" });
        }

        if (!preview.preview_path || !fs.existsSync(preview.preview_path)) {
            return res.status(400).json({ message: "Preview file not found" });
        }

        const result = await submitDocument({
            documentId: preview.document_id,
            filePath: preview.preview_path,
            originalName: "CT01.pdf",
            ownerId: req.user.id,
            ipAddress: req.ip
        });

        // Lưu thành viên hộ gia đình nếu có
        const members = req.body.members;
        if (Array.isArray(members) && members.length > 0) {
            await saveMembersForDocument(preview.document_id, members);
        }

        res.status(201).json({
            message: "CT01 submitted successfully",
            data: result
        });
    } catch (err) {
        safeError(res, err);
    }
};

// ---------------------------------------------------------------------------
// Ký số (Officer ký Falcon-512 và phát hành hồ sơ)
// ---------------------------------------------------------------------------

/** Cán bộ ký số hồ sơ: sinh QR, nhúng PDF, ký Falcon-512, chuyển issued */
export const signDocumentHandler = async (req, res) => {
    try {
        const result = await signDocument({
            documentId: req.params.documentId,
            officerId: req.user?.id ? String(req.user.id) : "officer",
            ipAddress: req.ip
        });

        res.status(201).json({
            message: "Document signed and issued successfully",
            documentInfo: result
        });
    } catch (error) {
        const status = error.message.includes("not found") ? 404 : 400;
        safeError(res, error, status);
    }
};

// ---------------------------------------------------------------------------
// Danh sách hồ sơ
// ---------------------------------------------------------------------------

/** Liệt kê hồ sơ: citizen thấy của mình, officer/admin thấy tất cả */
export const listDocumentDetails = async (req, res) => {
    try {
        if (canManageAllDocuments(req.user)) {
            return res.json(await getDocuments());
        }
        res.json(await getDocumentsByOwner(req.user.id));
    } catch (error) {
        safeError(res, error);
    }
};

/** Liệt kê hồ sơ chờ ký (status = submitted) */
export const listPendingDocuments = async (req, res) => {
    try {
        const documents = await getDocumentsByStatus("submitted");
        res.json(documents);
    } catch (error) {
        safeError(res, error);
    }
};

/** Liệt kê hồ sơ đã ký (status = issued) */
export const listIssuedDocuments = async (req, res) => {
    try {
        const documents = await getDocumentsByStatus("issued");
        res.json(documents);
    } catch (error) {
        safeError(res, error);
    }
};

/** Liệt kê hồ sơ đã từ chối (status = rejected) */
export const listRejectedDocuments = async (req, res) => {
    try {
        const documents = await getDocumentsByStatus("rejected");
        res.json(documents);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/** Cán bộ từ chối hồ sơ: yêu cầu lý do, chuyển trạng thái "rejected" */
export const rejectDocumentHandler = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason || !reason.trim()) {
            return res.status(400).json({ message: "Lý do từ chối là bắt buộc" });
        }
        const result = await rejectDocument({
            documentId: req.params.documentId,
            officerId: req.user?.id ? String(req.user.id) : "officer",
            reason: reason.trim(),
            ipAddress: req.ip
        });
        res.status(200).json({ message: "Hồ sơ đã bị từ chối", data: result });
    } catch (error) {
        const status = error.message.includes("not found") ? 404 : 400;
        res.status(status).json({ message: error.message });
    }
};

// ---------------------------------------------------------------------------
// Chi tiết hồ sơ
// ---------------------------------------------------------------------------

/** Xem chi tiết một hồ sơ theo documentId */
export const getDocumentDetail = async (req, res) => {
    try {
        const document = await getDocument(req.params.documentId);

        if (!document) {
            return res.status(404).json({ message: "Document not found" });
<<<<<<< HEAD
>>>>>>> origin/develop
=======
>>>>>>> 23a197e01f4b73f3ec366b487282b0512f2d57f0
        }

        if (!canAccessDocument(req.user, document)) {
            return res.status(403).json({ message: "You do not have access to this document" });
        }

<<<<<<< HEAD
<<<<<<< HEAD
        // gọi service xử lý
        const result = processDocument(req.file.path);
        res.json({
            message: "Upload OK",
            file: req.file.path,
            documentInfo: result
        });
    });
};
=======
=======
>>>>>>> 23a197e01f4b73f3ec366b487282b0512f2d57f0
        res.json(document);
    } catch (error) {
        safeError(res, error);
    }
};

// ---------------------------------------------------------------------------
// Tải file
// ---------------------------------------------------------------------------

/** Tải PDF gốc của hồ sơ */
export const downloadDocumentFile = async (req, res) => {
    try {
        const document = await getDocument(req.params.documentId);

        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        if (!canAccessDocument(req.user, document)) {
            return res.status(403).json({ message: "You do not have access to this document" });
        }

        const fileInfo = await getDocumentFile(req.params.documentId);
        if (!fileInfo) {
            return res.status(404).json({ message: "File not found" });
        }

        // Validate path to prevent traversal
        let safePath;
        try {
            safePath = validateFilePath(fileInfo.filePath, uploadDirectory);
        } catch {
            return res.status(403).json({ message: "Invalid file path" });
        }

        if (!fs.existsSync(safePath)) {
            return res.status(404).json({ message: "File not found" });
        }

        res.download(safePath, fileInfo.fileName);
    } catch (error) {
        safeError(res, error);
    }
};

/** Tải PDF đã ký: cho phép qua JWT session hoặc verification token */
export const downloadSignedDocument = async (req, res) => {
    try {
        const document = await getDocument(req.params.documentId);

        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        const providedToken = req.query.token;
        const tokenAllowed = typeof providedToken === "string"
            ? (await verifyDocument({
                documentId: req.params.documentId,
                token: providedToken,
                userId: "signed-pdf-download",
                ipAddress: req.ip
            })).valid
            : false;

        if (!tokenAllowed && !canAccessDocument(req.user, document)) {
            return res.status(req.user ? 403 : 401).json({
                message: "A valid login session or verification token is required"
            });
        }

        const signedFile = await getSignedDocumentFile(req.params.documentId);

        if (!signedFile) {
            return res.status(404).json({ message: "Signed PDF not found" });
        }

        // Validate path to prevent traversal
        let safePath;
        try {
            safePath = validateFilePath(signedFile.filePath, uploadDirectory);
        } catch {
            return res.status(403).json({ message: "Invalid file path" });
        }

        if (!fs.existsSync(safePath)) {
            return res.status(404).json({ message: "Signed PDF not found" });
        }

        // Kiểm tra tính toàn vẹn: so sánh hash hiện tại với hash lúc ký
        const currentHash = await hashFile(safePath);
        if (currentHash !== document.file_hash) {
            return res.status(403).json({
                message: "Download denied: PDF was modified after signing. Please contact the authority.",
                tampered: true
            });
        }

        res.download(safePath, signedFile.fileName);
    } catch (error) {
        safeError(res, error);
    }
};

/** Tải file PDF xem trước (chỉ chủ sở hữu hoặc officer/admin) */
export const downloadPreviewDocument = async (req, res) => {
    try {
        const preview = await getPreviewById(req.params.previewId);

        if (!preview) {
            return res.status(404).json({ message: "Preview not found" });
        }

        const previewOwnerId = preview.owner_id ? String(preview.owner_id) : null;
        const isOwner = previewOwnerId && String(req.user?.id) === previewOwnerId;

        if (!isOwner && !canManageAllDocuments(req.user)) {
            return res.status(403).json({ message: "You do not have access to this preview" });
        }

        if (!preview.preview_path) {
            return res.status(404).json({ message: "Preview file not found" });
        }

        // Validate path to prevent traversal attacks
        let safePath;
        try {
            safePath = validateFilePath(preview.preview_path, uploadDirectory);
        } catch {
            return res.status(403).json({ message: "Invalid file path" });
        }

        if (!fs.existsSync(safePath)) {
            return res.status(404).json({ message: "Preview file not found" });
        }

        res.sendFile(safePath);
    } catch (error) {
        safeError(res, error);
    }
};

// ---------------------------------------------------------------------------
// Xác minh tài liệu
// ---------------------------------------------------------------------------

/** Xác minh qua QR: truyền documentId + token trên URL */
export const verifyDocumentByQr = async (req, res) => {
    try {
        const result = await verifyDocument({
            documentId: req.params.documentId,
            token: req.query.token,
            userId: req.user?.id ? String(req.user.id) : null,
            ipAddress: req.ip
        });
        res.status(result.valid ? 200 : 400).json(result);
    } catch (error) {
        safeError(res, error);
    }
};

/** Xác minh qua upload PDF: so sánh hash file upload với hash đã ký */
export const verifyDocumentByUpload = (req, res) => {
    upload.single("file")(req, res, async function (err) {
        if (err) {
            return res.status(400).json({ message: err.message || "Upload error" });
        }
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }
        try {
            const result = await verifyDocument({
                documentId: req.params.documentId,
                token: req.body.token || req.query.token,
                filePath: req.file.path,
                userId: req.user?.id ? String(req.user.id) : null,
                ipAddress: req.ip
            });
            res.status(result.valid ? 200 : 400).json(result);
        } catch (error) {
            safeError(res, error);
        }
    });
};

// ---------------------------------------------------------------------------
// Upload (DEPRECATED - use preview + submit + sign flow instead)
// ---------------------------------------------------------------------------

/** @deprecated Use previewDocument → submitDocumentHandler → signDocumentHandler */
export const uploadDocument = (req, res) => {
    console.warn("[deprecated] POST /upload is deprecated. Use preview → submit → sign flow.");
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
                ownerId: req.user?.id ? String(req.user.id) : "demo-citizen",
                ipAddress: req.ip
            });
            res.status(201).json({
                message: "Upload, hash, digital signature and signed PDF OK",
                file: req.file.path,
                documentInfo: result
            });
        } catch (error) {
            safeError(res, error);
        }
    });
};

// ---------------------------------------------------------------------------
// Issue (DEPRECATED - use preview + submit + sign flow instead)
// ---------------------------------------------------------------------------

/** @deprecated Use submitDocumentHandler → signDocumentHandler */
export const issueDocument = async (req, res) => {
    console.warn("[deprecated] POST /issue is deprecated. Use submit → sign flow.");
    try {
        const preview = await getPreviewById(req.body.preview_id);

        if (!preview) {
            return res.status(404).json({ message: "Preview not found" });
        }

        if (preview.expired_at && new Date(preview.expired_at) < new Date()) {
            return res.status(400).json({ message: "Preview expired" });
        }

        if (!preview.preview_path || !fs.existsSync(preview.preview_path)) {
            return res.status(400).json({ message: "Preview file not found" });
        }

        // Submit then sign immediately (legacy flow)
        await submitDocument({
            documentId: preview.document_id,
            filePath: preview.preview_path,
            originalName: "CT01.pdf",
            ownerId: preview.owner_id || (req.user?.id ? String(req.user.id) : "officer"),
            ipAddress: req.ip
        });

        const result = await signDocument({
            documentId: preview.document_id,
            officerId: req.user?.id ? String(req.user.id) : "officer",
            ipAddress: req.ip
        });

        res.status(201).json({
            message: "Document issued successfully",
            documentInfo: result
        });
    } catch (error) {
        safeError(res, error);
    }
};
<<<<<<< HEAD
>>>>>>> origin/develop
=======
>>>>>>> 23a197e01f4b73f3ec366b487282b0512f2d57f0
