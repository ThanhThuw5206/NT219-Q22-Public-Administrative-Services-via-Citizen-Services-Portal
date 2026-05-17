import express from "express";

import { getCryptoPublicKey } from "../controllers/network.controller.js";

const router = express.Router();

router.get("/public-key", getCryptoPublicKey);

export default router;
