# Review: Kiến trúc Network Zones & luồng hoạt động

> Cập nhật: 2026-06-15
> Phạm vi: Backend zone architecture, routing, middleware chain, signing modes, crypto flow

---

## 1. Tổng quan kiến trúc 4 zones

Hệ thống được chia thành 4 vùng mạng (network zones), mỗi zone có mục đích, cơ chế bảo vệ và tập endpoint riêng:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Express Server                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ PUBLIC ZONE   │  │ APP ZONE     │  │ CRYPTO ZONE  │          │
│  │ /api/public   │  │ /api/app     │  │ /api/internal│          │
│  │               │  │ /documents   │  │ /crypto      │          │
│  │ Rate limit    │  │              │  │              │          │
│  │ 30 req/15min  │  │ JWT required │  │ Secret header│          │
│  │ No auth       │  │ RBAC roles   │  │ required     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐                                               │
│  │ DATA ZONE    │  ← Không expose HTTP route                    │
│  │ File storage │     Chỉ truy cập nội bộ qua service layer     │
│  │ JSON / MySQL │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

| Zone | Path prefix | Bảo vệ | Rate limit | Mục đích |
|---|---|---|---|---|
| **Public** | `/api/public` | Không auth | 30 req/15min | Xác minh tài liệu qua QR/upload, hiển thị public key |
| **Application** | `/api/app/documents` | JWT + RBAC | 100 req/15min (global) | Nghiệp vụ hồ sơ: nộp, ký, từ chối, tải file, đăng ký device key |
| **Crypto** | `/api/internal/crypto` | `x-internal-crypto-secret` header | 100 req/15min (global) | Ký Falcon-512, xác minh chữ ký, quản lý khóa (internal API) |
| **Data** | (file system only) | Không expose HTTP | N/A | Lưu trữ file PDF, JSON/MySQL, audit logs, keystore |

---

## 2. Chi tiết từng zone

### 2.1. Public Zone (`/api/public`)

**Mục đích:** Cổng công khai cho công dân xác minh tài liệu đã ký số và tra cứu thông tin mạng.

**Middleware chain:**
```
verifyLimiter (30 req/15min) → attachNetworkZone(PUBLIC) → publicRoutes
```

**Endpoints:**

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| `GET` | `/network-model` | `getNetworkModel` | Trả về mô hình 4-zone (metadata) |
| `GET` | `/keys/:keyId` | `getPublicSigningKey` | Lấy public key theo key ID |
| `GET` | `/documents/verify/:documentId` | `verifyDocumentByQr` | Xác minh tài liệu qua QR link (token trên URL) |
| `POST` | `/documents/verify/:documentId` | `verifyDocumentByUpload` | Xác minh qua upload PDF (so sánh hash) |

**Luồng xác minh QR:**
```
User quét QR → Browser mở verify.html
    → GET /api/public/documents/verify/{id}?token=xxx
    → verifyDocument()
        1. Tìm document theo documentId
        2. Kiểm tra token_hash (hash(token) === stored hash)
        3. Kiểm tra status === "issued"
        4. Hash file PDF trên đĩa → so sánh với hash lúc ký
        5. Verify Falcon-512 signature với public key
        6. Verify tất cả signature records (officer + organization)
        7. Trả kết quả:
           - valid: boolean
           - signer: { user_id, full_name, role }   ← ai là người ký
           - organization: { organization_id, name }
           - hash_matched, signature_valid
           - officer_signature_valid, organization_signature_valid
```

---

### 2.2. Application Zone (`/api/app/documents`)

**Mục đích:** Xử lý toàn bộ nghiệp vụ hồ sơ hành chính — từ nộp đơn đến ký số và phát hành.

**Middleware chain:**
```
attachNetworkZone(APPLICATION) → documentRoutes
    → [per-route: authenticate] → [per-route: requireRole("officer","admin")]
```

