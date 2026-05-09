# NT219-Q22 Public Administrative Services Portal

Backend demo cho luong xac thuc tai lieu PDF bang SHA-256, chu ky so theo adapter Falcon, QR payload, token xac minh va mo hinh mang 4 zone.

## Chay backend

```bash
cd backend
npm install
npm run dev
```

Server mac dinh: `http://localhost:3000`

## Mo hinh mang

Tai lieu chi tiet: [docs/network-model.md](docs/network-model.md)

Backend da tach route theo 4 vung:

| Zone | Route / module |
| --- | --- |
| Public Zone | `/api/public/*` |
| Application Zone | `/api/app/documents/*` |
| Crypto Zone | `/api/internal/crypto/*`, `backend/src/crypto/*` |
| Data Zone | `backend/src/data`, `backend/src/uploads`, `document.repository.js` |

Route cu `/api/documents/*` van duoc giu de tuong thich, nhung route dung theo mo hinh la `/api/app/documents/*`.

## Luong ky so Falcon

Khi upload PDF, backend se:

1. Tao `document_id`.
2. Tao token xac minh ngau nhien cho QR.
3. Tinh SHA-256 tren file PDF cuoi cung duoc luu.
4. Tao payload ky gom `document_id`, `file_hash`, `issued_at`, `key_id`, `version`.
5. Ky payload qua `backend/src/crypto/signature.service.js`.
6. Luu metadata gom hash, signature, public key, token hash va audit log.

Luu y: repo hien chua co thu vien Falcon native. `backend/src/crypto/signature.service.js` da setup interface voi `algorithm: FALCON-512`, nhung provider demo dang dung Ed25519 cua Node.js va ghi ro `signature_provider: demo-ed25519-adapter` de he thong chay duoc. Khi co thu vien Falcon/HSM, chi can thay ham `signPayload` va `verifyPayloadSignature`, cac API nghiep vu khong doi.

## API chinh

### Upload va ky PDF

`POST /api/app/documents/upload`

Body `form-data`:

- `file`: PDF
- `owner_id`: optional

Ket qua tra ve:

- `document_id`
- `file_hash`
- `signature`
- `algorithm`
- `public_key_id`
- `qr_payload` gom `document_id`, `verify_url`, `token`

### Xac minh bang QR/token

`GET /api/public/documents/verify/:documentId?token=...`

Endpoint nay kiem tra token va chu ky tren ban ghi da phat hanh.

### Xac minh bang upload PDF

`POST /api/public/documents/verify/:documentId`

Body `form-data`:

- `file`: PDF can kiem tra
- `token`: token trong QR payload

Endpoint nay tinh lai SHA-256 cua PDF upload, dung public key de verify signature va tra ve:

- `valid`
- `hash_matched`
- `signature_valid`
- `reason`

### Xem public key cua Crypto Zone

`GET /api/internal/crypto/public-key`

Header bat buoc:

- `x-internal-crypto-secret: change-this-crypto-zone-secret`

Trong production, doi gia tri nay bang bien moi truong `INTERNAL_CRYPTO_SECRET`.

## File runtime

Backend tao cac file runtime sau va da duoc dua vao `.gitignore`:

- `backend/src/uploads/`
- `backend/src/data/documents.json`
- `backend/src/crypto/keys/falcon-demo-keypair.json`

Trong ban production, private key Falcon phai nam trong Key Vault/HSM, khong luu trong source code hoac database.
