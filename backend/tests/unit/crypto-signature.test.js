import { describe, expect, it } from "vitest";
import {
    buildSignaturePayload,
    getActiveKey,
    signPayload,
    verifyPayloadSignature
} from "../../src/crypto/signature.service.js";

describe("Falcon-512 signature flow", () => {
    it("signs and verifies a canonical document payload", async () => {
        const activeKey = await getActiveKey();
        const payload = buildSignaturePayload({
            documentId: "HS-TEST-CRYPTO",
            fileHash: "a".repeat(64),
            issuedAt: "2026-05-24T00:00:00.000Z",
            keyId: activeKey.key_id
        });

        const signatureInfo = await signPayload(payload);
        const valid = await verifyPayloadSignature({
            payload,
            signature: signatureInfo.signature,
            publicKey: activeKey.public_key
        });

        expect(signatureInfo.algorithm).toBe("FALCON-512");
        expect(valid).toBe(true);
    });

    it("rejects a tampered payload", async () => {
        const activeKey = await getActiveKey();
        const payload = buildSignaturePayload({
            documentId: "HS-TEST-CRYPTO",
            fileHash: "b".repeat(64),
            issuedAt: "2026-05-24T00:00:00.000Z",
            keyId: activeKey.key_id
        });
        const tamperedPayload = buildSignaturePayload({
            documentId: "HS-TEST-CRYPTO",
            fileHash: "c".repeat(64),
            issuedAt: "2026-05-24T00:00:00.000Z",
            keyId: activeKey.key_id
        });

        const signatureInfo = await signPayload(payload);
        const valid = await verifyPayloadSignature({
            payload: tamperedPayload,
            signature: signatureInfo.signature,
            publicKey: activeKey.public_key
        });

        expect(valid).toBe(false);
    });
});
