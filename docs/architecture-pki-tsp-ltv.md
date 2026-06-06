# PKI/TSP/LTV Architecture

## Scope

This branch rebuilds the project around a lab-grade digital-signature ecosystem:

- X.509 PKI with Root CA, Issuing CA, RA procedure, OCSP, CRL, and TSA.
- Citizen portal for public-administration document workflows.
- Remote signing through a TSP boundary backed by SoftHSM/PKCS#11.
- Client-side signing demo for citizen/officer certificates.
- Verification service with long-term validation evidence.

The legacy Falcon-512 QR/hash flow is not the target architecture.

## Main Components

```text
Citizen/Officer Browser
        |
        v
Portal Backend
  - authentication and RBAC
  - document workflow
  - signing request orchestration
        |
        +--> Client Agent
        |      - local certificate/key demo
        |      - PKCS#11/OpenSC path when available
        |
        +--> TSP Signing Service
        |      - request nonce and audit log
        |      - SoftHSM/PKCS#11 private-key boundary
        |
        +--> PKI Infrastructure
        |      - CA/RA
        |      - OCSP/CRL
        |      - TSA
        |
        v
Verifier/LTV Archive
  - signature verification
  - certificate-chain validation
  - timestamp validation
  - archived OCSP/CRL evidence
```

## Target Signing Flows

### Remote Signing

1. Portal creates a canonical document digest.
2. Portal creates a signing request with nonce and expiry.
3. Citizen/officer confirms the request with strong-auth mock.
4. TSP signs the digest using a key protected by SoftHSM/PKCS#11.
5. Portal stores the signature, signer certificate, audit record, timestamp, and revocation evidence.

### Client-Side Signing

1. Portal displays canonical signing data and digest.
2. Client agent signs the digest with the user's certificate/private key.
3. Portal receives signature plus certificate chain.
4. Verifier validates signature, chain, timestamp, and revocation evidence.

## Minimum Deliverable Format

The first practical target is:

- PDF document.
- Detached CMS/PKCS#7 signature (`.p7s`).
- JSON manifest referencing certificate chain, timestamp token, OCSP/CRL evidence, and audit event.

PAdES embedding can be added after this minimal bundle verifies end to end.
