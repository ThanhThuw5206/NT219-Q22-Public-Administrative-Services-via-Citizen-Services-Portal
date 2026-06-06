# TSP Signing Service

Planned API:

- `POST /signing-requests`: create a request for a document digest.
- `POST /signing-requests/:id/confirm`: confirm with strong-auth mock.
- `GET /signing-requests/:id`: inspect request status.

Security requirements:

- reject replayed nonces;
- reject expired requests;
- never expose private keys;
- record actor, digest, nonce, certificate serial, timestamp, and result.
