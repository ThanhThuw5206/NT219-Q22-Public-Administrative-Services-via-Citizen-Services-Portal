import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.config.js";

export const authenticate = (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Missing or invalid token" });
    }

    try {
        const token = header.slice(7);
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = {
            id: payload.id,
            email: payload.email,
            full_name: payload.full_name,
            roles: payload.roles || []
        };
        next();
    } catch {
        return res.status(401).json({ message: "Invalid or expired token" });
    }
};

export const optionalAuthenticate = (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return next();
    }

    try {
        const token = header.slice(7);
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = {
            id: payload.id,
            email: payload.email,
            full_name: payload.full_name,
            roles: payload.roles || []
        };
    } catch {
        // Public endpoints may also accept a verification token. Treat a bad
        // Authorization header as anonymous instead of failing before token
        // access is checked by the controller.
    }

    next();
};
