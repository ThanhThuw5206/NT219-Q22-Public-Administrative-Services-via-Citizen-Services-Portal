import { hashText } from "../src/crypto/hash.service.js";

console.log("=== SHA256 TEST ===");

const hash = hashText("hello world");

console.log(hash);

console.log(
  hash ===
  "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    ? "SHA256 PASS"
    : "SHA256 FAIL"
);