import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../config/db.js";
import { JWT_SECRET, JWT_EXPIRES_IN, DB_STORAGE_TYPE } from "../config/env.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(__dirname, "../data");
const dataFilePath = path.join(dataDirectory, "users.json");

const isMySQL = DB_STORAGE_TYPE === "mysql";

// ==========================================
// CHẾ ĐỘ FILE JSON (Cũ của nhóm)
// ==========================================
const jsonAuth = {
    readUsers() {
        fs.mkdirSync(dataDirectory, { recursive: true });
        if (!fs.existsSync(dataFilePath)) return [];
        return JSON.parse(fs.readFileSync(dataFilePath, "utf8"));
    },
    writeUsers(users) {
        fs.mkdirSync(dataDirectory, { recursive: true });
        fs.writeFileSync(dataFilePath, JSON.stringify(users, null, 2));
    },
    nextId() {
        const users = this.readUsers();
        return users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
    },
    async register({ full_name, email, password }) {
        const users = this.readUsers();
        if (users.find(u => u.email === email)) {
            throw new Error("Email already registered");
        }
        const password_hash = await bcrypt.hash(password, 10);
        const newUser = {
            id: this.nextId(),
            full_name,
            email,
            password_hash,
            roles: ["citizen"],
            status: "active",
            created_at: new Date().toISOString()
        };
        users.push(newUser);
        this.writeUsers(users);
        const { password_hash: _, ...safe } = newUser;
        return safe;
    },
    async login({ email, password }) {
        const users = this.readUsers();
        const user = users.find(u => u.email === email);
        if (!user) throw new Error("Invalid email or password");
        if (user.status === "locked") throw new Error("Account is locked");
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) throw new Error("Invalid email or password");
        const token = jwt.sign(
            { id: user.id, email: user.email, full_name: user.full_name, roles: user.roles },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
        return {
            token,
            user: { id: user.id, full_name: user.full_name, email: user.email, roles: user.roles }
        };
    },
    async getUserById(id) {
        const users = this.readUsers();
        // Ép kiểu ép về số hoặc chuỗi để so sánh chính xác tùy thuộc vào dữ liệu đầu vào
        const user = users.find(u => u.id === Number(id) || u.id === id);
        if (!user) return null;
        
        const { password_hash, ...safe } = user;
        return safe;
    },
    async seedDefaultUsers() {
        const users = this.readUsers();
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
                full_name: "Quan Tri Vien",
                email: "admin@test.com",
                password_hash: adminHash,
                roles: ["admin"],
                status: "active",
                created_at: new Date().toISOString()
            }
        );
        this.writeUsers(users);
    }
};

// ==========================================
// CHẾ ĐỘ DATABASE MYSQL (Nâng cấp)
// ==========================================
const mysqlAuth = {
    async register({ full_name, email, password }) {
        const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
        if (existing.length > 0) {
            throw new Error("Email already registered");
        }
        const password_hash = await bcrypt.hash(password, 10);
        const [userResult] = await db.query(
            "INSERT INTO users (full_name, email, password_hash, status) VALUES (?, ?, ?, 'active')",
            [full_name, email, password_hash]
        );
        const userId = userResult.insertId;
        const [roleRows] = await db.query("SELECT role_id FROM roles WHERE role_name = 'citizen'");
        if (roleRows.length > 0) {
            await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleRows[0].role_id]);
        }
        return { id: userId, full_name, email, roles: ["citizen"] };
    },
    async login({ email, password }) {
        const query = `
            SELECT u.*, GROUP_CONCAT(r.role_name) as roles_list
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.role_id
            WHERE u.email = ?
            GROUP BY u.id
        `;
        const [rows] = await db.query(query, [email]);
        if (rows.length === 0) throw new Error("Invalid email or password");
        const user = rows[0];
        if (user.status === "locked") throw new Error("Account is locked");
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) throw new Error("Invalid email or password");
        const roles = user.roles_list ? user.roles_list.split(",") : [];
        const token = jwt.sign(
            { id: user.id, email: user.email, full_name: user.full_name, roles },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
        return {
            token,
            user: { id: user.id, full_name: user.full_name, email: user.email, roles }
        };
    },
    async getUserById(id) {
        const query = `
            SELECT u.id, u.full_name, u.email, GROUP_CONCAT(r.role_name) as roles_list
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.role_id
            WHERE u.id = ?
            GROUP BY u.id
        `;
        const [rows] = await db.query(query, [id]);
        if (rows.length === 0) return null;
        const user = rows[0];
        return {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            roles: user.roles_list ? user.roles_list.split(",") : []
        };
    },
    async seedDefaultUsers() {
        const [rows] = await db.query("SELECT id FROM users LIMIT 1");
        if (rows.length > 0) return;
        const officerHash = await bcrypt.hash("officer123", 10);
        const adminHash = await bcrypt.hash("admin123", 10);
        const [roles] = await db.query("SELECT * FROM roles");
        const roleMap = {};
        roles.forEach(r => { roleMap[r.role_name] = r.role_id; });
        const [oRes] = await db.query(
            "INSERT INTO users (full_name, email, password_hash, status) VALUES (?, ?, ?, 'active')",
            ["Can bo Nguyen", "officer@test.com", officerHash]
        );
        if (roleMap["officer"]) {
            await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [oRes.insertId, roleMap["officer"]]);
        }
        const [aRes] = await db.query(
            "INSERT INTO users (full_name, email, password_hash, status) VALUES (?, ?, ?, 'active')",
            ["Quan Tri Vien", "admin@test.com", adminHash]
        );
        if (roleMap["admin"]) {
            await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [aRes.insertId, roleMap["admin"]]);
        }
    }
};

// Xuất khẩu cầu nối điều hướng
export const register = isMySQL ? mysqlAuth.register : jsonAuth.register;
export const login = isMySQL ? mysqlAuth.login : jsonAuth.login;
export const getUserById = isMySQL ? mysqlAuth.getUserById : jsonAuth.getUserById;
export const seedDefaultUsers = isMySQL ? mysqlAuth.seedDefaultUsers : jsonAuth.seedDefaultUsers;