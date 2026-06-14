import crypto from "crypto";
import fs from "fs";
import path from "path";
import db from "../config/db.js";
import { DB_STORAGE_TYPE } from "../config/env.config.js";

const jsonFilePath = path.resolve("src/data/signing_challenges.json");
const isMySQL = DB_STORAGE_TYPE === "mysql";

function ensureJsonFile() {
    const dir = path.dirname(jsonFilePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(jsonFilePath)) {
        fs.writeFileSync(jsonFilePath, "[]", "utf8");
    }
}

function readJson() {
    ensureJsonFile();
    try {
        return JSON.parse(fs.readFileSync(jsonFilePath, "utf8") || "[]");
    } catch {
        return [];
    }
}

function writeJson(rows) {
    ensureJsonFile();
    fs.writeFileSync(jsonFilePath, JSON.stringify(rows, null, 2), "utf8");
}

const jsonRepo = {
    async createChallenge(record) {
        const rows = readJson();
        const saved = {
            challenge_id: record.challenge_id || crypto.randomUUID(),
            status: "pending",
            created_at: new Date().toISOString(),
            ...record,
        };
        rows.push(saved);
        writeJson(rows);
        return saved;
    },

    async findChallengeById(challengeId) {
        return readJson().find((row) => row.challenge_id === challengeId) || null;
    },

    async markChallengeUsed(challengeId) {
        const rows = readJson();
        const index = rows.findIndex((row) => row.challenge_id === challengeId);
        if (index === -1) return null;
        if (rows[index].status !== "pending") return null;
        rows[index] = {
            ...rows[index],
            status: "used",
            used_at: new Date().toISOString(),
        };
        writeJson(rows);
        return rows[index];
    },
};

const mysqlRepo = {
    async createChallenge(record) {
        const challengeId = record.challenge_id || crypto.randomUUID();
        const query = `
            INSERT INTO signing_challenges (
                challenge_id, document_id, officer_id, key_id, payload_json,
                payload_hash, nonce, status, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await db.query(query, [
            challengeId,
            record.document_id,
            record.officer_id,
            record.key_id,
            record.payload_json,
            record.payload_hash,
            record.nonce,
            record.status || "pending",
            record.expires_at ? new Date(record.expires_at) : null,
            record.created_at ? new Date(record.created_at) : new Date(),
        ]);
        return { ...record, challenge_id: challengeId };
    },

    async findChallengeById(challengeId) {
        const [rows] = await db.query(
            "SELECT * FROM signing_challenges WHERE challenge_id = ? LIMIT 1",
            [challengeId]
        );
        return rows[0] || null;
    },

    async markChallengeUsed(challengeId) {
        const [result] = await db.query(
            "UPDATE signing_challenges SET status = 'used', used_at = NOW() WHERE challenge_id = ? AND status = 'pending'",
            [challengeId]
        );
        if (result.affectedRows !== 1) return null;
        return this.findChallengeById(challengeId);
    },
};

const repo = isMySQL ? mysqlRepo : jsonRepo;

export const createChallenge = repo.createChallenge.bind(repo);
export const findChallengeById = repo.findChallengeById.bind(repo);
export const markChallengeUsed = repo.markChallengeUsed.bind(repo);
