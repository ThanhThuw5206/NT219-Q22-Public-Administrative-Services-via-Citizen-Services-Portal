# Report chi tiết: Luồng xử lý Backend

## 1. Mục tiêu của backend

Backend của đồ án đóng vai trò trung tâm xử lý nghiệp vụ cho cổng dịch vụ công:

- Phục vụ frontend tĩnh HTML/CSS/JS.
- Cung cấp API đăng ký, đăng nhập và xác thực người dùng.
- Quản lý hồ sơ/tài liệu hành chính.
- Sinh bản xem trước PDF từ form CT01.
- Cho phép công dân nộp hồ sơ.
- Cho phép cán bộ/admin ký số hồ sơ bằng Falcon-512.
- Sinh QR/token để xác minh tài liệu công khai.
- Kiểm tra tính toàn vẹn của PDF đã ký bằng SHA-256 và chữ ký số.
- Ghi audit log cho các hành động bảo mật chính.
- Tách các vùng xử lý theo mô hình Public Zone, Application Zone, Crypto Zone.

Backend được viết bằng Node.js + Express theo kiến trúc nhiều lớp:

```text
HTTP Request
    -> Express app
    -> Global middleware
    -> Route middleware
    -> Controller
    -> Service nghiệp vụ
    -> Repository / Crypto / PDF / QR / Storage
    -> Database hoặc JSON file
    -> Response
```

## 2. Các file backend quan trọng

| Nhóm | File | Vai trò |
| --- | --- | --- |
| Khởi động | `backend/src/server.js` | Nạp env, mount middleware/route, serve frontend, start server. |
| Express app | `backend/src/app.js` | Tạo app, bật JSON parser, cookie parser, Helmet. |
| Env | `backend/src/config/env.config.js` | Chuẩn hóa biến môi trường, validate secret production. |
| Database | `backend/src/config/db.js` | Tạo MySQL connection pool. |
| Auth route | `backend/src/routes/auth.routes.js` | Khai báo endpoint `/api/auth`. |
| Auth controller | `backend/src/controllers/auth.controller.js` | Xử lý request auth. |
| Auth service | `backend/src/services/auth.service.js` | Đăng ký, đăng nhập, lấy user, seed user. |
| Document route | `backend/src/routes/document.routes.js` | Khai báo endpoint `/api/app/documents`. |
| Document controller | `backend/src/controllers/document.controller.js` | Xử lý request hồ sơ/tài liệu. |
| Document service | `backend/src/services/document.service1.js` | Điều phối vòng đời hồ sơ: preview -> submit -> sign -> verify. |
| Document repository | `backend/src/services/document.repository.js` | Lưu/đọc document từ JSON hoặc MySQL. |
| Preview service | `backend/src/services/preview.service.js` | Tạo PDF preview CT01. |
| Preview repository | `backend/src/repositories/preview.repository.js` | Lưu/đọc preview. |
| Crypto route | `backend/src/routes/crypto.routes.js` | Khai báo endpoint Crypto Zone. |
| Crypto controller | `backend/src/controllers/crypto.controller.js` | Ký, verify, lấy public key nội bộ. |
| Signature service | `backend/src/crypto/signature.service.js` | Tạo payload canonical, ký, verify Falcon-512. |
| Key manager | `backend/src/crypto/key-manager.service.js` | Quản lý keystore Falcon, mã hóa private key. |
| Falcon service | `backend/src/crypto/falcon/falcon.service.js` | Ký/verify bằng `@noble/post-quantum`. |
| Hash service | `backend/src/crypto/hash.service.js` | Hash file/text bằng SHA-256. |
| QR service | `backend/src/services/qr.service.js` | Sinh QR PNG cho tài liệu đã phát hành. |
| PDF service | `backend/src/services/pdf.service.js` | Nhúng QR và metadata vào PDF. |
| Audit service | `backend/src/services/audit.service.js` | Ghi audit log vào JSON hoặc MySQL. |
| Middleware auth | `backend/src/middlewares/auth.middleware.js` | Kiểm tra JWT. |
| Middleware role | `backend/src/middlewares/role.middleware.js` | Kiểm tra vai trò. |
| Middleware zone | `backend/src/middlewares/network-zone.middleware.js` | Gắn zone và bảo vệ Crypto Zone. |
| Rate limit | `backend/src/middlewares/rate-limit.middleware.js` | Chống brute-force/abuse request. |
| Error handler | `backend/src/middlewares/error-handler.middleware.js` | Xử lý 404/API error cuối pipeline. |
| Storage util | `backend/src/utils/storage.util.js` | Tạo thư mục lưu tài liệu. |
| Path validator | `backend/src/utils/path-validator.util.js` | Chống path traversal khi tải file. |
| CT01 validator | `backend/src/validators/ct01.validator.js` | Validate dữ liệu form CT01. |

## 3. Luồng khởi động server

File chính: `backend/src/server.js`

```text
node src/server.js
    -> import "dotenv/config"
    -> load app từ app.js
    -> import route/middleware/service cần thiết
    -> cấu hình CORS
    -> ensureStorageFolders()
    -> seedDefaultUsers()
    -> mount API routes
    -> serve frontend static
    -> mount 404 handler và error handler
    -> app.listen(PORT)
```

Chi tiết:

1. `dotenv/config` đọc biến môi trường từ `backend/.env`.
2. `app.js` tạo Express app và bật:
   - `helmet()`
   - `express.json()`
   - `cookieParser()`
3. `server.js` cấu hình CORS:
   - Origin mặc định: `http://localhost:3000`, `http://127.0.0.1:3000`
   - Cho phép `credentials: true` để gửi cookie JWT.
