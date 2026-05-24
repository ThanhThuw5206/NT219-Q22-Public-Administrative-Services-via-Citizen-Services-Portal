
import express from "express";

import {
    downloadSignedDocument,
    downloadDocumentFile,
    getDocumentDetail,
    listDocumentDetails,
    listPendingDocuments,
    listIssuedDocuments,
    uploadDocument,
    verifyDocumentByQr,
    verifyDocumentByUpload,
    previewDocument,
    issueDocument,
    submitDocumentHandler,
    signDocumentHandler
} from "../controllers/document.controller.js";

import { authenticate } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

const router = express.Router();

// Public
router.get("/", listDocumentDetails);
router.get("/verify/:documentId", verifyDocumentByQr);
router.post("/verify/:documentId", verifyDocumentByUpload);
router.get("/:documentId/signed-pdf", downloadSignedDocument);
router.get("/:documentId", getDocumentDetail);

// Citizen (authenticated)
router.post("/preview", authenticate, previewDocument);
router.post("/submit", authenticate, submitDocumentHandler);
router.post("/upload", authenticate, uploadDocument);
router.get("/:documentId/download", authenticate, downloadDocumentFile);

// Officer/Admin (authenticated + role)
router.get("/pending", authenticate, requireRole("officer", "admin"), listPendingDocuments);
router.get("/issued", authenticate, requireRole("officer", "admin"), listIssuedDocuments);
router.post("/:documentId/sign", authenticate, requireRole("officer", "admin"), signDocumentHandler);

// Legacy
router.post("/issue", authenticate, issueDocument);

export default router;
