import express from "express";

<<<<<<< HEAD
import { uploadDocument } from "../controllers/document.controller.js";
=======
import {
    downloadSignedDocument,
    downloadDocumentFile,
    getDocumentDetail,
    listDocumentDetails,
    listPendingDocuments,
    listIssuedDocuments,
    listRejectedDocuments,
    uploadDocument,
    verifyDocumentByQr,
    verifyDocumentByUpload,
    previewDocument,
    downloadPreviewDocument,
    issueDocument,
    submitDocumentHandler,
    signDocumentHandler,
    rejectDocumentHandler
} from "../controllers/document.controller.js";
>>>>>>> origin/develop

import { authenticate, optionalAuthenticate } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

const router = express.Router();

<<<<<<< HEAD
router.post("/upload", uploadDocument);
=======
// Public verification/download endpoints. Keep these before dynamic detail routes.
router.get("/verify/:documentId", verifyDocumentByQr);
router.post("/verify/:documentId", verifyDocumentByUpload);
router.get("/:documentId/signed-pdf", optionalAuthenticate, downloadSignedDocument);

// Citizen (authenticated)
router.get("/", authenticate, listDocumentDetails);
router.post("/preview", authenticate, previewDocument);
router.get("/previews/:previewId/file", authenticate, downloadPreviewDocument);
router.post("/submit", authenticate, submitDocumentHandler);
router.get("/:documentId/download", authenticate, downloadDocumentFile);

// Officer/Admin (authenticated + role)
router.get("/pending", authenticate, requireRole("officer", "admin"), listPendingDocuments);
router.get("/issued", authenticate, requireRole("officer", "admin"), listIssuedDocuments);
router.get("/rejected", authenticate, requireRole("officer", "admin"), listRejectedDocuments);
router.post("/upload", authenticate, requireRole("officer", "admin"), uploadDocument);
router.post("/:documentId/sign", authenticate, requireRole("officer", "admin"), signDocumentHandler);
router.post("/:documentId/reject", authenticate, requireRole("officer", "admin"), rejectDocumentHandler);

// Authenticated detail route must stay after fixed routes such as /pending.
router.get("/:documentId", authenticate, getDocumentDetail);

// Legacy
router.post("/issue", authenticate, requireRole("officer", "admin"), issueDocument);
>>>>>>> origin/develop

export default router;