4. `ensureStorageFolders()` tạo thư mục `storage/documents` nếu chưa có.
5. `seedDefaultUsers()` tạo account demo trong môi trường dev nếu storage user trống.
6. Mount route:
   - `/api/auth`
   - `/api/public`
   - `/api/app/documents`
   - `/api/internal/crypto`
7. Serve frontend từ thư mục `frontend`.
8. API không khớp route sẽ đi vào `notFoundHandler`.
9. Lỗi cuối pipeline đi vào `errorHandler`.

## 4. Middleware pipeline tổng quát

### 4.1 Middleware toàn cục trong `app.js`

```text
Request
    -> helmet security headers
    -> express.json parse JSON body
    -> cookieParser parse Cookie header
```

Ý nghĩa:

- `helmet`: thêm header bảo mật cơ bản. CSP đang tắt vì frontend dùng inline script.
- `express.json`: cho phép đọc `req.body` với JSON request.
- `cookieParser`: cho phép đọc `req.cookies.token`.

### 4.2 Middleware trong `server.js`

```text
Request
    -> CORS
    -> /api globalLimiter
    -> route-specific limiter
    -> zone middleware
    -> auth/role/internal-secret middleware nếu cần
    -> controller
```

Rate limit:

| Middleware | Mount path | Giới hạn | Mục đích |
| --- | --- | --- | --- |
| `globalLimiter` | `/api` | 100 request/15 phút/IP | Bảo vệ chung. |
| `authLimiter` | `/api/auth` | 10 request/15 phút/IP | Giảm brute-force login/register. |
| `verifyLimiter` | `/api/public` | 30 request/15 phút/IP | Giảm spam public verification. |

## 5. Mô hình phân vùng backend

Backend chia API theo 3 vùng chính:

| Zone | Mount path | Middleware | Chức năng |
| --- | --- | --- | --- |
| Auth | `/api/auth` | `authLimiter` | Đăng ký, đăng nhập, logout, lấy profile. |
| Public Zone | `/api/public` | `verifyLimiter`, `attachNetworkZone(PUBLIC)` | Xác minh tài liệu công khai qua QR/token. |
| Application Zone | `/api/app/documents` | `attachNetworkZone(APPLICATION)` | Quản lý hồ sơ, preview, submit, sign, download. |
| Crypto Zone | `/api/internal/crypto` | `attachNetworkZone(CRYPTO)`, `requireCryptoZoneAccess` | Ký/verify/lấy public key nội bộ. |

`attachNetworkZone(zone)`:

- Gắn `req.networkZone = zone`.
- Set response header `X-Network-Zone`.

`requireCryptoZoneAccess`:

- Đọc header `x-internal-crypto-secret`.
- So sánh với `INTERNAL_CRYPTO_SECRET`.
- Nếu sai: ghi audit key access fail và trả `401`.
- Nếu đúng: cho request đi tiếp.

## 6. Luồng xác thực và phân quyền

### 6.1 Đăng ký

Endpoint: `POST /api/auth/register`

```text
Frontend gửi full_name, email, password
    -> auth.routes.js
    -> registerHandler
    -> kiểm tra thiếu field
    -> auth.service.register()
    -> validateRegistrationInput()
    -> kiểm tra email trùng
    -> bcrypt.hash(password, 10)
    -> lưu user
    -> gán role citizen
    -> trả user an toàn, không có password_hash
```

Storage tùy `DB_STORAGE_TYPE`:

- `json`: lưu vào `backend/src/data/users.json`.
- `mysql`: lưu vào bảng `users`, gán role qua `user_roles`.

### 6.2 Đăng nhập

Endpoint: `POST /api/auth/login`

```text
Frontend gửi email/password
    -> loginHandler
    -> auth.service.login()
    -> tìm user theo email
    -> kiểm tra status != locked
    -> bcrypt.compare(password, password_hash)
    -> lấy roles
    -> jwt.sign(payload, JWT_SECRET, expiresIn)
    -> res.cookie("token", JWT, httpOnly)
    -> trả token + user cho frontend
```

JWT payload:

```json
{
  "id": "user id",
  "email": "email",
  "full_name": "full name",
  "roles": ["citizen"]
}
```

### 6.3 Middleware `authenticate`

```text
Request tới route cần đăng nhập
    -> extractToken(req)
    -> ưu tiên cookie token
    -> nếu không có cookie thì đọc Authorization: Bearer
    -> jwt.verify(token, JWT_SECRET)
    -> nếu hợp lệ: req.user = payload rút gọn
    -> nếu thiếu/sai/hết hạn: 401
```

### 6.4 Middleware `requireRole`

```text
Request đã qua authenticate
    -> req.user.roles
    -> kiểm tra có ít nhất một role yêu cầu
    -> nếu không có: 403
    -> nếu có: next()
```

Các route yêu cầu officer/admin:

- `GET /api/app/documents/pending`
- `GET /api/app/documents/issued`
- `POST /api/app/documents/upload`
- `POST /api/app/documents/:documentId/sign`
- `POST /api/app/documents/issue` legacy

## 7. Bản đồ route backend

### 7.1 Auth route

| Method | Path | Handler | Middleware |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | `registerHandler` | `authLimiter` |
| `POST` | `/api/auth/login` | `loginHandler` | `authLimiter` |
| `POST` | `/api/auth/logout` | `logoutHandler` | `authLimiter` |
| `GET` | `/api/auth/me` | `meHandler` | `authLimiter`, `authenticate` |

### 7.2 Public route

Mount: `/api/public`