**Endpoints — Citizen (cần JWT):**

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| `GET` | `/` | `listDocumentDetails` | Liệt kê hồ sơ (citizen: của mình, officer: tất cả) |
| `POST` | `/preview` | `previewDocument` | Tạo PDF xem trước CT01 |
| `GET` | `/previews/:previewId/file` | `downloadPreviewDocument` | Tải file PDF preview |
| `POST` | `/submit` | `submitDocumentHandler` | Nộp hồ sơ (từ preview đã xác nhận) |
| `GET` | `/:documentId` | `getDocumentDetail` | Xem chi tiết hồ sơ |
| `GET` | `/:documentId/download` | `downloadDocumentFile` | Tải PDF gốc |

**Endpoints — Officer/Admin (cần JWT + role):**

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| `GET` | `/pending` | `listPendingDocuments` | Hồ sơ chờ duyệt |
| `GET` | `/issued` | `listIssuedDocuments` | Hồ sơ đã ký |
| `GET` | `/rejected` | `listRejectedDocuments` | Hồ sơ đã từ chối |
| `POST` | `/register-device-key` | `registerDeviceKeyHandler` | Đăng ký Falcon-512 device key (device mode) |
| `GET` | `/check-device-key` | `checkDeviceKeyHandler` | Kiểm tra device key + signing mode |
| `POST` | `/:documentId/sign-challenge` | `createSigningChallengeHandler` | Tạo thách thức ký (nonce + TTL) |
| `POST` | `/:documentId/sign` | `signDocumentHandler` | Ký số Falcon-512 và phát hành |
| `POST` | `/:documentId/reject` | `rejectDocumentHandler` | Từ chối hồ sơ |
| `POST` | `/upload` | `uploadDocument` | Legacy upload (dev only, prod: 410) |
| `POST` | `/issue` | `issueDocument` | Legacy issue (dev only) |

**Endpoints — Semi-public (JWT optional):**

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| `GET` | `/:documentId/signed-pdf` | `downloadSignedDocument` | Tải PDF đã ký (JWT HOẶC verification token) |
| `GET` | `/verify/:documentId` | `verifyDocumentByQr` | Verify qua QR (duplicate của public zone) |
| `POST` | `/verify/:documentId` | `verifyDocumentByUpload` | Verify qua upload (duplicate) |

---

### 2.3. Crypto Zone (`/api/internal/crypto`)

**Mục đích:** Dịch vụ mã hóa nội bộ — ký Falcon-512, xác minh chữ ký, quản lý khóa. Chỉ cho phép truy cập từ Application Zone qua shared secret.

**Middleware chain:**
```
attachNetworkZone(CRYPTO) → requireCryptoZoneAccess → cryptoRoutes
```

**Bảo vệ đặc biệt:**
```javascript
// requireCryptoZoneAccess kiểm tra header:
x-internal-crypto-secret: <INTERNAL_CRYPTO_SECRET từ .env>
```

**Endpoints:**

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| `GET` | `/public-key` | `cryptoGetPublicKey` | Lấy active Falcon-512 public key |
| `POST` | `/sign` | `cryptoSign` | Ký payload với active key |
| `POST` | `/verify` | `cryptoVerify` | Verify chữ ký against public key |
| `POST` | `/keys/external-public` | `cryptoRegisterExternalPublicKey` | Đăng ký public key bên ngoài |

**Kiến trúc Crypto (3 layers):**
```
┌─────────────────────────────────────────┐
│  crypto.controller.js                   │  HTTP layer
├─────────────────────────────────────────┤
│  crypto/signature.service.js            │  Service layer (delegation)
│  - buildSignaturePayload()              │  - Canonical JSON
│  - signPayload() → keyManager → falcon  │  - Key resolution
│  - verifyPayloadSignature()             │  - NEVER throws
├─────────────────────────────────────────┤
│  crypto/falcon/falcon.service.js        │  Domain layer
│  - signaturePayload()                   │  - Alphabetical keys, snake_case
│  - sign() / verify()                    │  - Size validation
├─────────────────────────────────────────┤
│  crypto/falcon/falcon.adapter.js        │  Adapter layer
│  - @noble/post-quantum wrapper          │  - Lazy loading
├─────────────────────────────────────────┤
│  @noble/post-quantum (FALCON-512)       │  Library
└─────────────────────────────────────────┘
```

