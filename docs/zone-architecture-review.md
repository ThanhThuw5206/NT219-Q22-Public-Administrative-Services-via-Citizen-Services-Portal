# Review: Kiến trúc Network Zones & luồng hoạt động

> Cập nhật: 2026-06-15
> Phạm vi: Backend zone architecture, routing, middleware chain, crypto flow

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
| **Application** | `/api/app/documents` | JWT + RBAC | 100 req/15min (global) | Nghiệp vụ hồ sơ: nộp, ký, từ chối, tải file |
| **Crypto** | `/api/internal/crypto` | `x-internal-crypto-secret` header | 100 req/15min (global) | Ký Falcon-512, xác minh chữ ký, quản lý khóa |
| **Data** | (file system only) | Không expose HTTP | N/A | Lưu trữ file PDF, JSON/MySQL, audit logs |

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
        7. Trả kết quả: valid, hash_matched, signature_valid, ...
```

**Đặc điểm:**
- Không yêu cầu đăng nhập (anonymous access)
- Rate limit nghiêm ngặt (30 req/15min) chống abuse
- `verifyDocument()` NEVER throws — mọi lỗi trả `{ valid: false, reason: "..." }`
- Audit log mọi lượt verify (success hoặc fail)

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

**Luồng nộp hồ sơ (Citizen flow):**
```
1. Citizen điền form CT01 → POST /preview
   → validateCT01() kiểm tra dữ liệu
   → createPreviewDocument() dùng pdf-lib điền form CT01.pdf
   → Trả về preview_id + preview_url

2. Citizen xem trước PDF (iframe) → xác nhận

3. Citizen submit → POST /submit
   → Kiểm tra preview hợp lệ, chưa hết hạn
   → submitDocument(): copy PDF → storage/documents/{id}/original.pdf
   → Hash file, tạo bản ghi status="submitted"
   → Lưu thành viên hộ gia đình (nếu có)
   → Audit log

4. Document chuyển sang tab "Chờ duyệt" của Officer
```

**Luồng ký số (Officer flow):**
```
1. Officer xem hồ sơ pending → POST /{id}/sign-challenge
   → Tạo challenge: nonce + payload + TTL 5 phút
   → Payload chứa: action="approve_document", documentId, fileHash, keyId
   → Trả payload cho officer ký (nếu dùng device key)

2. Officer ký challenge → POST /{id}/sign
   → verifyOfficerSignatureProof(): kiểm tra challenge + chữ ký officer
   → Hoặc auto-ký (dev mode, ALLOW_SERVER_SIDE_PERSONAL_KEYS=true)

3. Server xử lý:
   a. Generate QR code (chứa verify_url + token)
   b. Embed QR + metadata vào PDF → signed.pdf
   c. Hash signed.pdf → fileHash
   d. buildSignaturePayload() → canonical JSON
   e. signPayload() → Falcon-512 sign với organization key
   f. Tạo 2 signature records:
      - officer_personal_falcon (chữ ký cá nhân officer)
      - organization_falcon (chữ ký tổ chức)
   g. Ghi signature-evidence.json
   h. Update document status → "issued"

4. Citizen thấy "Đã ký" + nút tải PDF + link xác minh
```

**Luồng từ chối:**
```
Officer → POST /{id}/reject { reason: "..." }
    → rejectDocument(): status → "rejected", lưu rejection_reason
    → Audit log
```

**Bảo mật Application Zone:**
- `authenticate` middleware: JWT từ httpOnly cookie hoặc Bearer header
- `requireRole("officer", "admin")`: RBAC check trên `req.user.roles`
- `canAccessDocument()`: citizen chỉ thấy hồ sơ của mình
- `validateFilePath()`: chống path traversal khi tải file
- `safeError()`: không leak internal error trong production

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
Nếu secret sai → 401 "Crypto Zone access denied" + audit log.

**Endpoints:**

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| `GET` | `/public-key` | `cryptoGetPublicKey` | Lấy active Falcon-512 public key |
| `POST` | `/sign` | `cryptoSign` | Ký payload với active key |
| `POST` | `/verify` | `cryptoVerify` | Verify chữ ký against public key |
| `POST` | `/keys/external-public` | `cryptoRegisterExternalPublicKey` | Đăng ký public key bên ngoài (device key) |

**Luồng ký trong Crypto Zone:**
```
cryptoSign({ payload }):
    1. buildSignaturePayload(payload) → canonical JSON (alphabetical keys, snake_case, no whitespace)
    2. keyManagerService.getActivePublicKey() → lấy active key metadata
    3. keyManagerService.getPrivateKey(keyId, INTERNAL_CRYPTO_SECRET)
       → Giải mã private key từ falcon-keystore.json
       → AES-256-GCM decryption với scrypt-derived key
    4. falconService.sign(canonicalPayload, privateKeyBase64)
       → @noble/post-quantum FALCON-512 signing
    5. Trả { signature, key_id, algorithm, provider }