| Method | Path | Handler | Chức năng |
| --- | --- | --- | --- |
| `GET` | `/documents/verify/:documentId?token=...` | `verifyDocumentByQr` | Xác minh tài liệu bằng token/QR. |
| `POST` | `/documents/verify/:documentId` | `verifyDocumentByUpload` | Xác minh bằng upload PDF + token. |

### 7.3 Application document route

Mount: `/api/app/documents`

| Method | Path | Handler | Middleware | Chức năng |
| --- | --- | --- | --- | --- |
| `GET` | `/verify/:documentId` | `verifyDocumentByQr` | Không bắt buộc JWT | Route verify legacy/app. |
| `POST` | `/verify/:documentId` | `verifyDocumentByUpload` | Không bắt buộc JWT | Route upload verify legacy/app. |
| `GET` | `/:documentId/signed-pdf` | `downloadSignedDocument` | `optionalAuthenticate` | Tải PDF đã ký bằng JWT hoặc token. |
| `GET` | `/` | `listDocumentDetails` | `authenticate` | Danh sách hồ sơ theo quyền. |
| `POST` | `/preview` | `previewDocument` | `authenticate` | Tạo preview CT01. |
| `GET` | `/previews/:previewId/file` | `downloadPreviewDocument` | `authenticate` | Xem/tải preview PDF. |
| `POST` | `/submit` | `submitDocumentHandler` | `authenticate` | Nộp hồ sơ từ preview. |
| `GET` | `/:documentId/download` | `downloadDocumentFile` | `authenticate` | Tải file hồ sơ gốc/đã ký. |
| `GET` | `/pending` | `listPendingDocuments` | `authenticate`, `requireRole` | Hồ sơ chờ ký. |
| `GET` | `/issued` | `listIssuedDocuments` | `authenticate`, `requireRole` | Hồ sơ đã phát hành. |
| `POST` | `/upload` | `uploadDocument` | `authenticate`, `requireRole` | Legacy upload + ký ngay. |
| `POST` | `/:documentId/sign` | `signDocumentHandler` | `authenticate`, `requireRole` | Ký số hồ sơ. |
| `GET` | `/:documentId` | `getDocumentDetail` | `authenticate` | Xem chi tiết hồ sơ. |
| `POST` | `/issue` | `issueDocument` | `authenticate`, `requireRole` | Legacy submit + sign. |

Lưu ý thứ tự route:

- Các route cố định như `/pending`, `/issued`, `/previews/:previewId/file` phải được khai báo trước route động `/:documentId`.
- Route `/:documentId` đặt gần cuối để tránh nuốt nhầm các path khác.

### 7.4 Crypto route

Mount: `/api/internal/crypto`

| Method | Path | Handler | Middleware |
| --- | --- | --- | --- |
| `GET` | `/public-key` | `cryptoGetPublicKey` | `requireCryptoZoneAccess` |
| `POST` | `/sign` | `cryptoSign` | `requireCryptoZoneAccess` |
| `POST` | `/verify` | `cryptoVerify` | `requireCryptoZoneAccess` |

## 8. Luồng tạo preview CT01

Endpoint: `POST /api/app/documents/preview`

File liên quan:

- `document.controller.js`: `previewDocument`
- `ct01.validator.js`: `validateCT01`
- `preview.service.js`: `createPreviewDocument`
- `preview.repository.js`: `savePreview`
- `storage.util.js`: `createDocumentFolder`

Sequence chi tiết:

```text
Client gửi dữ liệu form CT01
    -> authenticate kiểm tra JWT
    -> previewDocument(req, res)
    -> normalize field:
        cccd = citizen_id nếu thiếu
        reason = request_content nếu thiếu
        dob = birth_year-birth_month-birth_day nếu thiếu
    -> validateCT01(req.body)
    -> createPreviewDocument(data + owner_id)
        -> previewId = randomUUID()
        -> documentId = HS-{year}-{8 ký tự UUID}
        -> createDocumentFolder(documentId)
        -> previewPath = storage/documents/{documentId}/preview.pdf
        -> đọc template src/templates/CT01.pdf
        -> nhúng font Roboto
        -> drawText dữ liệu lên PDF
        -> drawText danh sách members tối đa 8 dòng
        -> pdfDoc.save()
        -> ghi preview.pdf
        -> expired_at = now + 15 phút
        -> savePreview()
    -> trả preview_id, document_id, preview_url, file_path, form_data
```

Output chính:

```json
{
  "message": "Preview generated",
  "data": {
    "preview_id": "uuid",
    "document_id": "HS-2026-XXXXXXXX",
    "preview_url": "/api/app/documents/previews/{previewId}/file",
    "file_path": "storage/documents/HS-.../preview.pdf",
    "form_data": {}
  }
}
```

Ý nghĩa:

- Preview là bản PDF nháp, chưa được xem là hồ sơ đã nộp.
- Preview có hạn dùng 15 phút.
- Preview gắn với `owner_id`, giúp chỉ chủ preview hoặc officer/admin được xem.

## 9. Luồng tải/xem preview

Endpoint: `GET /api/app/documents/previews/:previewId/file`

```text
Client yêu cầu file preview
    -> authenticate
    -> downloadPreviewDocument
    -> getPreviewById(previewId)
    -> nếu không tồn tại: 404
    -> kiểm tra owner hoặc officer/admin
    -> nếu không có quyền: 403
    -> kiểm tra preview_path tồn tại
    -> validateFilePath(preview.preview_path, uploadDirectory)
    -> fs.existsSync(safePath)
    -> res.sendFile(safePath)
```

Mục tiêu bảo mật:

