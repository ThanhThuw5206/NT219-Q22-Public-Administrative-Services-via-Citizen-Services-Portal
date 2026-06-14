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
- Khóa riêng Falcon mới được mã hóa bằng AES-256-GCM + scrypt; AES-256-CBC chỉ còn là đường đọc legacy cho keystore cũ.
- Production không lưu khóa cá nhân cán bộ trên server. Cán bộ ký challenge bằng thiết bị/token/HSM riêng, backend chỉ lưu public key để xác minh.

## Flow chính

```text
Công dân đăng ký / đăng nhập
    -> điền form CT01
    -> xem preview PDF
    -> nộp hồ sơ từ preview đã xác nhận, trạng thái submitted
    -> cán bộ đăng nhập
    -> xem danh sách hồ sơ chờ duyệt
    -> tạo signing challenge cho PDF gốc
    -> thiết bị cá nhân cán bộ ký challenge bằng Falcon-512
    -> backend verify chữ ký cá nhân của cán bộ bằng public key đã đăng ký
    -> backend nhúng QR, hash signed PDF, ký payload phát hành bằng khóa tổ chức
    -> trạng thái issued
    -> công dân tải PDF đã ký hoặc xác minh bằng token/QR
```

Payload được ký có dạng canonical JSON:

```json
{
  "document_id": "HS-2026-XXXXXXXX",
  "action": "sign_document",
  "algorithm": "FALCON-512",
  "document_type": "CT01",
  "file_hash": "sha256_hex_of_signed_pdf",
  "hash_algorithm": "SHA-256",
  "issued_at": "2026-05-24T00:00:00.000Z",
  "key_id": "falcon-development-key-xxxxxxxx",
  "organization": {
    "organization_id": "PUBLIC-AUTHORITY-DEMO",
    "name": "Demo Public Administrative Authority"
  },
  "purpose": "Issue public administrative document",
  "signer": {
    "user_id": "officer-id",
    "full_name": "Authorized Officer",
    "role": "officer"
  },
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
# Sửa 1 vài vấn đề bảo mật
- Sửa lại DB
- thêm DB_PORT=3306 // có thể sửa nếu port đã có app khác dùng
- đồng bộ BE vs DB
- Kết nối FE vs BE
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
| `POST` | `/api/app/documents/:documentId/sign-challenge` | officer/admin | Tạo payload challenge để thiết bị cá nhân cán bộ ký |
| `POST` | `/api/app/documents/:documentId/sign` | officer/admin | Verify proof của cán bộ, đóng dấu tổ chức và phát hành hồ sơ |
| `GET` | `/api/app/documents/:documentId/signed-pdf` | chủ hồ sơ/officer/admin hoặc token | Tải PDF đã ký |

### Public Zone

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/public/network-model` | Mô hình phân vùng mạng |
| `GET` | `/api/public/keys/:keyId` | Lấy public key cụ thể để đối chiếu chữ ký đã biết key id |
| `GET` | `/api/public/documents/verify/:documentId?token=...` | Xác minh theo QR/token |
| `POST` | `/api/public/documents/verify/:documentId` | Xác minh bằng upload PDF + token |

### Crypto Zone

Các endpoint nội bộ cần header `x-internal-crypto-secret`.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/internal/crypto/public-key` | Lấy public key Falcon active |
| `POST` | `/api/internal/crypto/keys/external-public` | Đăng ký public key của thiết bị cán bộ/HSM/KMS |
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
ALLOW_SERVER_SIDE_PERSONAL_KEYS=true
REQUIRE_OFFICER_DEVICE_SIGNATURE=false
ALLOW_FILE_ORGANIZATION_SEAL_IN_PRODUCTION=false
PUBLIC_VERIFY_URL=http://localhost:3000/api/public/documents/verify
NODE_ENV=development
```

Không dùng secret mặc định cho môi trường thật.

Gợi ý production:

- `ALLOW_SERVER_SIDE_PERSONAL_KEYS=false`: khóa cá nhân của cán bộ nằm trên thiết bị cá nhân, smartcard, PKCS#11, HSM hoặc KMS. Nếu cần bản sao lưu thì lưu ở vault/secret manager có mã hóa, phân quyền, audit và quy trình khôi phục riêng; không lưu private key thô trong DB hay repo.
- `REQUIRE_OFFICER_DEVICE_SIGNATURE=true`: bắt buộc gửi `officer_signature_proof` khi phát hành hồ sơ.
- Khóa đóng dấu tổ chức nên đi qua HSM/KMS. Nếu vẫn dùng file provider trong production thì phải bật chủ động `ALLOW_FILE_ORGANIZATION_SEAL_IN_PRODUCTION=true`, chỉ dùng cho môi trường kiểm soát.
- QR chỉ là kênh hỗ trợ tra cứu/xác thực hồ sơ. Chữ ký số chuẩn nằm trong payload Falcon, bản ghi `document_signatures`, file `signature-evidence.json`, hash PDF gốc và hash PDF đã phát hành.

## Kiểm thử

```powershell
cd backend
npm.cmd test -- --run
```

Test hiện có kiểm tra:

- Falcon-512 ký đúng và xác minh đúng.
- Payload bị sửa sẽ xác minh thất bại.
- Payload chữ ký có signer/organization/action để xác định ai ký, ký với tư cách nào và ký cho mục đích gì.
- Public route không cho liệt kê toàn bộ signing key, chỉ cho lấy key cụ thể theo `key_id`.
- Helper lọc hồ sơ theo chủ sở hữu.
- Officer/admin listing vẫn có thể lấy toàn bộ hồ sơ.

## Ghi chú bảo mật cho đồ án

- Demo đã có JWT auth và RBAC cơ bản.
- Citizen không được xem danh sách/chi tiết hồ sơ của người khác.
- Private key không expose qua API; chỉ public key được trả ra.
- Crypto Zone có secret riêng qua header nội bộ.
- JSON store phù hợp demo/môn học; nếu triển khai thật nên thay bằng DB có transaction, audit log bền vững, rate limit và HTTPS.
