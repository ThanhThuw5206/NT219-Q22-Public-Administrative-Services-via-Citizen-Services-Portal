/**
 * Crypto Zone Routes — internal signing API.
 *
 * Mounted at `/api/internal/crypto` in `server.js` with
 * `requireCryptoZoneAccess` middleware already applied at the mount level,
 * so all routes here are protected by the crypto zone secret header.
 *
 * Endpoints:
 *   GET  /public-key  — active Falcon-512 public key metadata
 *   POST /sign        — sign a payload with the active key
 *   POST /verify      — verify a signature against a public key
 *
 * Related: Requirements 9.4, 9.10, 12.11, 12.12, 12.13.
 */

import express from "express";

import {
    cryptoGetPublicKey,
    cryptoSign,
    cryptoVerify,
} from "../controllers/crypto.controller.js";

const router = express.Router();

router.get("/public-key", cryptoGetPublicKey);
router.post("/sign", cryptoSign);
router.post("/verify", cryptoVerify);

export default router;