- Không expose thư mục PDF tĩnh.
- Mọi file preview đều đi qua controller.
- Kiểm tra quyền truy cập trước khi gửi file.
- Validate path để giảm rủi ro path traversal.

## 10. Luồng công dân nộp hồ sơ

Endpoint: `POST /api/app/documents/submit`

File liên quan:

- `document.controller.js`: `submitDocumentHandler`
- `preview.service.js`: `getPreviewById`
- `document.service1.js`: `submitDocument`
- `document.repository.js`: `saveDocument`
- `audit.service.js`: `writeAuditLog`
- `household_members.repository.js`: `saveMembersForDocument`

Sequence chi tiết:

```text
Client gửi form CT01 + preview_id
    -> authenticate
    -> submitDocumentHandler
    -> normalize field giống preview
    -> validateCT01(req.body)
    -> getPreviewById(req.body.preview_id)
    -> nếu preview không tồn tại: 404
    -> nếu preview hết hạn: 400
    -> kiểm tra preview.owner_id == req.user.id nếu preview có owner
    -> kiểm tra preview file tồn tại
    -> submitDocument({
           documentId: preview.document_id,
           filePath: preview.preview_path,
           originalName: "CT01.pdf",
           ownerId: req.user.id,
           ipAddress: req.ip
       })
```

Bên trong `submitDocument`:

```text
submitDocument
    -> folder = createDocumentFolder(documentId)
    -> originalPdfPath = folder/original.pdf
    -> move preview.pdf sang original.pdf
    -> originalFileHash = SHA-256(original.pdf)
    -> createdAt = now
    -> token = random 32 bytes base64url
    -> tokenHash = SHA-256(token)
    -> tạo record status = submitted
    -> file_hash ban đầu = originalFileHash
    -> signed_pdf_path = null
    -> signature = ""
    -> verify_url = null
    -> saveDocument(record)
    -> ghi metadata.json vào folder
    -> writeAuditLog(action="submit", result="success")
    -> trả document_id, status, created_at
```

Nếu request có `members`, controller gọi:

```text
saveMembersForDocument(preview.document_id, members)
```

Trạng thái sau bước này:

| Trường | Giá trị |
| --- | --- |
| `status` | `submitted` |
| `file_path` | `storage/documents/{documentId}/original.pdf` |
| `original_file_hash` | Hash của PDF gốc |
| `file_hash` | Tạm thời bằng hash PDF gốc |
| `signature` | Rỗng |
| `signed_pdf_path` | `null` |
| `verify_url` | `null` |
| `token_hash` | Có token hash, nhưng token phát hành chính thức sẽ được tạo lại khi ký |

## 11. Luồng xem danh sách hồ sơ

Endpoint: `GET /api/app/documents/`

```text
Client gọi danh sách
    -> authenticate
    -> listDocumentDetails
    -> nếu user role officer/admin:
           getDocuments()
       ngược lại:
           getDocumentsByOwner(req.user.id)
    -> trả danh sách
```

Logic quyền:

- `officer/admin`: xem toàn bộ hồ sơ.
- `citizen`: chỉ xem hồ sơ có `owner_id` trùng `req.user.id`.

Trong `getDocument(documentId)`, service:

- Đọc document từ repository.
- Gọi `getUserById(document.owner_id)` để lấy `owner_name`.
- Trả object đã rút gọn, có `signed_pdf_url` nếu đã có PDF ký.

## 12. Luồng xem chi tiết hồ sơ

Endpoint: `GET /api/app/documents/:documentId`

```text
Client gọi document detail
    -> authenticate
    -> getDocumentDetail
    -> getDocument(documentId)
    -> nếu không tồn tại: 404
    -> canAccessDocument(req.user, document)
        -> officer/admin: true
        -> citizen: document.owner_id == user.id
    -> nếu không có quyền: 403
    -> res.json(document)
```

Đây là lớp kiểm soát truy cập cấp controller, bổ sung cho `authenticate`.

## 13. Luồng cán bộ xem hồ sơ chờ ký

Endpoint: `GET /api/app/documents/pending`

```text
Client officer/admin gọi pending
    -> authenticate
    -> requireRole("officer", "admin")
    -> listPendingDocuments
    -> getDocumentsByStatus("submitted")
    -> listDocuments()
    -> filter status submitted
    -> map getDocument()
    -> sort created_at giảm dần
    -> trả danh sách
```

Endpoint hồ sơ đã ký tương tự nhưng dùng `status = "issued"` và sort theo `signed_at`.

## 14. Luồng ký số và phát hành hồ sơ

Endpoint: `POST /api/app/documents/:documentId/sign`

File liên quan:

- `document.controller.js`: `signDocumentHandler`
- `document.service1.js`: `signDocument`
- `qr.service.js`: `generateQrCode`
- `pdf.service.js`: `embedQrIntoPdf`
- `hash.service.js`: `hashFile`, `hashText`
- `signature.service.js`: `getActiveKey`, `buildSignaturePayload`, `signPayload`
- `key-manager.service.js`: lấy public/private key
- `document.repository.js`: `updateDocument`
- `audit.service.js`: `writeAuditLog`

Sequence tổng quát:

```text
Officer/Admin bấm ký
    -> authenticate
    -> requireRole("officer", "admin")
    -> signDocumentHandler
    -> signDocument({ documentId, officerId, ipAddress })
    -> trả thông tin tài liệu đã phát hành
```

Bên trong `signDocument`:

