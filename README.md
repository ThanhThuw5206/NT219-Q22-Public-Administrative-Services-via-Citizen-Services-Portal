# NT219-Q22 Public Administrative Services Portal

## Luồng xử lý mong muốn

```text
Citizen nhập form
    ↓
Frontend validate
    ↓
POST /preview
    ↓
Backend:
    - map dữ liệu vào PDF template CT01
    - render PDF preview
    - lưu preview tạm
    - trả preview_url + preview_id
    ↓
Citizen xem preview
    ↓
Citizen bấm xác nhận
    ↓
POST /issue
    ↓
Backend:
    - lấy preview data
    - generate document_id
    - generate token chống giả mạo
    - generate QR chứa verify URL
    - embed QR vào PDF
    - SHA256 PDF
    - Falcon sign hash
    - embed signature metadata
    - lưu DB
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

npm install pdf-lib

npm install @noble/post-quantum

npm install @pdf-lib/fontkit
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
{ "owner_id": 1, "office_name": "Công an phường Linh Trung", "full_name": "Nguyễn Văn A", "birth_day": "01", "birth_month": "01", "birth_year": "2000", "gender": "Nam", "citizen_id": "079203123456", "phone": "0909999999", "email": "nguyenvana@gmail.com", "householder_name": "Nguyễn Văn B", "householder_id": "079203654321", "householder_phone": "0911111111", "householder_address": "Linh Trung", "relationship": "người thuê", "request_content": "Đăng ký tạm trú phục vụ học tập tại UIT" }
```

### Response

```json
{
    "message": "Preview generated",
    "data": {
        "preview_id": "7e75199a-4bd3-4b3f-94e9-fc47a4df5a84",
        "document_id": "HS-2026-E406855E",
        "preview_url": "/storage/documents/HS-2026-E406855E/preview.pdf",
        "file_path": "C:\\Users\\hphun\\NT219\\DoAn\\Public-Administrative-Services-via-Citizen-Services-Portal\\backend\\storage\\documents\\HS-2026-E406855E\\preview.pdf",
        "form_data": {
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
            "householder_phone": "0911111111",
            "householder_address": "Linh Trung",
            "relationship": "người thuê",
            "request_content": "Đăng ký tạm trú phục vụ học tập tại UIT"
        }
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
  "preview_id": "3a1f2a45-b095-4a88-b512-3ce7e1750f94",
  "owner_id": 1
}
```

### Response

