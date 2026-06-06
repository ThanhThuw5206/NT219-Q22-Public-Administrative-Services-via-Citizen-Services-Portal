# Portal

The current `backend/` and `frontend/` folders are the legacy portal implementation.

During the rebuild, keep the existing folders in place to reduce churn, but document the logical portal boundary here:

- `backend/`: Express API, authentication, RBAC, document workflow.
- `frontend/`: static citizen/officer UI.

New signing code should call provider interfaces for remote TSP and client-side signing instead of using the legacy Falcon service directly.
