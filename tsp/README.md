# TSP

Remote signing boundary for the project.

The TSP must be treated as a separate trust component from the portal:

- accepts signing requests with nonce and expiry;
- performs strong-auth mock before signing;
- signs using SoftHSM/PKCS#11;
- logs every request and result;
- returns signature, signer certificate reference, and audit event id.
