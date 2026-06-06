# Verifier

Verification and LTV archive module.

The verifier should validate:

- document hash/integrity;
- CMS/PAdES/CAdES signature;
- signer certificate chain;
- OCSP/CRL status;
- RFC 3161 timestamp token;
- archived evidence bundle for offline verification.