```

**Kiến trúc Crypto (3 layers):**
```
┌─────────────────────────────────────────┐
│  crypto.controller.js                   │  HTTP layer
│  (cryptoSign, cryptoVerify, ...)        │
├─────────────────────────────────────────┤
│  crypto/signature.service.js            │  Service layer (delegation)
│  (signPayload, verifyPayloadSignature,  │   - buildSignaturePayload
│   getActiveKey, signPayloadWithKey)     │   - signPayload → keyManager → falcon
├─────────────────────────────────────────┤
│  crypto/falcon/falcon.service.js        │  Domain layer
│  (signaturePayload, sign, verify)       │   - Canonical JSON construction
│                                         │   - Size validation
│                                         │   - Error swallowing (verify NEVER throws)
├─────────────────────────────────────────┤
│  crypto/falcon/falcon.adapter.js        │  Adapter layer
│  (FALCON512.keypair, sign, verify)      │   - @noble/post-quantum wrapper
│                                         │   - Lazy loading
│                                         │   - Typed errors
├─────────────────────────────────────────┤
│  @noble/post-quantum                    │  Library
│  (FALCON-512 implementation)            │
└─────────────────────────────────────────┘
```

**Quản lý khóa (key-manager.service.js):**
```
falcon-keystore.json (encrypted):
{
  "keys": [
    {
      "key_id": "falcon-xxx",
      "algorithm": "FALCON-512",
      "owner_type": "organization",
      "owner_id": "PUBLIC-AUTHORITY-DEMO",
      "public_key": "<base64 897 bytes>",
      "private_key_encrypted": "<base64 AES-256-GCM ciphertext>",
      "encryption": {
        "algorithm": "aes-256-gcm",
        "kdf": "scrypt",
        "salt": "...",
        "iv": "...",
        "tag": "..."
      },
      "status": "active",
      "created_at": "2026-..."
    }
  ]
}

Private key encryption:
  INTERNAL_CRYPTO_SECRET → scrypt(salt) → AES-256-GCM key
  → Giải mã private key khi cần ký
```

---

### 2.4. Data Zone (File System Only)

**Mục đích:** Lưu trữ vật lý — file PDF, metadata JSON, audit logs, keystore. Không expose HTTP route.

**Cấu trúc storage:**
```
backend/storage/documents/{HS-2026-XXXXXXXX}/
    ├── original.pdf          # PDF gốc (từ preview)
    ├── signed.pdf            # PDF đã ký (nếu issued)
    ├── metadata.json         # Document record
    ├── signature-evidence.json  # Chi tiết chữ ký (2 records)
    └── qr/
        └── qr.png            # QR code (nếu issued)

backend/src/data/
    ├── users.json            # User accounts (JSON mode)
    ├── documents.json        # Document records (JSON mode)
    ├── document_signatures.json  # Signature records (JSON mode)
    ├── audit_logs.json       # Audit trail (JSON mode)
    └── household_members.json    # Household members (JSON mode)

backend/src/crypto/keys/
    └── falcon-keystore.json  # Encrypted Falcon-512 keys
```

**Dual-mode storage:**
- `DB_STORAGE_TYPE=json` (default): Đọc/ghi file JSON đồng bộ (blocking event loop)
- `DB_STORAGE_TYPE=mysql`: Connection pool mysql2/promise, schema tự migrate từ `DB/db.sql`

---

## 3. Middleware Chain tổng thể

```
Request →
    cors()                          # CORS headers
    → helmet()                      # Security headers (CSP, HSTS, ...)
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

## 4. Luồng dữ liệu end-to-end: Nộp → Ký → Xác minh

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
      │                  │                     │         CT01.pdf fill
      │◄─────────────────│                     │                     │
      │ preview_id       │                     │                     │
      │                  │                     │                     │
      │ POST /submit     │                     │                     │
      │─────────────────►│                     │                     │
      │                  │ submitDocument()     │                     │
      │                  │──────────────────────────────────────────►│
      │                  │                     │         original.pdf
      │◄─────────────────│                     │         status=submitted
      │ document_id      │                     │                     │
      │                  │                     │                     │
      │         ┌────────OFFICER────────┐      │                     │
      │         │ POST /{id}/sign       │      │                     │
      │         │──────────────────────►│      │                     │
      │         │                       │ signPayload()              │
      │         │                       │──────►│                    │
      │         │                       │       │ getPrivateKey()    │
      │         │                       │       │───────────────────►│
      │         │                       │       │ falcon-keystore    │
      │         │                       │       │◄───────────────────│
      │         │                       │       │ FALCON-512 sign    │
      │         │                       │◄──────│                    │
      │         │                       │                     │
      │         │                       │ generateQrCode()    │
      │         │                       │ embedQrIntoPdf()    │
      │         │                       │────────────────────────────►│
      │         │                       │                     signed.pdf
      │         │                       │                     metadata
      │         │◄──────────────────────│                     │
      │         │ issued                │                     │
      │         └───────────────────────┘                     │
      │                                                       │
      │    ┌───ANYONE (QR scan)───┐                          │
      │    │ GET /verify?id=&token=│                          │
      │    │──────────────────────►│                          │
      │    │                       │ verifyDocument()         │
      │    │                       │─────────────────────────►│
      │    │                       │               hash check + Falcon verify
      │    │◄──────────────────────│                          │
      │    │ valid: true/false     │                          │
      │    └───────────────────────┘                          │