```text
signDocument(documentId)
    -> findDocumentById(documentId)
    -> nếu không tồn tại: throw "Document not found"
    -> nếu status != submitted: throw "Cannot sign document with status ..."
    -> documentFolder = createDocumentFolder(documentId)
    -> issuedAt = now ISO
    -> activeKey = getActiveKey()
    -> token = random 32 bytes base64url
    -> verifyUrl = PUBLIC_VERIFY_URL/{documentId}?token={token}
    -> ownerName = getUserById(document.owner_id).full_name nếu có
```

Bước 1: Sinh QR

```text
generateQrCode({ documentId, verifyUrl, token, status: "issued", ownerName })
    -> validate documentId/verifyUrl/token/status/ownerName
    -> createDocumentFolder(documentId)
    -> tạo folder qr
    -> buildQrPayload()
    -> QRCode.toFile(qr.png, payload, errorCorrectionLevel="H", width=300)
    -> trả qrImagePath
```

Bước 2: Nhúng QR vào PDF

```text
embedQrIntoPdf({
    sourceFilePath: document.file_path,
    qrPath: qrImagePath,
    outputFilePath: folder/signed.pdf,
    metadata: {
        document_id,
        verify_url,
        algorithm,
        key_id,
        issued_at,
        status,
        owner_name
    }
})
```

Kết quả là `signed.pdf` có QR và metadata hiển thị/nhúng trong file.

Bước 3: Hash PDF đã ký

```text
fileHash = SHA-256(signed.pdf)
```

Quan trọng: hash được tính sau khi nhúng QR. Nhờ vậy chữ ký số bao phủ đúng file cuối cùng mà người dùng tải về.

Bước 4: Tạo payload canonical

```text
payload = buildSignaturePayload({
    documentId,
    fileHash,
    issuedAt,
    keyId: activeKey.key_id,
    version: 1
})
```

Payload canonical thực tế có `version = "1.0"` và được chuẩn hóa thành JSON string ổn định.

Ví dụ:

```json
{"document_id":"HS-2026-XXXXXXXX","file_hash":"...","issued_at":"2026-05-31T...Z","key_id":"falcon-development-key-...","version":"1.0"}
```

Bước 5: Ký Falcon-512

```text
signPayload(payload)
    -> getActivePublicKey()
    -> getPrivateKey(activeKey.key_id, INTERNAL_CRYPTO_SECRET)
    -> giải mã private key từ falcon-keystore.json
    -> falconService.sign(payload, privateKeyBase64)
    -> trả signature, key_id, algorithm, provider
```

Bước 6: Cập nhật document

```text
updateDocument(documentId, {
    status: "issued",
    signed_at: issuedAt,
    signed_pdf_path: signedFilePath,
    file_hash: fileHash,
    signature,
    signature_payload: payload,
    algorithm: "FALCON-512",
    signature_provider,
    public_key_id,
    public_key,
    token_hash: SHA-256(token),
    verify_url,
    qr_payload
})
```

Bước 7: Ghi metadata và audit

```text
ghi storage/documents/{documentId}/metadata.json
writeAuditLog(action="sign", userId=officerId, result="success")
```

Output trả về:

```json
{
  "document_id": "HS-2026-XXXXXXXX",
  "file_hash": "sha256 signed pdf",
  "signature": "base64 falcon signature",
  "algorithm": "FALCON-512",
  "public_key_id": "falcon-development-key-...",
  "verify_url": "http://localhost:3000/api/public/documents/verify/HS-...?token=...",
  "signed_pdf_url": "/api/app/documents/HS-.../signed-pdf",
  "status": "issued",
  "signed_at": "ISO datetime"
}
```

## 15. Luồng tải PDF gốc/đã ký qua session

Endpoint: `GET /api/app/documents/:documentId/download`

```text
Client tải file
    -> authenticate
    -> downloadDocumentFile
    -> getDocument(documentId)
    -> nếu không tồn tại: 404
    -> canAccessDocument(user, document)
    -> nếu không có quyền: 403
    -> getDocumentFile(documentId)
        -> ưu tiên signed_pdf_path nếu có
        -> nếu chưa ký thì dùng file_path
    -> validateFilePath(filePath, uploadDirectory)
    -> kiểm tra file tồn tại
    -> res.download(safePath, fileName)
```

Tên file:

- Hồ sơ đã ký: `{document_id}-signed.pdf`
- Hồ sơ chưa ký: `{document_id}-original.pdf`

## 16. Luồng tải PDF đã ký bằng JWT hoặc token

Endpoint: `GET /api/app/documents/:documentId/signed-pdf`

Middleware: `optionalAuthenticate`

Đây là route đặc biệt: cho phép tải PDF đã ký nếu có một trong hai điều kiện:

1. Có JWT hợp lệ và có quyền truy cập document.
2. Có verification token hợp lệ trong query `?token=...`.

Sequence:

```text
Client tải signed-pdf
    -> optionalAuthenticate
    -> nếu có JWT hợp lệ thì req.user được gắn
    -> downloadSignedDocument
    -> getDocument(documentId)
    -> nếu không tồn tại: 404
    -> nếu query token tồn tại:
           verifyDocument(documentId, token)
           tokenAllowed = result.valid
    -> nếu token không hợp lệ và user không có quyền:
           nếu có req.user: 403
           nếu không có req.user: 401
    -> getSignedDocumentFile(documentId)
    -> validateFilePath
    -> kiểm tra file tồn tại
    -> hash lại signed.pdf hiện tại
    -> so sánh currentHash với document.file_hash
    -> nếu khác: 403 tampered=true
    -> res.download(signed.pdf)
```

Điểm quan trọng:

- Trước khi tải, backend hash lại file trên đĩa.
- Nếu PDF bị sửa sau khi ký, tải bị từ chối.
- Token tải file reuse logic `verifyDocument`, nên token phải đúng và document phải valid.