**Quản lý khóa (key-manager.service.js):**
```
falcon-keystore.json (encrypted):
{
  "keys": [
    {
      "key_id": "falcon-xxx",
      "owner_type": "user" | "organization",
      "owner_id": "1" | "PUBLIC-AUTHORITY-DEMO",
      "public_key": "<base64 897 bytes>",
      "private_key_encrypted": "<base64 AES-256-GCM>",
      "encryption": { "algorithm": "aes-256-gcm", "kdf": "scrypt", ... },
      "status": "active",
      "provider": "file" | "officer-device" | "external-device"
    }
  ]
}

Private key encryption:
  INTERNAL_CRYPTO_SECRET → scrypt(salt) → AES-256-GCM key → decrypt private key
```

---

### 2.4. Data Zone (File System Only)

**Mục đích:** Lưu trữ vật lý. Không expose HTTP route.

```
backend/storage/documents/{HS-2026-XXXXXXXX}/
    ├── original.pdf
    ├── signed.pdf              (nếu issued)
    ├── metadata.json
    ├── signature-evidence.json
    └── qr/qr.png               (nếu issued)

backend/src/data/
    ├── users.json
    ├── documents.json
    ├── document_signatures.json
    ├── audit_logs.json
    └── household_members.json

backend/src/crypto/keys/
    └── falcon-keystore.json    (encrypted Falcon-512 keys)
```

---

## 3. Signing Modes — Chế độ ký số

Hệ thống hỗ trợ 2 chế độ ký số, được cấu hình qua biến môi trường `SIGNING_MODE`:

```env
# .env
SIGNING_MODE=hsm     # Mặc định — server HSM ký thay officer
SIGNING_MODE=device  # Officer giữ private key trên device
```

### 3.1. So sánh 2 chế độ

| Aspect | HSM Mode (`hsm`) | Device Mode (`device`) |
|---|---|---|
| **Ai giữ private key?** | Server (encrypted keystore) | Officer (browser localStorage) |
| **Officer cần gì để ký?** | Chỉ cần đăng nhập (JWT) | Phải có Falcon-512 key trên device |
| **Ai ký officer signature?** | Server ký hộ (sau JWT auth) | Officer ký trên device |
| **Identity binding** | JWT + audit log | Device key (cryptographic proof) |
| **Server giả mạo được?** | ⚠️ Có thể (server có private key) | ❌ Không thể (không có private key) |
| **Dashboard UI** | 🔵 Banner "Chế độ HSM" | 🔴/🟢 Device key registration |
| **Phù hợp** | Demo, dev, không có hardware key | Production, có PKI infrastructure |

### 3.2. Config derivation

```javascript
// env.config.js — SIGNING_MODE là nguồn gốc
const SIGNING_MODE = process.env.SIGNING_MODE || "hsm";

// Derived (có thể override riêng lẻ nếu cần)
const ALLOW_SERVER_SIDE_PERSONAL_KEYS = SIGNING_MODE === "hsm";
const REQUIRE_OFFICER_DEVICE_SIGNATURE = SIGNING_MODE === "device";
```

