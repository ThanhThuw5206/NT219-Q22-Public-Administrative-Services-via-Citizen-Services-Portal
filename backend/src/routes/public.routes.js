import express from "express";

import {
    verifyDocumentByQr,
    verifyDocumentByUpload
} from "../controllers/document.controller.js";
import { getNetworkModel } from "../controllers/network.controller.js";

const router = express.Router();

router.get("/network-model", getNetworkModel);
router.get("/documents/verify/:documentId", verifyDocumentByQr);
router.post("/documents/verify/:documentId", verifyDocumentByUpload);

export default router;