## 17. Luồng xác minh tài liệu qua QR/token

Endpoint public: `GET /api/public/documents/verify/:documentId?token=...`

File liên quan:

- `document.controller.js`: `verifyDocumentByQr`
- `document.service1.js`: `verifyDocument`
- `hash.service.js`
- `signature.service.js`
- `audit.service.js`

Sequence:

```text
Bên thứ ba scan QR hoặc nhập documentId/token
    -> /api/public/documents/verify/:documentId?token=...
    -> verifyLimiter
    -> attachNetworkZone(PUBLIC)
    -> verifyDocumentByQr
    -> verifyDocument({ documentId, token, userId=null, ipAddress })
```

Bên trong `verifyDocument`:

```text
verifyDocument
    -> findDocumentById(documentId)
    -> nếu không có:
           audit verify fail
           return DOCUMENT_NOT_FOUND
    -> hashText(token || "")
    -> so sánh với document.token_hash
    -> nếu sai:
           audit verify fail
           return INVALID_TOKEN
    -> kiểm tra document.status == issued
    -> nếu không:
           audit verify fail
           return DOCUMENT_NOT_ACTIVE
    -> xác định currentHash:
           nếu có filePath upload: hash file upload
           nếu không có upload và signed_pdf_path tồn tại: hash signed.pdf trên đĩa
           nếu không có file trên đĩa: fallback document.file_hash
    -> hashMatched = currentHash == document.file_hash
    -> lấy issuedAt từ signature_payload.issued_at nếu có
    -> buildSignaturePayload(documentId, currentHash, issuedAt, public_key_id)
    -> verifyPayloadSignature(payload, signature, publicKey)
    -> valid = hashMatched && signatureValid
    -> audit verify success/fail
    -> trả kết quả
```

Response thành công:

```json
{
  "valid": true,
  "reason": "VALID_DOCUMENT",
  "document_id": "HS-2026-XXXXXXXX",
  "file_hash": "...",
  "current_hash": "...",
  "hash_matched": true,
  "signature_valid": true,
  "algorithm": "FALCON-512",
  "public_key_id": "falcon-development-key-...",
  "status": "issued",
  "signed_at": "..."
}
```

Response thất bại thường gặp:

| `reason` | Ý nghĩa |
| --- | --- |
| `DOCUMENT_NOT_FOUND` | Không có document id trong storage. |
| `INVALID_TOKEN` | Token query không khớp `token_hash`. |
| `DOCUMENT_NOT_ACTIVE` | Document chưa ở trạng thái `issued`. |
| `TAMPERED_OR_INVALID_SIGNATURE` | Hash file không khớp hoặc chữ ký Falcon không hợp lệ. |

## 18. Luồng xác minh bằng upload PDF

Endpoint public: `POST /api/public/documents/verify/:documentId`

Input:

- Multipart form-data.
- Field file: `file`
- Token: `body.token` hoặc query `?token=...`

Sequence:

```text
Client upload PDF + token
    -> verifyLimiter
    -> verifyDocumentByUpload
    -> multer.single("file")
    -> kiểm tra mimetype == application/pdf
    -> nếu không có file: 400
    -> verifyDocument({
           documentId,
           token,
           filePath: req.file.path,
           userId,
           ipAddress
       })
    -> verifyDocument hash file upload
    -> so sánh với file_hash đã ký
    -> verify chữ ký Falcon trên payload dùng currentHash
    -> trả valid/invalid
```

Khác với verify QR không upload:

- Verify QR hash file `signed.pdf` đang lưu trên server.
- Verify upload hash file do người dùng cung cấp.
- Upload verify phù hợp khi bên thứ ba muốn kiểm tra một PDF họ nhận được có đúng là bản đã phát hành không.

## 19. Luồng Crypto Zone nội bộ

Crypto Zone nằm ở `/api/internal/crypto` và bắt buộc header:

```text
x-internal-crypto-secret: <INTERNAL_CRYPTO_SECRET>
```

### 19.1 Lấy public key

Endpoint: `GET /api/internal/crypto/public-key`

```text
Request nội bộ
    -> requireCryptoZoneAccess
    -> cryptoGetPublicKey
    -> getActiveKey()
    -> keyManager.getActivePublicKey()
    -> trả key_id, algorithm, provider, status, public_key, created_at
```

### 19.2 Ký payload

Endpoint: `POST /api/internal/crypto/sign`

```text
Request body { payload }
    -> requireCryptoZoneAccess
    -> cryptoSign
    -> validate payload object
    -> buildSignaturePayload(payload)
    -> signPayload(canonicalPayload)
    -> audit sign success/fail
    -> trả signature, key_id, algorithm, provider, signed_at
```

### 19.3 Verify chữ ký

Endpoint: `POST /api/internal/crypto/verify`

```text
Request body { payload, signature, public_key }
    -> requireCryptoZoneAccess
    -> cryptoVerify
    -> validate input
    -> verifyPayloadSignature()
    -> audit verify
    -> trả { valid: true/false }
```

## 20. Luồng quản lý key Falcon-512

File chính: `backend/src/crypto/key-manager.service.js`

Keystore:

```text
backend/src/crypto/keys/falcon-keystore.json
```

Cấu trúc một key:

```json
{
  "key_id": "falcon-development-key-ab12cd34",
  "algorithm": "FALCON-512",
  "provider": "file",
  "status": "active",
  "public_key": "base64 public key",
  "encrypted_private_key": "base64 salt+iv+ciphertext",
  "created_at": "ISO datetime"
}
```

### 20.1 Lazy initialization