```

---

## 5. Authentication Flow

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
      │ { message: "Registered" }      │
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
      │ GET /api/app/documents         │
      │ Cookie: token=JWT              │
      │───────────────────────────────►│
      │                                │ extractToken(): cookie > Bearer header
      │                                │ jwt.verify(token, JWT_SECRET)
      │                                │ req.user = { id, email, full_name, roles }
      │◄───────────────────────────────│
      │ [documents data]               │
      │                                │
      │ POST /api/auth/logout          │
      │───────────────────────────────►│
      │                                │ Clear cookie
      │◄───────────────────────────────│
      │ { message: "Logged out" }      │
```

**Roles:**
- `citizen`: Xem/submit hồ sơ của mình
- `officer`: Xem tất cả, ký số, từ chối
- `admin`: Toàn quyền (giống officer)

---

## 6. Đánh giá & nhận xét

### Điểm mạnh

| Aspect | Đánh giá |
|---|---|
| **Zone isolation** | 4 zones rõ ràng, mỗi zone có middleware bảo vệ riêng. Crypto zone được protect bằng shared secret, tách biệt khỏi business logic |
| **Crypto architecture** | 3-layer delegation (adapter → service → controller) clean, dễ thay đổi implementation Falcon |
| **Key management** | Private key encrypted AES-256-GCM + scrypt, không bao giờ expose trong response |
| **Canonical payload** | Alphabetical keys, snake_case, no whitespace → đảm bảo reproducible signatures |
| **verify NEVER throws** | `falconService.verify` và `verifyPayloadSignature` luôn trả boolean, không leak exception |
| **Audit logging** | Mọi operation quan trọng (sign, verify, key access) đều ghi audit log |
| **Rate limiting** | 3 tiers riêng biệt (global, auth, verify) chống abuse |
| **Dual-mode storage** | Repository pattern cho phép switch JSON ↔ MySQL mà không đổi business logic |

### Vấn đề còn tồn tại

| # | Severity | Issue | Zone |
|---|---|---|---|
| 1 | **HIGH** | JSON repos dùng `fs.readFileSync`/`writeFileSync` — block event loop trên mọi request | Data |
| 2 | **HIGH** | `listDocuments()` load ALL documents, filter in-memory — O(N), không pagination | App |
| 3 | **MEDIUM** | `securityHeaders` middleware đã define nhưng không được mount ở route nào | Global |
| 4 | **MEDIUM** | `household_members.repository.js` chỉ mới có JSON + MySQL mode, nhưng `saveMembersForDocument` trong controller gọi trực tiếp (không qua service layer) | App |
| 5 | **MEDIUM** | Crypto zone secret so sánh plain string (`providedSecret !== INTERNAL_CRYPTO_SECRET`) — nên dùng timing-safe comparison | Crypto |
| 6 | **LOW** | `GET /api/app/documents/verify/:documentId` và `POST /...` duplicate với public zone routes | App |
| 7 | **LOW** | Legacy endpoints (`/upload`, `/issue`) vẫn mount trong production (chỉ trả 410) — nên remove hoàn toàn | App |
| 8 | **LOW** | `getDocumentsByStatus` và `getDocumentsByOwner` gọi `getDocument()` cho mỗi doc → N+1 query pattern | App |

### Đề xuất cải thiện

1. **Async I/O cho JSON repos**: Chuyển `readFileSync`/`writeFileSync` sang `readFile`/`writeFile` (hoặc dùng `proper-lockfile` cho concurrency)
2. **Pagination**: Thêm `?page=1&limit=20` cho `listDocuments`, `getDocumentsByStatus`, `getDocumentsByOwner`
3. **Timing-safe comparison**: Dùng `crypto.timingSafeEqual()` cho `requireCryptoZoneAccess`
4. **Remove legacy endpoints**: Xóa `/upload` và `/issue` routes (hiện chỉ là dead code trong production)
5. **Wire up securityHeaders**: Mount `securityHeaders` middleware vào route chain hoặc xóa nếu redundant với helmet
6. **N+1 query optimization**: JOIN query trong MySQL mode, hoặc batch lookup trong JSON mode
