import { register, login, getUserById } from "../services/auth.service.js";

export const registerHandler = async (req, res) => {
    try {
        const { full_name, email, password } = req.body;

        if (!full_name || !email || !password) {
            return res.status(400).json({ message: "full_name, email, password are required" });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters" });
        }

        const result = await register({ full_name, email, password });
        res.status(201).json({ message: "Registered successfully", data: result });
    } catch (error) {
        const status = error.message.includes("already registered") ? 409 : 500;
        res.status(status).json({ message: error.message });
    }
};

export const loginHandler = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "email and password are required" });
        }

        const result = await login({ email, password });
        res.json({ message: "Login successful", data: result });
    } catch (error) {
        res.status(401).json({ message: error.message });
    }
};

export const meHandler = (req, res) => {
    const user = getUserById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ data: user });
};
