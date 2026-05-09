# Mo Hinh Mang Cho He Thong Ky So Falcon

Tai lieu nay mo ta cach tach he thong thanh cac vung mang theo brief: Public Zone, Application Zone, Crypto Zone va Data Zone.

## 1. So do tong the

```text
[Citizen / Officer Browser]
        |
        | HTTPS
        v
[Public Zone]
  - /api/public/network-model
  - /api/public/documents/verify/:documentId
        |
        | Authenticated API call
        v
[Application Zone]
  - /api/app/documents/upload
  - /api/app/documents/:documentId
  - /api/app/documents/verify/:documentId
        |
        | Internal service call only
        v
[Crypto Zone]
  - backend/src/crypto/signature.service.js
  - Falcon private key / Key Vault / HSM
  - /api/internal/crypto/public-key
        |
        | Restricted storage access
        v
[Data Zone]
  - documents metadata
  - file hash
  - signature
  - token_hash
  - audit log
  - PDF storage
```

## 2. Vai tro tung vung

| Zone | Vai tro | Nguyen tac |
| --- | --- | --- |
| Public Zone | Diem vao cho nguoi dung va QR verify | Chi expose API can thiet, bat buoc HTTPS khi deploy |
| Application Zone | Xu ly nghiep vu ho so, upload, verify, access control | Khong luu private key, khong truy cap truc tiep tu internet trong production |
| Crypto Zone | Ky va xac minh chu ky Falcon | Private key chi nam trong Key Vault/HSM, route noi bo can secret |
| Data Zone | Luu metadata, file PDF, hash, signature, token hash, audit log | Khong expose thanh public route |

## 3. Mapping trong backend hien tai

| Mo hinh | Route / module |
| --- | --- |
| Public Zone | `/api/public/*` |
| Application Zone | `/api/app/documents/*` va legacy `/api/documents/*` |
| Crypto Zone | `backend/src/crypto/*`, `/api/internal/crypto/*` |
| Data Zone | `document.repository.js`, `backend/src/data`, `backend/src/uploads` |

## 4. Quy tac truy cap

1. Public Zone chi cho phep xac minh qua QR/token hoac xem mo hinh mang.
2. Upload va phat hanh PDF di qua Application Zone.
3. Application Zone goi Crypto Zone qua service noi bo de ky payload.
4. Crypto Zone khong tra private key. Endpoint noi bo yeu cau header `x-internal-crypto-secret`.
5. Data Zone khong duoc truy cap truc tiep qua URL. Moi thao tac doc/ghi di qua repository/service.

## 5. Cau hinh can co khi deploy that

```env
PUBLIC_VERIFY_URL=https://domain.gov.vn/api/public/documents/verify
INTERNAL_CRYPTO_SECRET=replace-with-long-random-secret
```

Trong production, `INTERNAL_CRYPTO_SECRET` nen duoc quan ly bang secret manager. Private key Falcon phai nam trong HSM/Key Vault, khong nam trong repo, file cau hinh, hay database.
