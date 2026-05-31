# NT219-Q22 Public Administrative Services via Citizen Services Portal

Demo cổng dịch vụ công cho đồ án mật mã học. Hệ thống mô phỏng quy trình công dân tạo hồ sơ hành chính, cán bộ xử lý/ký số PDF bằng Falcon-512, sau đó công dân hoặc bên thứ ba xác minh tài liệu bằng QR/token.

## Tính năng chính

- Đăng ký/đăng nhập người dùng bằng JWT.
- Phân quyền cơ bản theo vai trò `citizen`, `officer`, `admin`.
- Tạo bản xem trước PDF từ biểu mẫu CT01.
- Công dân nộp hồ sơ từ bản preview đã xác nhận.
- Cán bộ/admin xem hồ sơ chờ xử lý và ký số hồ sơ.
- Sinh QR và token xác minh cho tài liệu đã phát hành.
- Hash PDF bằng SHA-256 và ký payload bằng Falcon-512.
- Xác minh tài liệu công khai bằng QR/token hoặc upload PDF.
- Không expose trực tiếp thư mục PDF; file được tải qua controller có kiểm tra quyền.
- Hỗ trợ lưu dữ liệu bằng JSON file hoặc MySQL.
- Có audit log cho các hành động bảo mật quan trọng.

## Công nghệ sử dụng

| Thành phần | Công nghệ |
| --- | --- |
| Backend | Node.js, Express |
| Frontend | HTML, CSS, JavaScript tĩnh |
| Xác thực | JWT, httpOnly cookie, bcryptjs |
| Ký số | Falcon-512 qua `@noble/post-quantum` |
| Hash | SHA-256 |
| PDF | `pdf-lib`, `@pdf-lib/fontkit` |
| QR | `qrcode` |
| Upload | `multer` |
| Database | JSON file hoặc MySQL (`mysql2`) |
| Bảo mật request | `helmet`, `cors`, `express-rate-limit` |
| Test | Vitest |

## Kiến trúc tổng quan

```text
frontend/
    index.html
    login.html
    register.html
    verify.html
    citizen/dashboard.html
    officer/dashboard.html
    js/api.js
    js/auth.js

backend/src/
    server.js
    app.js
    routes/
    controllers/
    services/
    repositories/
    middlewares/
    crypto/
    validators/
    utils/

DB/
    db.sql
    seed.sql

docs/
    auth-flow-report.md
    backend-flow-report.md
    network-model.md
```

Backend serve trực tiếp frontend tại:

```text
http://localhost:3000
```

## Flow nghiệp vụ chính

```text
Công dân đăng ký / đăng nhập
    -> điền form CT01
    -> tạo preview PDF
    -> xem preview PDF
    -> nộp hồ sơ từ preview
    -> hồ sơ có trạng thái submitted
    -> cán bộ/admin đăng nhập
    -> xem danh sách hồ sơ chờ ký
    -> ký số hồ sơ
    -> backend nhúng QR vào PDF
    -> hash signed PDF
    -> ký payload bằng Falcon-512
    -> hồ sơ có trạng thái issued
    -> công dân tải PDF đã ký
    -> bên thứ ba xác minh bằng QR/token hoặc upload PDF
```

Payload được ký là canonical JSON:

```json
{
  "document_id": "HS-2026-XXXXXXXX",
  "file_hash": "sha256_hex_of_signed_pdf",
  "issued_at": "2026-05-31T00:00:00.000Z",
  "key_id": "falcon-development-key-xxxxxxxx",
  "version": "1.0"
}
```

Lưu ý quan trọng: hệ thống hash `signed.pdf` sau khi đã nhúng QR/metadata, nên chữ ký số bao phủ đúng file PDF cuối cùng được phát hành.

## Yêu cầu môi trường

- Node.js 18+.
- npm.
- MySQL nếu chạy `DB_STORAGE_TYPE=mysql`.
- Windows PowerShell có thể chặn `npm.ps1`; nếu gặp lỗi execution policy, dùng `npm.cmd`.

## Cài đặt

```powershell
cd backend
npm.cmd install
```

Nếu dùng bash/macOS/Linux:

