import express from "express";

import {
    downloadSignedDocument,
    getDocumentDetail,
    listDocumentDetails,
    uploadDocument,
    verifyDocumentByQr,
    verifyDocumentByUpload
} from "../controllers/document.controller.js";

const router = express.Router();

router.get("/", listDocumentDetails);
router.post("/upload", uploadDocument);
router.get("/verify/:documentId", verifyDocumentByQr);
router.post("/verify/:documentId", verifyDocumentByUpload);
router.get("/:documentId/signed-pdf", downloadSignedDocument);
router.get("/:documentId", getDocumentDetail);

export default router;
