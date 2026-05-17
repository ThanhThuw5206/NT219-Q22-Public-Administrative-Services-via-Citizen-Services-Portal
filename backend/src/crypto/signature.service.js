import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyDirectory = path.resolve(__dirname, "keys");
const keyFilePath = path.join(keyDirectory, "falcon-demo-keypair.json");

const SIGNATURE_ALGORITHM = "FALCON-512";
const PROVIDER = "demo-ed25519-adapter";
const ACTIVE_KEY_ID = "falcon-demo-key-001";

const ensureDemoKeyPair = () => {
    fs.mkdirSync(keyDirectory, { recursive: true });

    if (fs.existsSync(keyFilePath)) {
        return JSON.parse(fs.readFileSync(keyFilePath, "utf8"));
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });

    const keyPair = {
        key_id: ACTIVE_KEY_ID,
        algorithm: SIGNATURE_ALGORITHM,
        provider: PROVIDER,
        status: "active",
        public_key: publicKey,
        private_key: privateKey,
        created_at: new Date().toISOString()
    };

    fs.writeFileSync(keyFilePath, JSON.stringify(keyPair, null, 2));
    return keyPair;
};

export const getActiveKey = () => {
    const keyPair = ensureDemoKeyPair();

    return {
        key_id: keyPair.key_id,
        algorithm: keyPair.algorithm,
        provider: keyPair.provider,
        status: keyPair.status,
        public_key: keyPair.public_key,
        created_at: keyPair.created_at
    };
};

export const buildSignaturePayload = ({ documentId, fileHash, issuedAt, keyId, version = 1 }) => {
    return JSON.stringify({
        document_id: documentId,
        file_hash: fileHash,
        issued_at: issuedAt,
        key_id: keyId,
        version
    });
};

export const signPayload = (payload) => {
    const keyPair = ensureDemoKeyPair();
    const signature = crypto.sign(null, Buffer.from(payload, "utf8"), keyPair.private_key);

    return {
        signature: signature.toString("base64"),
        key_id: keyPair.key_id,
        algorithm: keyPair.algorithm,
        provider: keyPair.provider
    };
};

export const verifyPayloadSignature = ({ payload, signature, publicKey }) => {
    return crypto.verify(
        null,
        Buffer.from(payload, "utf8"),
        publicKey,
        Buffer.from(signature, "base64")
    );
};
