# CA Infrastructure

Lab PKI assets for the rebuilt project.

Planned contents:

- `openssl/`: OpenSSL profiles and generated lab configuration.
- `softhsm/`: SoftHSM token setup notes.
- `ocsp/`: OCSP responder configuration and test data.
- `tsa/`: RFC 3161 timestamp authority configuration.
- `scripts/`: repeatable setup scripts.

Private keys and generated certificates must stay out of Git unless they are explicitly synthetic fixtures for tests.
