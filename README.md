# NT219-Q22 Public Administrative Services Portal

Demo cổng dịch vụ công cho đồ án mật mã học: công dân nộp hồ sơ hành chính, cán bộ ký số PDF bằng Falcon-512, công dân hoặc bên thứ ba xác minh tài liệu bằng QR/token.

## Trạng thái hiện tại

- Backend: Node.js + Express.
- Frontend: HTML/CSS/JS tĩnh, được backend serve tại `http://localhost:3000`.
- Lưu trữ demo: JSON file trong `backend/src/data` và PDF trong `backend/storage/documents`.
- Thư mục PDF không được expose tĩnh; preview/signed PDF được tải qua controller có JWT hoặc token xác minh.
- `DB/db.sql` là schema tham khảo/mở rộng MySQL, chưa phải storage chính của flow demo hiện tại.
- Ký số: Falcon-512 qua `@noble/post-quantum`.
- Hash tài liệu: SHA-256.
- Khóa riêng Falcon được mã hóa trong file keystore bằng AES-256-CBC + PBKDF2.

## Flow chính

```text
Công dân đăng ký / đăng nhập
    -> điền form CT01
    -> xem preview PDF
    -> nộp hồ sơ từ preview đã xác nhận, trạng thái submitted
    -> cán bộ đăng nhập
    -> xem danh sách hồ sơ chờ duyệt
    -> ký số hồ sơ
    -> backend nhúng QR, hash signed PDF, ký payload bằng Falcon-512
    -> trạng thái issued
    -> công dân tải PDF đã ký hoặc xác minh bằng token/QR
```

Payload được ký có dạng canonical JSON:

```json
{
  "document_id": "HS-2026-XXXXXXXX",
  "file_hash": "sha256_hex_of_signed_pdf",
  "issued_at": "2026-05-24T00:00:00.000Z",
  "key_id": "falcon-development-key-xxxxxxxx",
  "version": "1.0"
}
```
# Cài package

```bash
npm install qrcode fs-extra

npm install pdf-lib

npm install @noble/post-quantum

npm install @pdf-lib/fontkit
```
# connect frontend vs backend
```bash
cd backend
npm install cors
```
---

# Chạy backend

```bash
cd backend
npm install
npm start
```

Mở:

```text
http://localhost:3000
```

## Tài khoản demo

Backend tự seed tài khoản mặc định nếu `backend/src/data/users.json` chưa tồn tại.

```text
Officer:
email: officer@test.com
password: officer123

Admin:
email: admin@test.com
password: admin123
```

Công dân có thể đăng ký trực tiếp tại `/register.html`.

---
# Test FALCON + HASH
```bash
node tests/manual-hash-test.js

node tests/manual-falcon-test.js
```
---

## API chính

### Auth

| Method | Path | Mô tả |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Đăng ký công dân |
| `POST` | `/api/auth/login` | Đăng nhập, nhận JWT |
| `GET` | `/api/auth/me` | Lấy thông tin người dùng hiện tại |

### Application Zone

Các endpoint nghiệp vụ cần `Authorization: Bearer <token>`.

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/app/documents/` | citizen/officer/admin | Citizen chỉ thấy hồ sơ của mình; officer/admin thấy toàn bộ |
| `POST` | `/api/app/documents/preview` | citizen/officer/admin | Tạo preview PDF CT01 |
| `POST` | `/api/app/documents/submit` | citizen/officer/admin | Nộp hồ sơ, trạng thái `submitted` |
| `GET` | `/api/app/documents/:documentId` | chủ hồ sơ/officer/admin | Xem chi tiết hồ sơ |
| `GET` | `/api/app/documents/:documentId/download` | chủ hồ sơ/officer/admin | Tải PDF hồ sơ |
| `GET` | `/api/app/documents/previews/:previewId/file` | chủ preview/officer/admin | Xem file preview PDF |
| `GET` | `/api/app/documents/pending` | officer/admin | Danh sách hồ sơ chờ ký |
| `GET` | `/api/app/documents/issued` | officer/admin | Danh sách hồ sơ đã ký |
| `POST` | `/api/app/documents/:documentId/sign` | officer/admin | Ký số và phát hành hồ sơ |
| `GET` | `/api/app/documents/:documentId/signed-pdf` | chủ hồ sơ/officer/admin hoặc token | Tải PDF đã ký |

### Public Zone

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/public/network-model` | Mô hình phân vùng mạng |
| `GET` | `/api/public/documents/verify/:documentId?token=...` | Xác minh theo QR/token |
| `POST` | `/api/public/documents/verify/:documentId` | Xác minh bằng upload PDF + token |

### Crypto Zone

Các endpoint nội bộ cần header `x-internal-crypto-secret`.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/internal/crypto/public-key` | Lấy public key Falcon active |
| `POST` | `/api/internal/crypto/sign` | Ký payload |
| `POST` | `/api/internal/crypto/verify` | Xác minh chữ ký |

## Biến môi trường

File `backend/.env` dùng cho demo local:

```env
PORT=3000
JWT_SECRET=mysecretkey
JWT_EXPIRES_IN=24h
INTERNAL_CRYPTO_SECRET=change-me-in-production
KEY_STORAGE_TYPE=file
PUBLIC_VERIFY_URL=http://localhost:3000/api/public/documents/verify
NODE_ENV=development
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=document_verification
DB_PORT=3306 
DB_STORAGE_TYPE=mysql
```

Không dùng secret mặc định cho môi trường thật.

## Kiểm thử

```powershell
cd backend
npm.cmd test -- --run
```

Test hiện có kiểm tra:

- Falcon-512 ký đúng và xác minh đúng.
- Payload bị sửa sẽ xác minh thất bại.
- Helper lọc hồ sơ theo chủ sở hữu.
- Officer/admin listing vẫn có thể lấy toàn bộ hồ sơ.

## Ghi chú bảo mật cho đồ án

- Demo đã có JWT auth và RBAC cơ bản.
- Citizen không được xem danh sách/chi tiết hồ sơ của người khác.
- Private key không expose qua API; chỉ public key được trả ra.
- Crypto Zone có secret riêng qua header nội bộ.
- JSON store phù hợp demo/môn học; nếu triển khai thật nên thay bằng DB có transaction, audit log bền vững, rate limit và HTTPS.
