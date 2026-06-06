# Client Agents

Client-side signing demo area.

Minimum acceptable demo:

- portal provides canonical signing data and digest;
- client agent signs digest with a lab certificate/private key;
- portal uploads signature and certificate chain;
- verifier validates the result.

Stretch target:

- OpenSC/PKCS#11 integration with a real smartcard or USB token.
