# NT219-Q22 Digital Signature for Public Administrative Services

PoC do an NT219 ve chu ky so cho cong dich vu cong. Huong lam moi cua project la PKI/TSP/LTV, khong tiep tuc coi Falcon-512 + QR/hash la flow chinh.

## Dinh huong dung

Project can demo cac thanh phan:

- Citizen Portal: nop ho so, xem trang thai, tai va verify tai lieu.
- CA/RA lab: cap va thu hoi certificate X.509 cho citizen/officer/TSP/TSA/OCSP.
- Remote Signing Service: ky thong qua TSP voi HSM/SoftHSM/PKCS#11.
- Client-side Signing Demo: ky bang certificate/key phia client hoac PKCS#11/OpenSC demo.
- TSA/OCSP/CRL: timestamp RFC 3161 va revocation evidence.
- Verification/LTV: verify signature, chain, timestamp, OCSP/CRL va archived evidence.
- Attack simulations: replay remote signing, revoked certificate, tampered document, TSA outage, UI deception.

Ke hoach lam lai chi tiet nam o:

- `docs/rebuild-plan-digital-signature-pki.md`

## Trang thai hien tai

Repo cu da co mot portal Node.js/Express + frontend HTML/CSS/JS tinh. Cac phan co the tan dung:

- Auth/JWT/RBAC co role `citizen`, `officer`, `admin`.
- Flow tao preview/nop ho so PDF.
- Dashboard frontend co san.
- Audit/storage nen duoc refactor lai cho PKI/LTV.

Phan legacy Falcon-512/QR chi duoc giu tam thoi de tham khao trong qua trinh chuyen doi, khong phai deliverable chinh cua de tai.

## Cai dat hien tai

```powershell
cd backend
npm install
npm start
```

Mac dinh backend chay tai:

```text
http://localhost:3000
```

## Viec can lam tiep

1. Don sach repo va bo `node_modules` khoi tracking.
2. Tao `ca-infrastructure/openssl` voi scripts sinh Root CA, Issuing CA, user cert, OCSP va TSA.
3. Tao verifier CLI nho de verify chain/signature truoc khi noi vao portal.
4. Xay remote TSP service dung SoftHSM/PKCS#11.
5. Noi portal vao provider moi va deprecate Falcon flow.
