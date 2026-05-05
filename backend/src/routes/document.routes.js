import express from "express";
import { uploadDocument } from "../controllers/document.controller.js";

const router = express.Router();

router.post("/upload", uploadDocument);

export default router;