### 3.3. HSM Mode Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  OFFICER ĐĂNG NHẬP                                              │
│  ─────────────────                                              │
│  POST /api/auth/login { email, password }                       │
│  → bcrypt.compare(password, stored_hash)                        │
│  → JWT = sign({ id, email, full_name, roles })                  │
│  → Set httpOnly cookie (XSS-safe)                               │
│  → Identity: req.user = { id: "1", full_name: "Can bo Nguyen" } │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  OFFICER KÝ SỐ (HSM)                                            │
│  ────────────────────                                            │
│  1. Officer click "Ký số" trên dashboard                        │
│  2. Confirm: "Ký số bởi HSM server với danh tính: Can bo Nguyen"│
│  3. POST /api/app/documents/{id}/sign {}                        │
│                                                                 │
│  Server (HSM) xử lý:                                            │
│    a. authenticate middleware → req.user từ JWT                  │
│    b. resolveSignerContext(req.user.id) → lấy officer info       │
│    c. getOfficerPersonalKey() → lấy/tạo officer key từ keystore │
│    d. buildSignaturePayload({ action: "approve_document", ... }) │
│    e. signPayloadWithKey(payload, officerKey.key_id)             │
│       → decrypt private key (AES-256-GCM + scrypt)              │
│       → FALCON-512.sign(payload, privateKey)                    │
│    f. generateQrCode() + embedQrIntoPdf() → signed.pdf          │
│    g. signPayload(payload) → organization signature              │
│    h. Tạo 2 signature records:                                   │
│       - officer_personal_falcon (officer key)                    │
│       - organization_falcon (org key)                            │
│    i. writeAuditLog({ action: "sign", userId: officer.id })      │
│                                                                 │
│  ✅ 2 chữ ký, audit trail đầy đủ                                │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4. Device Mode Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  OFFICER ĐĂNG KÝ DEVICE KEY (lần đầu)                           │
│  ────────────────────────────────────                            │
│  1. Dashboard hiển thị banner "Chưa có khóa ký"                 │
│  2. Officer click "Đăng ký ngay"                                 │
│  3. Browser generate Falcon-512 keypair (897 + 1281 bytes)       │
│     → @noble/post-quantum loaded via importmap (esm.sh CDN)      │
│  4. Private key → localStorage (KHÔNG gửi lên server)            │
│  5. Public key → POST /api/app/documents/register-device-key     │
│  6. Server lưu vào falcon-keystore.json (provider: "officer-device")│
│                                                                 │
│  ✅ Private key KHÔNG BAO GIỜ rời browser                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  OFFICER KÝ SỐ (Device)                                         │
│  ─────────────────────                                           │
│  1. Officer click "Ký số"                                        │
│  2. POST /sign-challenge → server tạo challenge                  │
│     { challenge_id, payload, payload_hash, expires_at (5 min) }  │
│  3. Browser ký challenge bằng device private key                 │
│     → FALCON-512.sign(payload, devicePrivateKey)                │
│  4. POST /sign { officer_signature_proof: {                      │
│       challenge_id, signature } }                                │
│  5. Server verifyOfficerSignatureProof():                        │
│     a. Tìm challenge theo challenge_id                           │
│     b. Kiểm tra: pending, đúng document, đúng officer, chưa hết hạn│
│     c. verifyPayloadSignature(signature, payload, publicKey)     │
│     d. markChallengeUsed(challenge_id)                           │
│  6. Server ký organization signature                             │
│  7. Tạo 2 signature records                                      │
│                                                                 │
│  ✅ Không ai có thể giả mạo (không có private key)               │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5. Backend branching logic

```javascript
// document.service1.js — signDocument()
if (!officerApproval) {
    if (SIGNING_MODE === "device") {
        // DEVICE MODE: Bắt buộc phải có proof
        if (officerHasKey) {
            throw new Error("Officer device signature proof is required");
        } else {
            throw new Error("Officer has not registered a device key");
        }
    }

    // HSM MODE: Server ký thay officer (JWT auth = identity)
    const officerKey = await getOfficerPersonalKey(signer);
    officerSignatureInfo = await signPayloadWithKey(payload, officerKey.key_id);
}
```

### 3.6. Frontend branching logic

```javascript
// officer/dashboard.html — signDoc()
if (signingMode === "device") {
    // DEVICE: challenge-response
    const res = await crypto.signDocumentWithDeviceKey(docId, officerInfo);
} else {
    // HSM: server signs on behalf
    const res = await apiPost(`/app/documents/${docId}/sign`, {});
}
```