```bash
cd backend
npm install
```

Root `package.json` chỉ chứa một số dependency phụ. Backend là phần chính cần cài và chạy.

## Cấu hình môi trường

Tạo file `.env` trong thư mục `backend` từ file mẫu:

```powershell
cd backend
Copy-Item .env.example .env
```

Ví dụ cấu hình local dùng JSON storage:

```env
NODE_ENV=development
PORT=3000

CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

JWT_SECRET=replace-with-a-long-random-secret-at-least-32-chars
JWT_EXPIRES_IN=24h

INTERNAL_CRYPTO_SECRET=replace-with-a-long-random-secret-at-least-32-chars
KEY_STORAGE_TYPE=file

PUBLIC_VERIFY_URL=http://localhost:3000/api/public/documents/verify

DB_STORAGE_TYPE=json
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=document_verification
DB_PORT=3306

AUDIT_TABLE=audit_logs
```

### JSON mode

```env
DB_STORAGE_TYPE=json
```

Dữ liệu được lưu trong:

```text
backend/src/data/users.json
backend/src/data/documents.json
backend/src/data/audit_logs.json
backend/storage/documents/
```

Mode này phù hợp nhất để chạy demo nhanh.

### MySQL mode

```env
DB_STORAGE_TYPE=mysql
```

Trước khi chạy server, tạo database/schema:

```powershell
mysql -u root -p < DB/db.sql
```

Nếu có dữ liệu seed riêng:

```powershell
mysql -u root -p document_verification < DB/seed.sql
```

Đảm bảo các biến sau đúng với máy local:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=document_verification
DB_PORT=3306
```

## Chạy hệ thống

Chạy backend:

```powershell
cd backend
npm.cmd start
```

Chạy bằng nodemon khi phát triển:

```powershell
cd backend
npm.cmd run dev
```

Mở trình duyệt:

```text
http://localhost:3000
```

## Tài khoản demo

Trong môi trường development, backend tự seed tài khoản mặc định nếu storage user trống.

```text
Officer
email: officer@test.com
password: officer123

Admin
email: admin@test.com
password: admin123
```

Công dân có thể đăng ký trực tiếp tại:

```text
http://localhost:3000/register.html
```

## API chính

### Auth

Mount path: `/api/auth`

| Method | Path | Mô tả |
| --- | --- | --- |
| `POST` | `/register` | Đăng ký tài khoản công dân. |
| `POST` | `/login` | Đăng nhập, nhận JWT và set httpOnly cookie. |
| `POST` | `/logout` | Xóa cookie JWT. |
| `GET` | `/me` | Lấy thông tin người dùng hiện tại, cần JWT. |

JWT được backend đọc theo thứ tự:

1. Cookie httpOnly tên `token`.
2. Header `Authorization: Bearer <token>`.

Frontend hiện vẫn lưu token trong `localStorage` để tương thích ngược, đồng thời gửi cookie với `credentials: "include"`.

### Application Zone

Mount path: `/api/app/documents`

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/` | Đã đăng nhập | Citizen xem hồ sơ của mình; officer/admin xem toàn bộ. |
| `POST` | `/preview` | Đã đăng nhập | Tạo preview PDF CT01. |
| `GET` | `/previews/:previewId/file` | Chủ preview hoặc officer/admin | Xem/tải preview PDF. |
| `POST` | `/submit` | Đã đăng nhập | Nộp hồ sơ từ preview, trạng thái `submitted`. |
| `GET` | `/:documentId` | Chủ hồ sơ hoặc officer/admin | Xem chi tiết hồ sơ. |
| `GET` | `/:documentId/download` | Chủ hồ sơ hoặc officer/admin | Tải PDF hồ sơ. |
| `GET` | `/:documentId/signed-pdf` | Chủ hồ sơ/officer/admin hoặc token hợp lệ | Tải PDF đã ký. |
| `GET` | `/pending` | officer/admin | Danh sách hồ sơ chờ ký. |
| `GET` | `/issued` | officer/admin | Danh sách hồ sơ đã phát hành. |
| `POST` | `/:documentId/sign` | officer/admin | Ký số và phát hành hồ sơ. |
| `POST` | `/upload` | officer/admin | Legacy: upload PDF và ký ngay. |
| `POST` | `/issue` | officer/admin | Legacy: submit và ký từ preview trong một request. |

