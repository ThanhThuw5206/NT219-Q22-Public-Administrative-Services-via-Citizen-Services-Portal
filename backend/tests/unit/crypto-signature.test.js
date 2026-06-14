import { describe, expect, it } from "vitest";
import {
    buildSignaturePayload,
    getActiveKey,
    signPayload,
    verifyPayloadSignature
} from "../../src/crypto/signature.service.js";
import { registerExternalPublicKeyForOwner } from "../../src/crypto/key-manager.service.js";

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

    it("includes signer and organization evidence in the canonical payload", async () => {
        const activeKey = await getActiveKey();
        const payload = buildSignaturePayload({
            documentId: "HS-TEST-EVIDENCE",
            fileHash: "d".repeat(64),
            issuedAt: "2026-05-24T00:00:00.000Z",
            keyId: activeKey.key_id,
            signer: {
                user_id: "12",
                full_name: "Can bo Nguyen",
                role: "officer"
            },
            organization: {
                organization_id: "PUBLIC-AUTHORITY-DEMO",
                name: "Demo Public Administrative Authority"
            },
            purpose: "Officer approval before public document issuance"
        });
        const parsed = JSON.parse(payload);

        expect(parsed.signer.full_name).toBe("Can bo Nguyen");
        expect(parsed.organization.organization_id).toBe("PUBLIC-AUTHORITY-DEMO");
        expect(parsed.purpose).toBe("Officer approval before public document issuance");
        expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    });

    it("rejects malformed external Falcon public keys", async () => {
        await expect(registerExternalPublicKeyForOwner({
            ownerType: "user",
            ownerId: "officer-test",
            ownerName: "Officer Test",
            publicKey: Buffer.from("too-short").toString("base64")
        })).rejects.toMatchObject({
            code: "INVALID_PUBLIC_KEY"
        });
    });
});
