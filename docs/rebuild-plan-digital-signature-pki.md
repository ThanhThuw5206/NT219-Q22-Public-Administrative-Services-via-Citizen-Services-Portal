# Plan lam lai do an: Digital Signature for Public Administrative Services

Ngay recheck: 2026-06-06

## 1. Ket luan recheck nhanh

Repo hien tai dang di lech huong so voi file de bai. He thong hien co tap trung vao cong nop ho so CT01, can bo ky PDF bang Falcon-512, gan QR/token va verify hash. Huong nay co gia tri demo mat ma, nhung khong dap ung trong tam cua de tai NT219: chu ky so trong dich vu cong theo mo hinh PKI/TSP, gom X.509, CA/RA, OCSP/CRL, TSA timestamp RFC 3161, PAdES/CAdES, SoftHSM/PKCS#11, remote signing, client-side signing va LTV.

Vi vay khong nen tiep tuc va tung bug tren Falcon/QR flow. Can giu lai phan portal/RBAC/PDF form neu huu ich, nhung thay tron crypto core va kien truc nghiep vu chu ky.

## 2. Hien trang repo

### Dang co the tan dung

- Frontend tinh cho citizen/officer dashboard.
- Auth co JWT, role citizen/officer/admin, middleware RBAC.
- Luong nghiep vu nop ho so, preview PDF, submit, officer review.
- PDF generation/embedding co the giu lam nen cho PAdES demo, nhung khong duoc coi QR/hash la chu ky so hop le.
- Audit log co the mo rong thanh signing audit trail.
- MySQL schema nen dung lam nen, nhung can thiet ke lai cho PKI/LTV.

### Dang sai huong

- `backend/src/crypto/*` dang dung Falcon-512 file keystore. De bai yeu cau PKI/X.509 va HSM/SoftHSM/PKCS#11; Falcon khong phai flow chinh.
- Signature payload hien tai chi la canonical JSON cua hash PDF, khong phai CAdES/PAdES/CMS/PKCS#7.
- Verify hien tai dua vao token QR + hash + public key luu trong DB, chua co certificate chain, revocation, OCSP/CRL, TSA, LTV.
- Chua co CA/RA lifecycle: cap cert, thu hoi cert, mapping danh tinh cong dan voi certificate.
- Chua co TSA timestamp RFC 3161, OCSP responder, archive OCSP/CRL.
- Chua co remote signing service dung HSM/SoftHSM va audit tung lenh ky theo TSP.
- Chua co client-side signing bang PKCS#11/OpenSC/native agent.
- Chua co attack simulation dung yeu cau: replay remote signing, revoked cert, TSA outage, client malware/UI deception.

### Loi nen can xu ly ngay

- Nhieu file con conflict marker: `README.md`, `backend/package.json`, `backend/package-lock.json`, `backend/src/controllers/document.controller.js`, `backend/src/routes/document.routes.js`.
- `backend/node_modules` dang bi git track/thay doi rat nhieu. Can dua `node_modules` ra khoi repo va chuan hoa `.gitignore`.
- Tai lieu hien tai van dat ten theo Falcon, lam sai narrative bao cao.
- File de bai doc qua terminal dang bi loi encoding, can luu lai ban UTF-8 chuan trong `docs/project-brief.md` neu muon trich dan.

## 3. Huong kien truc moi

### Muc tieu PoC moi

Lam mot he sinh thai chu ky so lab co the demo end-to-end:

1. Cong dan dang nhap vao portal.
2. Cong dan tao/nop ho so hanh chinh dang PDF.
3. He thong ho tro hai cach ky:
   - Client-side signing: citizen/officer ky digest bang certificate ca nhan tu file/token demo.
   - Remote signing: portal gui yeu cau ky sang TSP service, TSP dung SoftHSM/PKCS#11 de ky.
4. Chu ky duoc dong goi theo huong PAdES/CAdES hoac toi thieu CMS/PKCS#7 detached signature kem PDF.
5. TSA cap timestamp RFC 3161 cho chu ky.
6. OCSP/CRL duoc dung de kiem tra trang thai certificate.
7. Verifier kiem tra chain X.509, signature, timestamp, revocation va LTV artifact da archive.
8. Chay duoc cac kich ban tan cong/thuc nghiem theo de bai.

### Module moi nen co

