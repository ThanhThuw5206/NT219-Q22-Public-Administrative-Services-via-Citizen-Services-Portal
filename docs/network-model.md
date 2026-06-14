# Mo Hinh Mang Va Flow Chu Ky So Falcon

Tai lieu nay mo ta cach tach he thong thanh Public Zone, Application Zone, Crypto Zone va Data Zone cho luong dich vu cong co ky so Falcon-512.

## 1. So do tong the

```text
[Citizen / Officer Browser]
        |
        | HTTPS
        v
[Public Zone]
  - GET  /api/public/network-model
  - GET  /api/public/documents/verify/:documentId?token=...
  - POST /api/public/documents/verify/:documentId
  - GET  /api/public/keys/:keyId
        |
        | Authenticated API call
        v
[Application Zone]
  - POST /api/app/documents/preview
  - POST /api/app/documents/submit
  - POST /api/app/documents/:documentId/sign-challenge
  - POST /api/app/documents/:documentId/sign
  - GET  /api/app/documents/:documentId/signed-pdf
        |
        | Internal service call only
        v
[Crypto Zone]
  - backend/src/crypto/signature.service.js
  - backend/src/crypto/key-manager.service.js
  - GET  /api/internal/crypto/public-key
  - POST /api/internal/crypto/keys/external-public
  - POST /api/internal/crypto/sign
  - POST /api/internal/crypto/verify
        |
        | Restricted storage access
        v
[Data Zone]
  - documents metadata
  - original_file_hash / signed_file_hash
  - document_signatures
  - signing_challenges
  - signature-evidence.json
  - token_hash
  - audit log
  - PDF storage
```

## 2. Vai tro tung vung

| Zone | Vai tro | Nguyen tac |
| --- | --- | --- |
| Public Zone | Diem vao cho QR/token verify va lay public key cu the | Chi expose API can thiet, bat buoc HTTPS khi deploy, khong cho list toan bo key |
| Application Zone | Xu ly nghiep vu ho so, submit, challenge, phat hanh, access control | Khong giu private key ca nhan can bo trong production |
| Crypto Zone | Ky/xac minh Falcon, quan ly public key va key metadata | Route noi bo can `x-internal-crypto-secret`; private key to chuc nen nam trong HSM/KMS |
| Data Zone | Luu metadata, PDF, hash, signature, challenge, token hash, audit log | Khong expose thanh public route; production can transaction va backup/audit ben vung |

## 3. Flow ky so chuan

1. Cong dan tao preview va submit ho so. Backend luu PDF goc va `original_file_hash` SHA-256.
2. Can bo goi `POST /api/app/documents/:documentId/sign-challenge`.
3. Backend tao canonical payload `approve_document` gom `document_id`, `file_hash` cua PDF goc, `challenge_id`, `nonce`, `key_id`, signer va organization. Challenge het han sau thoi gian ngan.
4. Thiet bi ca nhan/smartcard/PKCS#11/HSM cua can bo ky payload bang private key Falcon-512. Private key cua can bo khong duoc gui len backend.
5. Can bo goi `POST /api/app/documents/:documentId/sign` kem `officer_signature_proof` gom `challenge_id` va `signature`.
6. Backend lay public key theo `key_id`, verify chu ky ca nhan cua can bo, kiem tra challenge con pending/chua het han/dung document/dung officer, va so sanh hash PDF hien tai voi hash da duoc can bo phe duyet.
7. Backend nhung QR vao PDF, tinh `signed_file_hash` tren file PDF cuoi cung.
8. Backend ky payload `sign_document` bang khoa dong dau to chuc. Production nen dung HSM/KMS; file provider chi danh cho dev hoac moi truong co chap nhan rui ro ro rang.
9. Backend ghi `document_signatures` cho chu ky ca nhan can bo va chu ky to chuc, ghi `signature-evidence.json`, cap nhat document sang `issued`.
10. Ben thu ba verify bang QR/token hoac upload PDF; QR chi ho tro tra cuu ho so, con tinh toan ven va danh tinh nguoi ky duoc xac minh bang hash + Falcon signature evidence.

## 4. Quy tac khoa

- New encrypted local private keys use AES-256-GCM + scrypt.
- AES-256-CBC chi con la compatibility path de doc keystore cu.
- Khoa ca nhan cua ai thi nguoi do giu. Co the luu tren thiet bi ca nhan da ma hoa, smartcard/token, PKCS#11, HSM, KMS hoac vault co audit. Khong luu private key ca nhan dang tho trong database, source code, file cau hinh hay API payload.
- Backend production chi can luu public key cua can bo de verify proof.
- Public Zone chi cho `GET /api/public/keys/:keyId`; khong expose route list toan bo key vi co the lo metadata can bo/to chuc.
- Muon dang ky public key thiet bi thi dung `POST /api/internal/crypto/keys/external-public` tu Crypto Zone noi bo.

## 5. Mapping trong backend hien tai

| Mo hinh | Route / module |
| --- | --- |
| Public Zone | `/api/public/*` |
| Application Zone | `/api/app/documents/*`; legacy `/api/documents/upload` va `/api/documents/:id/issue` chi con cho dev/demo, production tra `410` |
| Crypto Zone | `backend/src/crypto/*`, `/api/internal/crypto/*` |
| Data Zone | `document.repository.js`, `signature.repository.js`, `signing-challenge.repository.js`, `backend/src/data`, `backend/storage/documents` |

## 6. Cau hinh production khuyen nghi

```env
NODE_ENV=production
PUBLIC_VERIFY_URL=https://domain.gov.vn/api/public/documents/verify
INTERNAL_CRYPTO_SECRET=<long-random-secret-from-secret-manager>
ALLOW_SERVER_SIDE_PERSONAL_KEYS=false
REQUIRE_OFFICER_DEVICE_SIGNATURE=true
ALLOW_FILE_ORGANIZATION_SEAL_IN_PRODUCTION=false
KEY_STORAGE_TYPE=hsm
```

Neu chua co HSM/KMS, co the chay dev/demo bang file keystore da ma hoa, nhung khong xem do la co che dat chuan de trien khai dich vu cong that.

## 7. PDF properties va iText7

Backend hien tai nhung QR va metadata vao PDF, dong thoi ghi Falcon evidence rieng de verify. De PDF reader hien thi truong chu ky xac thuc native trong Properties, nen bo sung service PAdES/iText7 o giai doan tiep theo:

- combine/attach evidence vao PDF sau khi ky;
- tao visible signature field neu can;
- dong goi certificate chain/metadata theo chuan PDF signature;
- van giu Falcon evidence lam nguon verify chinh neu thuat toan Falcon chua duoc PDF reader ho tro native.