---

## 4. Authentication Flow

```
┌──────────┐                    ┌──────────────┐
│  Browser  │                    │  Backend     │
└─────┬────┘                    └──────┬───────┘
      │                                │
      │ POST /api/auth/register        │
      │ { full_name, email, password } │
      │───────────────────────────────►│
      │                                │ bcrypt.hash(password, 10)
      │                                │ Save to users.json / MySQL
      │◄───────────────────────────────│
      │                                │
      │ POST /api/auth/login           │
      │ { email, password }            │
      │───────────────────────────────►│
      │                                │ bcrypt.compare()
      │                                │ jwt.sign({ id, email, full_name, roles })
      │                                │ Set httpOnly cookie: token=JWT
      │◄───────────────────────────────│
      │ { data: { user } }             │  ← Token NOT in body (XSS-safe)
      │                                │
      │ GET /api/app/documents         │  (subsequent requests)
      │ Cookie: token=JWT              │
      │───────────────────────────────►│
      │                                │ extractToken(): cookie > Bearer
      │                                │ jwt.verify() → req.user
      │◄───────────────────────────────│
      │ [data]                         │
```

**Roles:** `citizen` (xem/submit), `officer` (ký/từ chối), `admin` (toàn quyền)

---

## 5. Middleware Chain tổng thể

```
Request →
    cors()                          # CORS headers
    → helmet()                      # Security headers (CSP enabled)
    → express.json()                # Body parser
    → cookieParser()                # Cookie parser
    → /api: globalLimiter           # 100 req/15min
    → /api/auth: authLimiter        # 10 req/15min
    → /api/public: verifyLimiter    # 30 req/15min
    → attachNetworkZone(zone)       # Gắn req.networkZone + X-Network-Zone header
    → [requireCryptoZoneAccess]     # (Crypto zone only) Check x-internal-crypto-secret
    → [authenticate]                # (App zone per-route) JWT verification
    → [requireRole(...)]            # (App zone per-route) RBAC check
    → handler                       # Business logic
    → errorHandler                  # Global error handler (last)
    → notFoundHandler               # 404 for unmatched API routes
```

---

## 6. Luồng dữ liệu end-to-end: Nộp → Ký → Xác minh

```
┌───────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  CITIZEN   │     │ APP ZONE     │     │ CRYPTO ZONE  │     │  DATA ZONE   │
│ (Browser)  │     │ /api/app     │     │ /api/internal│     │ (File/MySQL) │
└─────┬─────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
      │                  │                     │                     │
      │ POST /preview    │                     │                     │
      │─────────────────►│                     │                     │
      │                  │ createPreviewDocument()                   │
      │                  │──────────────────────────────────────────►│
      │◄─────────────────│                     │         CT01.pdf    │
      │ preview_id       │                     │                     │
      │                  │                     │                     │
      │ POST /submit     │                     │                     │
      │─────────────────►│                     │                     │
      │                  │ submitDocument()     │                     │
      │                  │──────────────────────────────────────────►│
      │◄─────────────────│                     │         original.pdf│
      │ document_id      │                     │         status=sub  │
      │                  │                     │                     │
      │         ┌────────OFFICER────────┐      │                     │
      │         │ (HSM mode)            │      │                     │
      │         │ POST /{id}/sign {}    │      │                     │
      │         │──────────────────────►│      │                     │
      │         │                       │ signPayloadWithKey()       │
      │         │                       │──────►│                    │
      │         │                       │       │ decrypt privateKey │
      │         │                       │       │ FALCON-512 sign    │
      │         │                       │◄──────│                    │
      │         │                       │                     │
      │         │                       │ generateQr + embed  │
      │         │                       │────────────────────────────►│
      │         │◄──────────────────────│                     signed│
      │         │ issued                │                     │
      │                                                       │
      │    ┌───ANYONE (QR scan)───┐                          │
      │    │ GET /verify?id=&token=│                          │
      │    │──────────────────────►│                          │
      │    │                       │ verifyDocument()         │
      │    │                       │─────────────────────────►│
      │    │◄──────────────────────│              hash + Falcon verify
      │    │ valid + signer info   │                          │
```

