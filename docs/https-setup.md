# HTTPS setup

## 1. Create a local certificate

For quick local testing with OpenSSL:

```powershell
mkdir backend\certs
openssl req -x509 -newkey rsa:2048 -nodes `
  -keyout backend\certs\localhost-key.pem `
  -out backend\certs\localhost-cert.pem `
  -days 365 `
  -subj "/CN=localhost"
```

The browser will warn because this is self-signed. For a smoother local setup,
use a trusted development certificate tool such as `mkcert`.

## 2. Configure backend/.env

```env
PORT=3000
HTTPS_KEY_PATH=backend/certs/localhost-key.pem
HTTPS_CERT_PATH=backend/certs/localhost-cert.pem
PUBLIC_VERIFY_URL=https://localhost:3000/api/public/documents/verify
CORS_ORIGINS=https://localhost:3000,https://127.0.0.1:3000
```

If `HTTPS_KEY_PATH` or `HTTPS_CERT_PATH` is empty, the backend falls back to HTTP.

## 3. Start the backend

```powershell
cd backend
npm run dev
```

Open:

```text
https://localhost:3000
```

## Production note

In production, prefer terminating HTTPS at Nginx, Apache, a load balancer, or a cloud proxy, then forward traffic to this Node.js app over an internal network. Set `PUBLIC_VERIFY_URL` to the public HTTPS domain, for example:

```env
PUBLIC_VERIFY_URL=https://example.gov.vn/api/public/documents/verify
CORS_ORIGINS=https://example.gov.vn
```
