# NT219-Q22 Public Administrative Services Portal

Hệ thống phát hành, ký số và xác minh tài liệu hành chính công sử dụng thuật toán post-quantum Falcon-512.

---

## Luồng xử lý

### Flow A — Upload PDF có sẵn

```text
Client upload PDF
    ↓
POST /api/app/documents/upload  (multipart/form-data)
    ↓
Backend:
    - generate document_id (HS-{year}-{uuid})
    - move file gốc → storage/{document_id}/original.pdf
    - generate verification token (32-byte random)
    - generate QR chứa { document_id, verify_url, token }
    - embed QR + metadata box vào trang cuối PDF → signed.pdf
    - SHA-256 hash signed.pdf
    - Falcon-512 sign canonical payload
    - lưu metadata + audit log
    ↓
Trả: { document_id, file_hash, signature, verify_url, signed_pdf_url }
```

### Flow B — Form-filling từ template CT01

```text
Client nhập form (đăng ký tạm trú)
    ↓
POST /api/app/documents/preview
    ↓
Backend:
    - validate dữ liệu (ct01.validator.js)
    - render PDF từ template CT01 + font Roboto
    - lưu preview → storage/documents/{document_id}/preview.pdf
    - lưu metadata preview → previews.json
    ↓
Trả: { preview_id, document_id, preview_url }
    ↓
Client xem preview, bấm xác nhận
    ↓
POST /api/app/documents/issue  { preview_id, owner_id }
    ↓
Backend:
    - lấy preview từ DB, kiểm tra hết hạn (15 phút)
    - gọi processDocument với document_id từ preview
    - generate token → generate QR → embed QR + metadata → hash → Falcon sign
    ↓
Trả: { document_id, file_hash, signature, verify_url, signed_pdf_url }
```

---

## Cài đặt

```bash
cd backend
npm install
```

Tạo file `.env` từ `.env.example`:

```bash
cp .env.example .env
```

Chạy server:

```bash
npm run dev        # development (nodemon)
npm run start      # production
```

Server mặc định: `http://localhost:3000`

---

## API Endpoints

### Application Zone — `/api/app/documents`

| Method | Path | Mô tả |
|--------|------|-------|
| `POST` | `/preview` | Tạo preview PDF từ form data (template CT01) |
| `POST` | `/issue` | Ký số và phát hành tài liệu từ preview |
| `POST` | `/upload` | Upload PDF có sẵn và ký số |
| `GET` | `/` | Liệt kê tất cả tài liệu |
| `GET` | `/:documentId` | Xem chi tiết tài liệu |
| `GET` | `/:documentId/signed-pdf` | Tải PDF đã ký |
| `GET` | `/verify/:documentId?token=...` | Xác minh bằng QR token |
| `POST` | `/verify/:documentId` | Xác minh bằng upload PDF + token |

### Public Zone — `/api/public`

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/network-model` | Thông tin kiến trúc phân vùng mạng |
| `GET` | `/documents/verify/:documentId?token=...` | Xác minh tài liệu (công khai) |
| `POST` | `/documents/verify/:documentId` | Xác minh bằng upload PDF |

### Crypto Zone — `/api/internal/crypto`

Bảo vệ bằng header `x-internal-crypto-secret`.

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/public-key` | Lấy public key Falcon-512 đang active |
| `POST` | `/sign` | Ký payload bằng Falcon-512 |
| `POST` | `/verify` | Xác minh chữ ký Falcon-512 |

---

## Request / Response Examples

### 1. Preview PDF

```http
POST /api/app/documents/preview
Content-Type: application/json
```

```json
{
    "owner_id": 1,
    "office_name": "Công an phường Linh Trung",
    "full_name": "Nguyễn Văn A",
    "birth_day": "01",
    "birth_month": "01",
    "birth_year": "2000",
    "gender": "Nam",
    "citizen_id": "079203123456",
    "phone": "0909999999",
    "email": "nguyenvana@gmail.com",
    "householder_name": "Nguyễn Văn B",
    "householder_id": "079203654321",
    "relationship": "người thuê",
    "request_content": "Đăng ký tạm trú phục vụ học tập tại UIT"
}
```

Response:

```json
{
    "message": "Preview generated",
    "data": {
        "preview_id": "7e75199a-4bd3-4b3f-94e9-fc47a4df5a84",
        "document_id": "HS-2026-E406855E",
        "preview_url": "/storage/documents/HS-2026-E406855E/preview.pdf",
        "form_data": { ... }
    }
}
```

### 2. Issue tài liệu và ký số

```http
POST /api/app/documents/issue
Content-Type: application/json
```

```json
{
    "preview_id": "7e75199a-4bd3-4b3f-94e9-fc47a4df5a84",
    "owner_id": 1
}
```

Response:

