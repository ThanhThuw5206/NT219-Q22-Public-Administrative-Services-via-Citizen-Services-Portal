import express from "express";
import { registerHandler, loginHandler, meHandler } from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/register", registerHandler);
router.post("/login", loginHandler);
router.get("/me", authenticate, meHandler);

export default router;
