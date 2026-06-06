# SoftHSM

SoftHSM is the lab replacement for a real HSM.

The TSP signing service should use this boundary for private-key operations instead of storing signing keys in the application database or repository.

Planned setup:

- Initialize a token for the TSP.
- Generate or import a signing key.
- Export only the public certificate chain.
- Configure the TSP service with token label, slot, key label, and PIN through environment variables.
