# NT219-Q22 Public Administrative Services Portal

## Luồng xử lý mong muốn

```text
Người dân nhập form
        ↓
POST /preview
        ↓
Server render PDF demo
        ↓
Người dân xem trước
        ↓
Người dân bấm xác nhận
        ↓
POST /issue
        ↓
Server:
generate token
→ generate QR
→ embed QR
→ SHA256
→ Falcon sign
→ save DB
→ return signed PDF
        ↓
Trả:
{
  "signed_pdf_url": "...",
  "verify_url": "...",
  "signature": "..."
}
```

---

# Cài package

```bash
npm install qrcode fs-extra
```

---

# Chạy backend

```bash
cd backend
npm install
npm run dev
```

Server mặc định:

```text
http://localhost:3000
```

---

# Thêm API preview và issue

## 1. Preview PDF

### Endpoint

```http
POST http://localhost:3000/api/documents/preview
```

### Request body

```json
{
  "full_name": "Nguyen Van A",
  "citizen_id": "0123456789",
  "temporary_address": "HCM City"
}
```

### Response

```json
{
  "message": "Preview generated",
  "data": {
    "preview_id": "ba88f40e-d9d9-4e5d-a7ca-2803c0a988c5",
    "preview_url": "/storage/preview/ba88f40e-d9d9-4e5d-a7ca-2803c0a988c5.pdf"
  }
}
```

---

## 2. Issue tài liệu và ký số

### Endpoint

```http
POST http://localhost:3000/api/documents/issue
```

### Request body

```json
{
  "filePath": "C:/Users/hphun/NT219/DoAn/Public-Administrative-Services-via-Citizen-Services-Portal/backend/src/uploads/1778621489474-NT106-24521418-24521260-BT8.pdf",
  "originalName": "tamtru.pdf",
  "owner_id": "citizen-001"
}
```

### Response

```json
{
  "document_id": "HS-2026-00001",
  "file_hash": "SHA256_HASH",
  "signature": "FALCON_SIGNATURE",
  "algorithm": "Falcon-512",
  "signature_provider": "NT219-Q22",
  "public_key_id": "falcon-public-key-01",
  "verify_url": "http://localhost:3000/api/public/documents/verify/HS-2026-00001?token=abcxyz",
  "signed_pdf_url": "/storage/documents/HS-2026-00001/signed.pdf",
  "qr_payload": {
    "document_id": "HS-2026-00001",
    "verify_url": "http://localhost:3000/api/public/documents/verify/HS-2026-00001?token=abcxyz",
    "token": "abcxyz"
  }
}
```

---

# Storage lưu theo mã hồ sơ

```text
storage/
└── documents/
    └── HS-2026-XXXXX/
        ├── original.pdf
        ├── signed.pdf
        ├── qr.png
        └── metadata.json
```

---

# API chính

---

## 1. Upload và ký PDF

### Endpoint

```http
POST /api/app/documents/upload
```

### Body form-data

| Field      | Type | Required | Description |
|------------|------|-----------|-------------|
| file       | PDF  | Yes       | File PDF cần ký |
| owner_id   | Text | No        | ID người sở hữu |

### Response

```json
{
  "document_id": "HS-2026-00001",
  "file_hash": "SHA256_HASH",
  "signature": "FALCON_SIGNATURE",
  "algorithm": "Falcon-512",
  "public_key_id": "falcon-public-key-01",
  "original_file_hash": "ORIGINAL_FILE_HASH",
  "signed_pdf_url": "/storage/documents/HS-2026-00001/signed.pdf",
  "qr_payload": {
    "document_id": "HS-2026-00001",
    "verify_url": "http://localhost:3000/api/public/documents/verify/HS-2026-00001?token=abcxyz",
    "token": "abcxyz"
  }
}
```

---

## 2. Tải PDF đã ký

### Endpoint

```http
GET /api/app/documents/:documentId/signed-pdf
```

### Mô tả

Endpoint này trả về bản PDF đã được:

- Đóng khung thông tin ký số
- Nhúng QR xác minh
- Gắn payload xác thực

QR chứa:

- `document_id`
- `verify_url`
- `token`

Cách làm này được tham khảo từ source WinForms Falcon:

- Sau khi ký payload
- Hệ thống gắn chữ ký và QR vào PDF
- Người dùng có thể tải và chia sẻ file đã ký

---

## 3. Xác minh bằng QR/token

### Endpoint

```http
GET /api/public/documents/verify/:documentId?token=...
```

### Mô tả

Endpoint này:

- Kiểm tra token
- Kiểm tra chữ ký số
- Kiểm tra trạng thái phát hành hồ sơ

---

## 4. Xác minh bằng upload PDF

### Endpoint

```http
POST /api/public/documents/verify/:documentId
```

### Body form-data

| Field | Type | Required | Description |
|-------|------|-----------|-------------|
| file  | PDF  | Yes       | PDF cần xác minh |
| token | Text | Yes       | Token lấy từ QR |

---

# Cấu trúc project hiện tại

```text
src/
│
├── controllers/
│   └── document.controller.js
│
├── routes/
│   └── document.route.js
│
├── services/
│   ├── document.service1.js
│   │      ← orchestrator chính được tạo mới
│   │         thay vì sửa file cũ
│   │
│   ├── qr.service.js
│   ├── pdf.service.js
│   ├── signed-pdf.service.js
│   ├── audit.service.js
│   ├── preview.service.js
│   └── document.repository.js
│
├── crypto/
│   ├── hash.service.js
│   ├── signature.service.js
│   └── falcon.service.js
│
├── utils/
│   └── storage.util.js
│
├── uploads/
│
└── storage/
    └── documents/
        └── HS-2026-XXXXX/
            ├── original.pdf
            ├── signed.pdf
            ├── qr.png
            └── metadata.json
```

---

# Flow xử lý issue document

```text
Upload PDF
    ↓
Tạo document_id
    ↓
Tạo token xác minh
    ↓
Generate QR
    ↓
Hash SHA256 file
    ↓
Falcon Sign hash
    ↓
Embed QR vào PDF
    ↓
Lưu storage
    ↓
Lưu DB
    ↓
Trả signed PDF + verify URL
```

---

# Thành phần bảo mật

| Thành phần | Chức năng |
|------------|------------|
| SHA256 | Tạo hash tài liệu |
| Falcon-512 | Ký số hậu lượng tử |
| QR Verify | Xác minh nhanh |
| Token Verify | Chống giả mạo |
| Signed PDF | PDF có nhúng QR và chữ ký |

---

# Kết quả mong muốn

Hệ thống hỗ trợ:

- Upload PDF
- Preview hồ sơ
- Ký số Falcon
- Nhúng QR verify
- Xác minh tài liệu
- Trả PDF đã ký
- Lưu metadata hồ sơ
- Quản lý storage theo mã hồ sơ