---

## 7. API Endpoints tổng hợp

### Public Zone (`/api/public`)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| `GET` | `/network-model` | ❌ | Mô hình 4-zone |
| `GET` | `/keys/:keyId` | ❌ | Public key theo ID |
| `GET` | `/documents/verify/:id` | ❌ | Verify qua QR |
| `POST` | `/documents/verify/:id` | ❌ | Verify qua upload |

### Application Zone (`/api/app/documents`)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| `GET` | `/` | JWT | Liệt kê hồ sơ |
| `POST` | `/preview` | JWT | Tạo PDF preview |
| `GET` | `/previews/:id/file` | JWT | Tải preview PDF |
| `POST` | `/submit` | JWT | Nộp hồ sơ |
| `GET` | `/:id` | JWT | Chi tiết hồ sơ |
| `GET` | `/:id/download` | JWT | Tải PDF gốc |
| `GET` | `/:id/signed-pdf` | JWT/token | Tải PDF đã ký |
| `GET` | `/pending` | Officer | Hồ sơ chờ duyệt |
| `GET` | `/issued` | Officer | Hồ sơ đã ký |
| `GET` | `/rejected` | Officer | Hồ sơ đã từ chối |
| `POST` | `/register-device-key` | Officer | Đăng ký device key |
| `GET` | `/check-device-key` | Officer | Kiểm tra key + mode |
| `POST` | `/:id/sign-challenge` | Officer | Tạo signing challenge |
| `POST` | `/:id/sign` | Officer | Ký số (HSM hoặc device) |
| `POST` | `/:id/reject` | Officer | Từ chối hồ sơ |

### Crypto Zone (`/api/internal/crypto`)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| `GET` | `/public-key` | Secret | Active public key |
| `POST` | `/sign` | Secret | Ký payload |
| `POST` | `/verify` | Secret | Verify chữ ký |
| `POST` | `/keys/external-public` | Secret | Đăng ký external key |

### Auth (`/api/auth`)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| `POST` | `/register` | ❌ | Đăng ký citizen |
| `POST` | `/login` | ❌ | Đăng nhập |
| `POST` | `/logout` | ❌ | Đăng xuất |
| `GET` | `/me` | JWT | Thông tin user hiện tại |

---

## 8. Signature Records

Mỗi lần ký số tạo 2 bản ghi chữ ký:

```
┌─────────────────────────────────────────────────────────────────┐
│  Signature 1: officer_personal_falcon                           │
│  ├── type: "officer_personal_falcon"                            │
│  ├── key: officer personal key (Falcon-512)                     │
│  ├── payload: { action: "approve_document", documentId, ... }   │
│  ├── signer: { user_id, full_name, role }  (từ JWT hoặc device) │
│  ├── signed_file_hash: original file hash                       │
│  └── Ý nghĩa: "Officer này đã duyệt hồ sơ"                    │
│                                                                 │
│  Signature 2: organization_falcon                               │
│  ├── type: "organization_falcon"                                │
│  ├── key: organization key (Falcon-512)                         │
│  ├── payload: { documentId, fileHash, issuedAt, ... }           │
│  ├── signer: officer info (từ JWT)                              │
│  ├── signed_file_hash: signed PDF hash                          │
│  └── Ý nghĩa: "Tổ chức phát hành tài liệu này"                │
└─────────────────────────────────────────────────────────────────┘
```

**Verify flow kiểm tra cả 2 chữ ký:**
```
organization_signature_valid = verify(org_signature, org_public_key)
officer_signature_valid = verify(officer_signature, officer_public_key)
valid = organization_signature_valid && officer_signature_valid
```

---

## 9. Files đã thay đổi

