# Verifier API

Planned endpoints:

- `POST /verify/bundle`: verify a document plus signature bundle.
- `GET /documents/:id/verification-result`: read stored verification status.

Responses should return structured reasons such as `VALID`, `TAMPERED_DOCUMENT`, `INVALID_CHAIN`, `CERT_REVOKED`, `TIMESTAMP_INVALID`, and `MISSING_LTV_EVIDENCE`.