```text
getActivePublicKey()
    -> ensureKeystoreInitialized()
    -> nếu keystore chưa tồn tại:
           generate Falcon-512 key pair
           encrypt private key bằng INTERNAL_CRYPTO_SECRET
           ghi falcon-keystore.json
    -> tìm key status active
    -> trả public metadata + public_key
```

### 20.2 Mã hóa private key

Private key không lưu plaintext.

```text
privateKeyBytes
    -> PBKDF2-HMAC-SHA256(INTERNAL_CRYPTO_SECRET, salt, 10000 iterations)
    -> AES-256-CBC encrypt với IV ngẫu nhiên
    -> lưu salt + iv + ciphertext dạng base64
```

### 20.3 Lấy private key để ký

```text
getPrivateKey(keyId, internalSecret)
    -> kiểm tra internalSecret == INTERNAL_CRYPTO_SECRET
    -> nếu sai: audit fail, throw UNAUTHORIZED
    -> đọc keystore
    -> tìm keyId
    -> decrypt encrypted_private_key
    -> trả private key base64
```

Nếu đổi `INTERNAL_CRYPTO_SECRET` sau khi đã có keystore cũ, private key cũ sẽ không giải mã được. Khi chạy local, có thể cần backup/xóa keystore để hệ thống sinh key mới bằng secret hiện tại.

## 21. Luồng repository và storage

Backend hỗ trợ hai mode storage qua `DB_STORAGE_TYPE`:

```text
DB_STORAGE_TYPE=json
DB_STORAGE_TYPE=mysql
```

### 21.1 JSON mode

| Dữ liệu | File |
| --- | --- |
| Users | `backend/src/data/users.json` |
| Documents | `backend/src/data/documents.json` |
| Audit logs | `backend/src/data/audit_logs.json` |
| PDF/QR/metadata | `backend/storage/documents/{documentId}/...` |

JSON mode phù hợp demo vì dễ chạy không cần database.

### 21.2 MySQL mode

MySQL dùng các bảng chính:

| Bảng | Vai trò |
| --- | --- |
| `users` | Người dùng. |
| `roles` | Vai trò. |
| `user_roles` | Gán role cho user. |
| `documents` | Metadata hồ sơ/tài liệu. |
| `document_previews` | Preview PDF. |
| `audit_logs` | Nhật ký hành động. |
| `household_member_changes` | Thành viên hộ gia đình trong form. |

Repository document trong MySQL:

- `findDocumentById(documentId)`: `SELECT * FROM documents WHERE document_id = ?`
- `saveDocument(doc)`: `INSERT INTO documents (...)`
- `updateDocument(documentId, updated)`: `UPDATE documents SET ...`
- `listDocuments()`: `SELECT * FROM documents`

Các trường JSON như `qr_payload`, `signature_payload` được parse/stringify khi đọc/ghi.

### 21.3 File storage

Root:

```text
storage/documents
```

Mỗi document có folder riêng:

```text
storage/documents/{documentId}/
    preview.pdf
    original.pdf
    signed.pdf
    metadata.json
    qr/
        qr.png
```

Ý nghĩa:

| File | Sinh ở bước | Vai trò |
| --- | --- | --- |
| `preview.pdf` | Preview | Bản nháp để công dân xem trước. |
| `original.pdf` | Submit | Hồ sơ chính thức đã nộp, chưa ký. |
| `signed.pdf` | Sign | PDF đã nhúng QR/metadata và được ký số. |
| `metadata.json` | Submit/Sign | Metadata local của hồ sơ. |
| `qr/qr.png` | Sign | QR chứa verify URL/payload. |

## 22. Luồng audit log

File: `backend/src/services/audit.service.js`

Các action hợp lệ:

```text
submit, sign, verify, download, login, logout, key_access
```

Hàm chính:

```text
writeAuditLog({ action, documentId, result, userId, ipAddress })
```

Luồng:

```text
Service/controller gọi writeAuditLog
    -> chuẩn hóa action
    -> tạo entry
    -> nếu DB_STORAGE_TYPE=mysql:
           INSERT INTO audit_logs
       ngược lại:
           append vào src/data/audit_logs.json
    -> nếu lỗi audit:
           console.warn
           không làm fail nghiệp vụ chính
```

Các chỗ đang ghi audit:

- Submit hồ sơ: `action = submit`
- Ký hồ sơ: `action = sign`
- Verify tài liệu: `action = verify`
- Truy cập private key/Crypto Zone: `action = key_access`

## 23. Luồng xử lý lỗi

Controller document dùng helper `safeError(res, error, statusCode = 500)`.

Trong development:

- Trả `error.message` trực tiếp để dễ debug.

Trong production:

- Chỉ trả các lỗi an toàn đã whitelist.
- Lỗi không xác định trả `"An error occurred"`.

Auth controller dùng `getSafeAuthError(error)`:

- Các lỗi auth phổ biến được trả rõ:
  - Email đã đăng ký.
  - Sai email/password.
  - Account locked.
- Production ẩn lỗi lạ bằng message generic.

Crypto controller dùng `getSafeCryptoError(error, operation)`:

- Dev trả thêm `reason`.
- Production chỉ trả operation failed.

## 24. Luồng bảo vệ file và chống path traversal

Các endpoint tải file không serve trực tiếp thư mục storage. Thay vào đó:

```text
Client request file
    -> controller kiểm tra quyền
    -> lấy file path từ repository/service
    -> validateFilePath(filePath, allowedBaseDirectory)
    -> kiểm tra fs.existsSync
    -> res.download hoặc res.sendFile
```

Ý nghĩa:

