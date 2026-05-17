# NT219-Q22 Public Administrative Services Portal
## luồng xử lý mong muốn
Người dân nhập form
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
## Cài package
```bash
npm install qrcode fs-extra
```

## Chay backend

```bash
cd backend
npm install
npm run dev
```

Server mac dinh: `http://localhost:3000`
## Thêm api preview và issue
Post

http://localhost:3000/api/documents/preview
↓
Nhập vd (do chưa tạo frontend gửi thông tin nên tạm dùng vd như v)
{
  "full_name": "Nguyen Van A",
  "citizen_id": "0123456789",
  "temporary_address": "HCM City"
}
↓
Trả:
{
    "message": "Preview generated",
    "data": {
        "preview_id": "ba88f40e-d9d9-4e5d-a7ca-2803c0a988c5",
        "preview_url": "/storage/preview/ba88f40e-d9d9-4e5d-a7ca-2803c0a988c5.pdf"
    }
}
Post 
http://localhost:3000/api/documents/issue
↓
Nhập vd
{
  "filePath": "C:/Users/hphun/NT219/DoAn/Public-Administrative-Services-via-Citizen-Services-Portal/backend/src/uploads/1778621489474-NT106-24521418-24521260-BT8.pdf",
  "originalName": "tamtru.pdf",
  "owner_id": "citizen-001"
}
↓
Ket qua tra ve:

- `document_id`
- `file_hash`
- `signature`
- `algorithm`
- `signature_provider`
- `public_key_id`
- `verify_url`
- `signed_pdf_url`
- `qr_payload` gom `document_id`, `verify_url`, `token`

## Thêm storage lưu theo mã hồ sơ
└── storage/
    └── documents/
        └── HS-2026-XXXXX/
            ├── original.pdf
            ├── signed.pdf
            ├── qr.png
            └── metadata.json


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
- `original_file_hash`
- `signed_pdf_url`
- `qr_payload` gom `document_id`, `verify_url`, `token`

### Tai PDF da ky

`GET /api/app/documents/:documentId/signed-pdf`

Endpoint nay tra ve ban PDF da duoc dong khung thong tin ky so va QR xac minh. QR chua payload gom `document_id`, `verify_url` va token. Cach lam nay duoc tham khao tu source WinForms Falcon: sau khi ky payload, he thong gan chu ky/QR vao PDF de nguoi dung co the luu va chia se file da ky.

### Xac minh bang QR/token

`GET /api/public/documents/verify/:documentId?token=...`

Endpoint nay kiem tra token va chu ky tren ban ghi da phat hanh.

### Xac minh bang upload PDF

`POST /api/public/documents/verify/:documentId`

Body `form-data`:

- `file`: PDF can kiem tra
- `token`: token trong QR payload

## CẤU TRÚC PROJECT HIỆN TẠI
src/
│
├── controllers/
│   └── document.controller.js
│
├── routes/
│   └── document.route.js
│
├── services/
│   ├── document.service1.js      ← orchestrator chính đc tạo mới thay vì sửa    |   |                                file cũ
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