```json
{
    "message": "Document issued successfully",
    "documentInfo": {
        "document_id": "HS-2026-DF25B570",
        "file_hash": "a8cf0930c38647efb4cced489c8537c6fa0bd59e5e69116dbbacc420255ae943",
        "hash": "a8cf0930c38647efb4cced489c8537c6fa0bd59e5e69116dbbacc420255ae943",
        "signature": "OZRc8pVrgEdpjlO9xGMmvtnxc74EeNE7EXitZjkC1GO7u9SoO1T2rtRWaOGeiUo41NWXdAmKT3YIymKVlWw/gx8U6tBmWs58NN958kVvgaDlRpSIi2SLYFvRHBGUSpKRcrVyCSxCHc+evTeUodePRReIPZMPULGajIxHFVtlZNyfb1FGkKt/v3qJ2GwY1+IvcuRlexNjQPHxP47DGqbCdlTSkPc6jLsjGY66HdSCAU5o6b42AZhrCBuExDabT0qKrmi5pobgQ6tRFlvXIJsrkOTSt+KSMxhv3wbHJYlp00gs13c8Thl7R3nbRwpI4MFUfiVfNu/foKRctPFl1a0hNJXkmMYL8k5bfNiSbNtc+2g1Vbr/alsJmmGes3cXc/Gsn4NTl2CJH8qEwIaX3+Za2x6iq2ejYOiEM+Xr9bRxtDJ/j08l0Pl5RCyPsQhBlw9+qaLBTAqc1U59M+rVKq6jU2J0fDMEmNeUXW4Iz4mNr2zFGWxnRk59+KJpgqyim/7F406QOtQ89l8MfrI8zZJzGYai8b+7xSIzCJ0dXIpM0HolwvbFFltamIdROW8e6RnQL20RyNwrLxopHsy4Wr+qJ86CNAMy7cffepUlpZ8wjmpWRzXacX9Z3ykRd2fUFana98jZovfIL/6/6rLHIQ+YNdYJ/roTkWF4ano/E2RWNmTR83vvd5k0nvSbgieNmdeei1rF2O44LI9Htp2zS4uv98LeK1UPAp2DZL1bD95wt2YRTLmeO/Hh33XxTDpUjCxkjXQeTEwU8EzjTECk4n2UJEtobzUePM+W1VBSXEsFRGjRiUtBW5Ck0oxG68xqbwlDzIEs/+u2U9OuxYTkk8RYacHhfJssb9f7Oqi1EUlz6w==",
        "algorithm": "FALCON-512",
        "signature_provider": "crypto-zone",
        "public_key_id": "falcon-development-key-02597ccf",
        "verify_url": "http://localhost:3000/api/public/documents/verify/HS-2026-DF25B570?token=KfqH5dg1RzCK5QHEDQXipES7FEROOSZ5hRCzhwHo07k",
        "qr_payload": {
            "document_id": "HS-2026-DF25B570",
            "verify_url": "http://localhost:3000/api/public/documents/verify/HS-2026-DF25B570?token=KfqH5dg1RzCK5QHEDQXipES7FEROOSZ5hRCzhwHo07k",
            "token": "KfqH5dg1RzCK5QHEDQXipES7FEROOSZ5hRCzhwHo07k"
        },
        "file_path": "C:\\Users\\hphun\\NT219\\DoAn\\Public-Administrative-Services-via-Citizen-Services-Portal\\backend\\storage\\documents\\HS-2026-DF25B570\\signed.pdf",
        "signed_file": "C:\\Users\\hphun\\NT219\\DoAn\\Public-Administrative-Services-via-Citizen-Services-Portal\\backend\\storage\\documents\\HS-2026-DF25B570\\signed.pdf",
        "original_file_hash": "c55fa7bec43921665992042db04fd183771823551e615ba6fe6e0224b41f4119",
        "signed_pdf_url": "/api/app/documents/HS-2026-DF25B570/signed-pdf",
        "status": "issued",
        "signed_at": "2026-05-23T16:21:18.157Z"
    }
}
```

---

# Storage lưu theo mã hồ sơ

```text
backend
└──storage/
    └── documents/
        └── HS-2026-XXXXX/
            ├── preview.pdf
            ├── signed.pdf
            ├── qr.png
            └── metadata.json
```

---
# Sửa 1 vài vấn đề bảo mật
- xóa trường token trong mã qr, url
- xóa app.use("/api/documents", ...)
- thêm metadata cho sign.pdf
- tạo preview file
- thay vì cho client hiện rõ filepath thì chỉ cho hiện preview_id, server phải tự tìm path thật
- thêm DB: path của 2 file pdf, preview_id trong document; thêm bảng preview table
# Thêm file
- src/repositories/preview.repository.js
- src/templates/CT01.pdf
- src/validators/ct01.validator.js

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

└──src/
│    │
│    ├── controllers/
│    │   └── document.controller.js
│    │
│    ├── routes/
│    │   └── document.route.js
│    │
│    ├── services/
│    │   ├── document.service1.js
│    │   │      ← orchestrator chính được tạo mới
│    │   │         thay vì sửa file cũ
│    │   │
│    │   ├── qr.service.js
│    │   ├── pdf.service.js
│    │   ├── signed-pdf.service.js
│    │   ├── audit.service.js
│    │   ├── preview.service.js
│    │   └── document.repository.js
│    │
│    ├── crypto/
│    │   ├── hash.service.js
│    │   ├── hash.service.js
│    │   ├── signature.service.js
│    │   └── falcon.service.js
│    │
│    ├── utils/
│    │   └── storage.util.js
│    │
│    └──uploads/
│
│
└──storage/
    └── documents/
        └── HS-2026-XXXXX/
            ├── preview.pdf
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