- Người dùng không thể đoán URL file trong filesystem để tải trực tiếp.
- Backend có cơ hội kiểm tra JWT, role, owner và token trước khi trả file.
- `validateFilePath` giảm rủi ro path traversal.

## 25. Luồng legacy

Backend vẫn giữ một số endpoint cũ để tương thích:

### 25.1 `POST /api/app/documents/upload`

```text
Officer/Admin upload PDF
    -> multer nhận file PDF
    -> processDocument()
    -> move file thành original.pdf
    -> hash
    -> sinh QR
    -> embed QR
    -> hash signed PDF
    -> ký Falcon
    -> update status issued
```

Đây là flow cũ: upload và ký trong một bước.

### 25.2 `POST /api/app/documents/issue`

```text
Officer/Admin gửi preview_id
    -> getPreviewById
    -> submitDocument()
    -> signDocument()
    -> trả document đã issued
```

Đây là flow cũ: submit và sign ngay trong cùng request.

Flow chính hiện tại nên dùng:

```text
preview -> submit -> officer/admin sign -> verify/download
```

## 26. Luồng dữ liệu tổng hợp toàn hệ thống

```text
1. Công dân đăng ký / đăng nhập
    -> /api/auth/register
    -> /api/auth/login
    -> nhận JWT/cookie

2. Công dân tạo preview
    -> POST /api/app/documents/preview
    -> backend sinh preview.pdf từ CT01.pdf template
    -> lưu preview record

3. Công dân xem preview
    -> GET /api/app/documents/previews/:previewId/file
    -> backend kiểm tra owner
    -> trả preview.pdf

4. Công dân nộp hồ sơ
    -> POST /api/app/documents/submit
    -> backend move preview.pdf thành original.pdf
    -> hash original.pdf
    -> lưu document status submitted
    -> audit submit

5. Cán bộ xem hồ sơ chờ ký
    -> GET /api/app/documents/pending
    -> authenticate + requireRole officer/admin
    -> filter status submitted

6. Cán bộ ký hồ sơ
    -> POST /api/app/documents/:documentId/sign
    -> sinh token + verifyUrl
    -> sinh QR
    -> nhúng QR vào original.pdf thành signed.pdf
    -> hash signed.pdf
    -> build canonical payload
    -> Falcon-512 sign
    -> update document status issued
    -> audit sign

7. Công dân tải PDF đã ký
    -> GET /api/app/documents/:documentId/signed-pdf
    -> optional JWT hoặc token
    -> hash lại file chống sửa đổi
    -> res.download

8. Bên thứ ba xác minh
    -> GET /api/public/documents/verify/:documentId?token=...
    -> kiểm tra token hash
    -> hash signed.pdf
    -> verify chữ ký Falcon
    -> trả valid/invalid

9. Bên thứ ba upload PDF để xác minh
    -> POST /api/public/documents/verify/:documentId
    -> hash PDF upload
    -> verify chữ ký với hash upload
    -> trả valid/invalid
```

## 27. Các điểm mạnh của backend hiện tại

- Tách lớp route/controller/service/repository tương đối rõ.
- Có JWT auth và RBAC cơ bản.
- Có httpOnly cookie cho JWT.
- Có rate limit cho API/auth/public verify.
- Không expose trực tiếp thư mục PDF.
- Có verify token riêng cho QR.
- Token xác minh chỉ lưu dạng hash.
- PDF đã ký được hash sau khi nhúng QR, đúng với file phát hành cuối cùng.
- Chữ ký Falcon-512 bao phủ payload chứa `document_id`, `file_hash`, `issued_at`, `key_id`, `version`.
- Private key Falcon được mã hóa trong keystore bằng AES-256-CBC + PBKDF2.
- Có audit log cho submit/sign/verify/key access.
- Hỗ trợ JSON mode cho demo và MySQL mode cho triển khai mở rộng.

## 28. Các điểm cần chú ý khi vận hành

- Nếu `DB_STORAGE_TYPE=mysql`, cần tạo schema MySQL trước bằng `DB/db.sql` và đảm bảo MySQL đang chạy.
- Nếu đổi `INTERNAL_CRYPTO_SECRET`, keystore Falcon cũ sẽ không giải mã được. Cần rotate key đúng quy trình hoặc backup/xóa keystore local để sinh key mới trong môi trường demo.
- Frontend vẫn lưu JWT trong `localStorage` để tương thích ngược; backend đã có httpOnly cookie nên có thể cải thiện bằng cách bỏ token khỏi localStorage.
- `authLimiter` đang gắn cho toàn bộ `/api/auth`, bao gồm cả `/me` và `/logout`.
- JWT chứa role trong token; nếu đổi role/lock user sau khi token đã cấp, token cũ vẫn còn hiệu lực tới khi hết hạn nếu middleware không re-check DB.
- Một số endpoint legacy còn tồn tại, nên khi trình bày đồ án cần nhấn mạnh flow chính là `preview -> submit -> sign -> verify`.

## 29. Kết luận

Backend hiện tại xử lý đầy đủ vòng đời hồ sơ dịch vụ công:

```text
Xác thực người dùng
    -> tạo preview PDF
    -> nộp hồ sơ
    -> cán bộ ký số Falcon-512
    -> sinh QR/token
    -> phát hành PDF đã ký
    -> xác minh công khai bằng hash + chữ ký
```

Luồng xử lý được chia thành các lớp rõ ràng, phù hợp để trình bày trong đồ án: Express route nhận request, controller kiểm tra đầu vào/quyền, service điều phối nghiệp vụ, repository lưu dữ liệu, crypto/PDF/QR service xử lý bảo mật và tài liệu, audit service ghi nhận hành động.
