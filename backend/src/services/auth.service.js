import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/env.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(__dirname, "../data");
const dataFilePath = path.join(dataDirectory, "users.json");

const readUsers = () => {
    fs.mkdirSync(dataDirectory, { recursive: true });
    if (!fs.existsSync(dataFilePath)) return [];
    return JSON.parse(fs.readFileSync(dataFilePath, "utf8"));
};

const writeUsers = (users) => {
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(dataFilePath, JSON.stringify(users, null, 2));
};

const nextId = () => {
    const users = readUsers();
    return users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
};

export const register = async ({ full_name, email, password }) => {
    const users = readUsers();

    if (users.find(u => u.email === email)) {
        throw new Error("Email already registered");
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = {
        id: nextId(),
        full_name,
        email,
        password_hash,
        roles: ["citizen"],
        status: "active",
        created_at: new Date().toISOString()
    };

    users.push(user);
    writeUsers(users);

    const token = jwt.sign(
        { id: user.id, email: user.email, full_name: user.full_name, roles: user.roles },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    return {
        token,
        user: { id: user.id, full_name: user.full_name, email: user.email, roles: user.roles }
    };
};

export const login = async ({ email, password }) => {
    const users = readUsers();
    const user = users.find(u => u.email === email && u.status === "active");

    if (!user) throw new Error("Invalid email or password");

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new Error("Invalid email or password");

    const token = jwt.sign(
        { id: user.id, email: user.email, full_name: user.full_name, roles: user.roles },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    return {
        token,
        user: { id: user.id, full_name: user.full_name, email: user.email, roles: user.roles }
    };
};

export const getUserById = (id) => {
    const users = readUsers();
    const user = users.find(u => u.id === id);
    if (!user) return null;
    const { password_hash, ...safe } = user;
    return safe;
};

// Seed default officer/admin account if no users exist
export const seedDefaultUsers = async () => {
    const users = readUsers();
    if (users.length > 0) return;

    const officerHash = await bcrypt.hash("officer123", 10);
    const adminHash = await bcrypt.hash("admin123", 10);

    users.push(
        {
            id: 1,
            full_name: "Can bo Nguyen",
            email: "officer@test.com",
            password_hash: officerHash,
            roles: ["officer"],
            status: "active",
            created_at: new Date().toISOString()
        },
        {
            id: 2,
            full_name: "Admin",
            email: "admin@test.com",
            password_hash: adminHash,
            roles: ["admin"],
            status: "active",
            created_at: new Date().toISOString()
        }
    );

    writeUsers(users);
    console.log("Seeded default users: officer@test.com / officer123, admin@test.com / admin123");
};