```text
project-root/
  ca-infrastructure/
    openssl/
    softhsm/
    ocsp/
    tsa/
    scripts/
  portal/
    frontend/
    backend/
  tsp/
    signing-service/
    pkcs11-provider/
    audit/
  verifier/
    api/
    ltv-archive/
  client-agents/
    native-agent-demo/
    pkcs11-demo/
  attacks/
    replay-remote-signing/
    revoked-cert/
    tampered-document/
    tsa-outage/
  docs/
    report/
    compliance-checklist.md
    ra-playbook.md
```

Co the giu thu muc `backend` va `frontend` hien tai, nhung nen doi narrative thanh `portal/backend` va `portal/frontend` trong tai lieu. Neu khong muon move file som, dung module boundary bang route/service truoc.

## 4. Backlog lam lai theo phase

### Phase 0 - Dong bang va don nen

- Resolve het conflict marker trong code va package files.
- Xoa `node_modules` khoi git tracking, giu lai `package-lock.json` hop le.
- Tao README moi noi ro project la PKI/TSP/LTV PoC, khong phai Falcon QR demo.
- Chay lai `npm install` va test smoke.
- Luu ban de bai UTF-8 vao `docs/project-brief.md`.

Tieu chi xong: repo install duoc, start duoc, khong con `<<<<<<<`, docs noi dung khong lech de.

### Phase 1 - Chot scope demo kha thi

- Chon stack:
  - Backend portal: Node.js/Express hien tai.
  - PKI lab: OpenSSL scripts.
  - HSM lab: SoftHSM2.
  - Signing format: uu tien CMS/PKCS#7 detached + PDF artifact; neu kip thi PAdES visible/invisible.
  - Timestamp: OpenSSL `ts` hoac TSA service don gian.
  - Revocation: OpenSSL OCSP responder + CRL file.
- Viet architecture diagram va sequence diagram cho 2 flow: client-side signing va remote signing.
- Mapping yeu cau phap ly: Luat giao dich dien tu/chu ky so Viet Nam o muc conceptual, eIDAS/QES dung de so sanh.

Tieu chi xong: co tai lieu kien truc, tool list, scope demo khong qua suc.

### Phase 2 - CA/RA/PKI lab

- Tao Root CA va Issuing CA bang OpenSSL.
- Tao certificate profiles:
  - citizen signing cert
  - officer signing cert
  - TSP signing cert
  - TSA cert
  - OCSP responder cert
- Viet RA workflow lab:
  - dang ky dinh danh synthetic
  - cap cert
  - revoke cert
  - audit identity proofing
- Tao scripts lap lai duoc:
  - `init-root-ca`
  - `issue-user-cert`
  - `revoke-cert`
  - `generate-crl`
  - `start-ocsp`

Tieu chi xong: co cert chain, verify chain duoc, revoke cert va OCSP tra revoked duoc.

### Phase 3 - TSP remote signing voi SoftHSM

- Cai SoftHSM token lab va import/generate private key trong token.
- Xay `tsp/signing-service`:
  - API tao signing request
  - nonce/challenge chong replay
  - strong auth mock: password + OTP/TOTP demo hoac WebAuthn mock neu kip
  - ky digest bang key trong SoftHSM/PKCS#11
  - audit log bat buoc: actor, doc hash, cert id, nonce, time, result
- Portal goi remote signing service thay vi ky Falcon local.

Tieu chi xong: remote signing tao signature bang key nam trong SoftHSM, khong co private key trong repo/DB.

### Phase 4 - Client-side signing demo

- Tao client signing demo toi thieu:
  - browser lay digest tai lieu tu portal
  - native agent hoac script CLI ky digest bang cert/key cua citizen
  - upload signature + cert chain ve portal
- Neu khong kip OpenSC/token that, dung PKCS#12 lab de minh hoa va ghi ro limitation.
- UI phai hien thi canonical data/digest truoc khi ky de lien ket voi experiment UI deception.

Tieu chi xong: cung mot ho so co the ky theo client-side flow, verifier phan biet duoc signature source.

### Phase 5 - Signature packaging va LTV

- Dong goi signature theo muc kha thi:
  - Toi thieu: PDF + `.p7s` CMS detached signature + manifest JSON.
  - Tot hon: PAdES embedded signature bang thu vien phu hop.
- Lay TSA timestamp cho signature/document hash.
- Lay OCSP response tai thoi diem ky va archive cung artifact.
- Luu LTV bundle:
  - signed document
  - signer certificate chain
  - signature/CMS
  - timestamp token
  - OCSP response/CRL snapshot
  - audit trail reference

