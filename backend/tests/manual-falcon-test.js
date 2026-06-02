import {
  generateKeyPair,
  sign,
  verify
} from "../src/crypto/falcon/falcon.adapter.js";

console.log("=== FALCON TEST ===");

const kp = await generateKeyPair();

console.log("Public Key Length:", kp.publicKey.length);
console.log("Private Key Length:", kp.privateKey.length);

const message =
  new TextEncoder().encode("hello world");

const signature =
  await sign(message, kp.privateKey);

console.log("Signature Length:", signature.length);

const ok =
  await verify(
    message,
    signature,
    kp.publicKey
  );

console.log("Verify:", ok);