```json
{
    "message": "Document issued successfully",
    "documentInfo": {
        "document_id": "HS-2026-DF25B570",
        "file_hash": "a8cf0930c38647efb4cced489c8537c6fa0bd59e...",
        "signature": "OZRc8pVrgEdpjlO9xGMmvtnxc74EeNE7...",
        "algorithm": "FALCON-512",
        "signature_provider": "crypto-zone",
        "public_key_id": "falcon-development-key-02597ccf",
        "verify_url": "http://localhost:3000/api/public/documents/verify/HS-2026-DF25B570?token=...",
        "qr_payload": {
            "document_id": "HS-2026-DF25B570",
            "verify_url": "http://localhost:3000/api/public/documents/verify/HS-2026-DF25B570?token=...",
            "token": "KfqH5dg1RzCK5QHEDQXipES7FEROOSZ5hRCzhwHo07k"
        },
        "signed_pdf_url": "/api/app/documents/HS-2026-DF25B570/signed-pdf",
        "status": "issued",
        "signed_at": "2026-05-23T16:21:18.157Z"
    }
}
```

### 3. Upload PDF và ký

```http
POST /api/app/documents/upload
Content-Type: multipart/form-data
```

| Field | Type | Required | Mô tả |
|-------|------|----------|-------|
| `file` | PDF | Yes | File PDF cần ký |
| `owner_id` | Text | No | ID người sở hữu |

### 4. Tải PDF đã ký

```http
GET /api/app/documents/:documentId/signed-pdf
```

Trả về file PDF đã được nhúng QR và metadata ký số.

### 5. Xác minh bằng QR/token

```http
GET /api/public/documents/verify/:documentId?token=...
```

Response:

```json
{
    "valid": true,
    "reason": "VALID_DOCUMENT",
    "document_id": "HS-2026-DF25B570",
    "file_hash": "a8cf0930c38647efb4cced489c8537c6fa0bd59e...",
    "hash_matched": true,
    "signature_valid": true,
    "algorithm": "FALCON-512",
    "status": "issued",
    "signed_at": "2026-05-23T16:21:18.157Z"
}
```

### 6. Xác minh bằng upload PDF

```http
POST /api/public/documents/verify/:documentId
Content-Type: multipart/form-data
```

| Field | Type | Required | Mô tả |
|-------|------|----------|-------|
| `file` | PDF | Yes | PDF cần xác minh |
| `token` | Text | Yes | Token lấy từ QR |

---

## Storage

```text
backend/
├── storage/
│   └── documents/
│       └── HS-2026-XXXXX/
│           ├── original.pdf      ← file gốc (Flow A) hoặc preview.pdf (Flow B)
│           ├── preview.pdf       ← PDF preview (chỉ Flow B)
│           ├── signed.pdf        ← PDF đã nhúng QR + metadata
│           └── metadata.json     ← metadata tài liệu
│
├── src/
│   ├── data/
│   │   ├── documents.json        ← metadata tài liệu (JSON store)
│   │   └── previews.json         ← metadata preview (JSON store)
│   ├── crypto/
│   │   └── keys/
│   │       └── falcon-keystore.json  ← khóa Falcon-512 mã hóa
│   ├── templates/
│   │   └── CT01.pdf              ← mẫu đơn đăng ký tạm trú
│   ├── fonts/
│   │   └── Roboto-Regular.ttf
│   └── uploads/                  ← file upload tạm thời
```

---

## Kiến trúc phân vùng mạng

```text
┌─────────────────────────────────────────────────────┐
│  Public Zone                                          │
│  /api/public/*                                        │
│  - Không cần xác thực                                 │
│  - Chỉ phục vụ xác minh tài liệu                     │
├─────────────────────────────────────────────────────┤
│  Application Zone                                     │
│  /api/app/documents/*                                 │
│  - Xử lý nghiệp vụ: preview, issue, upload, verify   │
│  - Quản lý tài liệu                                  │
├─────────────────────────────────────────────────────┤
│  Crypto Zone                                          │
│  /api/internal/crypto/*                               │
│  - Bảo vệ bằng x-internal-crypto-secret header        │
│  - Ký số Falcon-512, quản lý khóa                     │
│  - Không expose private key ra ngoài                   │
├─────────────────────────────────────────────────────┤
│  Data Zone                                            │
│  - Không có HTTP endpoint                              │
│  - Truy cập qua repository service                     │
│  - JSON file store (documents.json, previews.json)     │
└─────────────────────────────────────────────────────┘
```

---

## Cấu trúc project