| File | Thay đổi |
|---|---|
| [env.config.js](../backend/src/config/env.config.js) | Thêm `SIGNING_MODE`, derive flags |
| [document.service1.js](../backend/src/services/document.service1.js) | `signDocument()` phân nhánh HSM/device |
| [document.controller.js](../backend/src/controllers/document.controller.js) | Thêm `registerDeviceKeyHandler`, `checkDeviceKeyHandler` |
| [document.routes.js](../backend/src/routes/document.routes.js) | Thêm routes `/register-device-key`, `/check-device-key` |
| [crypto.js](../frontend/js/crypto.js) | **Mới** — Client-side Falcon-512 key manager |
| [officer/dashboard.html](../frontend/officer/dashboard.html) | Key registration UI + dual-mode signing |
| [api.js](../frontend/js/api.js) | Thêm `sanitize()`, `showAlert()`, `downloadDocument()`, fix auth flow |
| [auth.js](../frontend/js/auth.js) | Cookie-based auth (no token in body) |
| [app.js](../backend/src/app.js) | CSP enabled |
| [error-handler.middleware.js](../backend/src/middlewares/error-handler.middleware.js) | Fix unreachable branch |
| [auth.controller.js](../backend/src/controllers/auth.controller.js) | JWT chỉ trong cookie |
| [household_members.repository.js](../backend/src/repositories/household_members.repository.js) | Thêm JSON fallback |
| [package.json](../backend/package.json) | Dọn deps, fix script path |
| [.env.example](../backend/.env.example) | Document SIGNING_MODE |
| [citizen/dashboard.html](../frontend/citizen/dashboard.html) | XSS fixes, error handling |

---

## 10. Đánh giá & nhận xét

### Điểm mạnh

| Aspect | Đánh giá |
|---|---|
| **Zone isolation** | 4 zones rõ ràng, mỗi zone có middleware bảo vệ riêng |
| **Flexible signing modes** | HSM (demo/dev) ↔ Device (production) chỉ qua 1 env var |
| **Crypto architecture** | 3-layer delegation clean, dễ thay đổi implementation |
| **Key management** | Private key encrypted AES-256-GCM + scrypt, không expose trong response |
| **Canonical payload** | Alphabetical keys, snake_case, no whitespace → reproducible signatures |
| **verify NEVER throws** | Luôn trả boolean, không leak exception |
| **Audit logging** | Mọi operation quan trọng đều ghi audit log |
| **Rate limiting** | 3 tiers riêng biệt (global, auth, verify) |
| **Dual-mode storage** | Repository pattern cho JSON ↔ MySQL |
| **Client-side crypto** | @noble/post-quantum via importmap, private key không rời browser |

### Vấn đề còn tồn tại

| # | Severity | Issue | Zone |
|---|---|---|---|
| 1 | **HIGH** | JSON repos dùng `fs.readFileSync`/`writeFileSync` — block event loop | Data |
| 2 | **HIGH** | `listDocuments()` load ALL documents, filter in-memory — O(N) | App |
| 3 | **MEDIUM** | `securityHeaders` middleware đã define nhưng không mount | Global |
| 4 | **MEDIUM** | Crypto zone secret so sánh plain string — nên dùng timing-safe | Crypto |
| 5 | **LOW** | Legacy endpoints (`/upload`, `/issue`) vẫn mount (trả 410) | App |
| 6 | **LOW** | N+1 query pattern trong `getDocumentsByStatus`/`getDocumentsByOwner` | App |
| 7 | **LOW** | `processDocument` (legacy) vẫn dùng server-side signing, không theo SIGNING_MODE | App |

### Chuyển đổi giữa 2 chế độ

```env
# HSM mode (demo/dev — server ký thay officer)
SIGNING_MODE=hsm

# Device mode (production — officer giữ private key)
SIGNING_MODE=device
```

Chỉ cần đổi `SIGNING_MODE` trong `.env` → restart server → dashboard tự động thích ứng.