### Public Zone

Mount path: `/api/public`

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/network-model` | Xem mô hình phân vùng mạng. |
| `GET` | `/documents/verify/:documentId?token=...` | Xác minh tài liệu bằng QR/token. |
| `POST` | `/documents/verify/:documentId` | Xác minh bằng upload PDF + token. |

### Crypto Zone

Mount path: `/api/internal/crypto`

Các endpoint này yêu cầu header:

```text
x-internal-crypto-secret: <INTERNAL_CRYPTO_SECRET>
```

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/public-key` | Lấy public key Falcon-512 đang active. |
| `POST` | `/sign` | Ký canonical payload. |
| `POST` | `/verify` | Xác minh chữ ký Falcon-512. |

## Lưu trữ file

PDF và QR được lưu theo từng hồ sơ:

```text
backend/storage/documents/{documentId}/
    preview.pdf
    original.pdf
    signed.pdf
    metadata.json
    qr/
        qr.png
```

Ý nghĩa:

| File | Sinh ở bước | Mô tả |
| --- | --- | --- |
| `preview.pdf` | Preview | Bản nháp từ form CT01. |
| `original.pdf` | Submit | Hồ sơ chính thức đã nộp. |
| `signed.pdf` | Sign | PDF đã nhúng QR và được ký số. |
| `metadata.json` | Submit/Sign | Metadata local của hồ sơ. |
| `qr/qr.png` | Sign | QR chứa link/payload xác minh. |

## Falcon keystore

Private key Falcon-512 được mã hóa và lưu tại:

```text
backend/src/crypto/keys/falcon-keystore.json
```

Keystore được sinh tự động khi hệ thống cần key lần đầu. Private key được mã hóa bằng:

- PBKDF2-HMAC-SHA256.
- AES-256-CBC.
- Secret lấy từ `INTERNAL_CRYPTO_SECRET`.

Nếu đổi `INTERNAL_CRYPTO_SECRET` sau khi đã có keystore cũ, backend sẽ không giải mã được private key cũ. Trong môi trường demo local, có thể backup/xóa `falcon-keystore.json` để hệ thống sinh keystore mới bằng secret hiện tại.

Không commit secret thật hoặc private key dùng cho production.

## Kiểm thử

Chạy test backend:

```powershell
cd backend
npm.cmd test -- --run
```

Hoặc:

```powershell
cd backend
npm.cmd run test:run
```

Test hiện có kiểm tra:

- Falcon-512 ký và xác minh payload hợp lệ.
- Payload bị sửa sẽ xác minh thất bại.
- Helper lọc hồ sơ theo chủ sở hữu.
- Officer/admin có thể xem toàn bộ hồ sơ.
- Thứ tự route document tránh route động nuốt route cố định.

## Tài liệu trong repo

| File | Nội dung |
| --- | --- |
| `docs/auth-flow-report.md` | Luồng xác thực chi tiết. |
| `docs/backend-flow-report.md` | Luồng xử lý backend chi tiết. |
| `docs/network-model.md` | Mô hình phân vùng mạng. |
| `DB/db.sql` | Schema MySQL. |
| `DB/seed.sql` | Dữ liệu seed tham khảo. |

## Ghi chú bảo mật

- Demo đã có JWT auth, RBAC cơ bản và rate limit.
- Cookie JWT dùng `httpOnly`, `sameSite=strict`, `secure` khi không phải development.
- Citizen không được xem hồ sơ của người khác.
- Officer/admin mới được ký và xem danh sách pending/issued toàn hệ thống.
- Token xác minh QR chỉ lưu dạng hash trong document.
- PDF đã ký được hash lại trước khi tải để phát hiện chỉnh sửa sau ký.
- Private key không expose qua API; chỉ public key được trả ra.
- Crypto Zone có secret riêng qua header nội bộ.
- Khi triển khai thật cần dùng HTTPS, secret mạnh, database có backup, audit log bền vững và quy trình rotate/revoke key rõ ràng.