```text
backend/src/
├── server.js                    ← Entry point, mount routes + zone middleware
├── app.js                       ← Express app setup (cors, json)
│
├── config/
│   ├── db.js                    ← MySQL connection
│   ├── env.config.js            ← Env variables (INTERNAL_CRYPTO_SECRET, PUBLIC_VERIFY_URL)
│   └── network.config.js        ← Network zone definitions
│
├── controllers/
│   ├── document.controller.js   ← Preview, issue, upload, verify, download
│   ├── crypto.controller.js     ← Sign, verify, public-key (Crypto Zone)
│   └── network.controller.js    ← Network model info
│
├── routes/
│   ├── document.routes.js       ← /api/app/documents/*
│   ├── public.routes.js         ← /api/public/*
│   └── crypto.routes.js         ← /api/internal/crypto/*
│
├── services/
│   ├── document.service1.js     ← Orchestrator chính: processDocument, verifyDocument
│   ├── document.service.js      ← Legacy orchestrator (cũ)
│   ├── document.repository.js   ← JSON file persistence cho documents
│   ├── preview.service.js       ← Render preview PDF từ template CT01
│   ├── qr.service.js            ← Generate QR code (PNG)
│   ├── pdf.service.js           ← Embed QR + metadata vào PDF
│   ├── signed-pdf.service.js    ← Legacy signed PDF (cũ)
│   └── audit.service.js         ← In-memory audit log
│
├── repositories/
│   └── preview.repository.js    ← JSON file persistence cho previews
│
├── validators/
│   └── ct01.validator.js        ← Validate form CT01 (full_name, citizen_id, phone...)
│
├── crypto/
│   ├── hash.service.js          ← SHA-256 hash (file, buffer, text)
│   ├── signature.service.js     ← Delegation layer: getActiveKey, signPayload, verifyPayload
│   ├── key-manager.service.js   ← Key lifecycle: generate, rotate, encrypt/decrypt
│   └── falcon/
│       ├── falcon.adapter.js    ← Low-level @noble/post-quantum wrapper
│       └── falcon.service.js    ← Application-level: canonical JSON, sign, verify
│
├── middlewares/
│   └── network-zone.middleware.js ← attachNetworkZone, requireCryptoZoneAccess
│
├── utils/
│   └── storage.util.js          ← ensureStorageFolders, createDocumentFolder
│
├── templates/
│   └── CT01.pdf                 ← Mẫu đơn đăng ký tạm trú
│
└── fonts/
    └── Roboto-Regular.ttf
```

---

## Pipeline ký số

```text
1. Generate document_id        HS-{year}-{8-char-uuid}
2. Generate verification token  32-byte random → base64url
3. Build verify URL             {PUBLIC_VERIFY_URL}/{documentId}?token={token}
4. Generate QR code             JSON { document_id, verify_url, token } → PNG
5. Embed QR + metadata box      Vào trang cuối PDF tại (32, 32) + (120, 32)
6. Hash signed PDF              SHA-256 → 64 hex chars
7. Build canonical payload      { document_id, file_hash, issued_at, key_id, version:"1.0" }
8. Falcon-512 sign              Ký canonical JSON bằng private key
9. Save metadata                documents.json + metadata.json
10. Write audit log             action: "sign", result: "success"
```

---

## Bảo mật

| Thành phần | Chức năng |
|------------|-----------|
| **Falcon-512** | Ký số post-quantum (public key 897 bytes, private key 1281 bytes) |
| **SHA-256** | Hash tài liệu để kiểm tra toàn vẹn |
| **QR Code** | Chứa document_id + verify_url + token, error correction level H |
| **Verification Token** | 32-byte random, chống giả mạo quyền xác minh |
| **AES-256-CBC** | Mã hóa private key trong keystore (PBKDF2-HMAC-SHA256) |
| **Network Zones** | Phân tách Public / Application / Crypto / Data |
| **Metadata Box** | Nhúng thông tin ký số vào PDF (Document ID, Algorithm, Key ID, Issued at) |

---

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `INTERNAL_CRYPTO_SECRET` | `change-me-in-production` | Secret mã hóa private key + xác thực Crypto Zone |
| `PUBLIC_VERIFY_URL` | `http://localhost:3000/api/public/documents/verify` | Base URL cho QR verify |
| `KEY_STORAGE_TYPE` | `file` | Nơi lưu khóa: `file`, `hsm`, `azure-keyvault`, `aws-kms` |
| `NODE_ENV` | `development` | Môi trường: `development`, `test`, `production` |

---

## Phụ thuộc chính

| Package | Phiên bản |用途 |
|---------|-----------|------|
| `@noble/post-quantum` | ^0.6.1 | Falcon-512 cryptographic operations |
| `pdf-lib` | ^1.17.1 | PDF manipulation (embed QR, metadata) |
| `@pdf-lib/fontkit` | ^1.1.1 | Custom font rendering (Roboto) |
| `qrcode` | ^1.5.4 | QR code generation |
| `express` | ^5.2.1 | HTTP server |
| `multer` | ^2.1.1 | File upload handling |
| `fs-extra` | ^11.3.5 | File system operations |
| `mysql2` | ^3.20.0 | Database (future) |