Tieu chi xong: offline verifier co the verify bang archived artifacts, khong phu thuoc live OCSP.

### Phase 6 - Verification service

- Xay verifier API:
  - verify document integrity
  - verify CMS/PAdES signature
  - verify X.509 chain
  - verify OCSP/CRL status tai thoi diem ky
  - verify TSA timestamp
  - tra ket qua co ly do ro rang
- Public verify page upload PDF/signature bundle.
- Khong dung QR token lam bang chung chinh. QR chi nen dan den public verifier va document id.

Tieu chi xong: verifier phat hien duoc tampered PDF, revoked cert, invalid timestamp, wrong chain.

### Phase 7 - Attack simulations va metrics

- Replay remote signing:
  - gui lai request cu
  - ky vong bi chan boi nonce/idempotency/audit
- Revoked certificate:
  - ky truoc va sau khi revoke
  - so sanh archived OCSP voi live OCSP
- Tampered document:
  - sua PDF sau khi ky
  - verifier bao invalid digest/signature
- TSA outage:
  - tat TSA sau khi da archive timestamp
  - LTV verifier van verify duoc artifact cu
- Client UI deception:
  - tao script thay noi dung truoc khi ky
  - de xuat secure preview/digest confirmation

Tieu chi xong: co script, log, screenshot/result table cho bao cao.

### Phase 8 - Bao cao, checklist, demo

- Bao cao gom:
  - requirement/legal mapping
  - architecture
  - implementation
  - security analysis
  - experiments
  - limitations
- RA playbook:
  - identity proofing
  - certificate issuance/revocation
  - audit/retention
  - privacy minimization
- Compliance checklist.
- Demo video:
  - remote signing end-to-end
  - client-side signing end-to-end
  - verification/LTV
  - mot attack simulation

Tieu chi xong: deliverables bam dung rubric: analysis 20%, PoC 30%, security 25%, docs/compliance 25%.

## 5. Quyet dinh thay the Falcon flow

Khong nen xoa ngay toan bo Falcon code neu chua co flow moi. Nen lam theo cach:

1. Ghi ro Falcon flow la legacy/deprecated, khong dung lam ket qua chinh.
2. Tao service interface moi `signature-provider`:
   - `remote-tsp-provider`
   - `client-side-provider`
   - `legacy-falcon-provider` chi de so sanh/backup tam thoi.
3. Khi remote/client PKI flow chay duoc, xoa Falcon khoi README va UI.

## 6. Schema du lieu can thiet ke lai

Bang nen co:

- `citizens`, `officers`, `roles`, `sessions`
- `ra_requests`: yeu cau cap/chinh sua/thu hoi certificate
- `certificates`: serial, subject, issuer, pem, status, valid_from, valid_to, revoked_at
- `documents`: metadata ho so, owner, status, original_hash
- `signing_requests`: nonce, requester, document_hash, method, status, expires_at
- `signatures`: document_id, signer_cert_serial, format, signature_path/blob, signed_at, provider
- `timestamps`: signature_id, tsa_cert_serial, tst_path/blob, gen_time
- `revocation_evidence`: signature_id, ocsp_response_path/blob, crl_path/blob, captured_at
- `ltv_archives`: document_id/signature_id, bundle_path, created_at
- `audit_logs`: actor, action, resource, result, ip, user_agent, created_at

## 7. Viec nen lam ngay tiep theo

1. Resolve conflict marker va package files de repo chay lai.
2. Tao nhanh `ca-infrastructure/openssl` voi scripts sinh Root CA, Issuing CA, user cert.
3. Tao verifier CLI nho verify chain + signature truoc khi tich hop portal.
4. Sau khi PKI core chay, moi noi vao UI/portal.

## 8. Definition of Done cho do an moi

Do an chi duoc coi dung huong khi demo duoc:

- Mot certificate chain X.509 hop le tu test CA.
- Mot remote signing operation dung SoftHSM/PKCS#11 hoac mo phong HSM co boundary ro.
- Mot client-side signing demo.
- Mot signed document artifact theo CMS/PAdES/CAdES/XAdES direction, khong chi la hash + QR.
- Mot timestamp token va revocation evidence duoc archive.
- Mot verifier tra ket qua co chain/signature/timestamp/revocation.
- It nhat 3 attack experiments co ket qua.
- Tai lieu RA/compliance/operational checklist.
