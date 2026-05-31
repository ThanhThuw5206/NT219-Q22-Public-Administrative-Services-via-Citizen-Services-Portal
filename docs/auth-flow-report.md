# Report: Flow xác thực của hệ thống

## 1. Tổng quan

Hệ thống là cổng dịch vụ công mô phỏng quy trình công dân nộp hồ sơ, cán bộ xử lý/ký số và bên thứ ba xác minh tài liệu bằng QR/token. Phần xác thực chịu trách nhiệm định danh người dùng, cấp JWT, bảo vệ các API nghiệp vụ và phân quyền theo vai trò.

Các vai trò chính:

| Vai trò | Mục đích |
| --- | --- |
| `citizen` | Công dân đăng ký tài khoản, đăng nhập, tạo preview, nộp hồ sơ, xem/tải hồ sơ của chính mình. |
| `officer` | Cán bộ đăng nhập, xem hồ sơ chờ xử lý, ký/phát hành hồ sơ. |
| `admin` | Quản trị viên có quyền tương tự cán bộ trong các route nghiệp vụ hiện tại. |
| `verifier` | Có trong schema MySQL nhưng chưa được dùng rõ trong flow backend hiện tại. |

Phần xác thực được triển khai ở các file chính:

- Backend route: `backend/src/routes/auth.routes.js`
- Backend controller: `backend/src/controllers/auth.controller.js`
- Backend service: `backend/src/services/auth.service.js`
- Middleware JWT: `backend/src/middlewares/auth.middleware.js`
- Middleware phân quyền: `backend/src/middlewares/role.middleware.js`
- Frontend helper: `frontend/js/api.js`, `frontend/js/auth.js`
- Schema tham khảo: `DB/db.sql`

## 2. Công nghệ sử dụng

| Thành phần | Công nghệ/thư viện | Vai trò |
| --- | --- | --- |
| Backend | Node.js + Express | Xây dựng REST API, route xác thực và route nghiệp vụ. |
| Mật khẩu | `bcryptjs` | Hash mật khẩu bằng bcrypt trước khi lưu. |
| Token | `jsonwebtoken` | Sinh và xác minh JWT. |
| Cookie | `cookie-parser`, `res.cookie` | Lưu JWT trong httpOnly cookie sau khi đăng nhập. |
| Frontend | HTML/CSS/JavaScript tĩnh | Form đăng nhập/đăng ký, điều hướng dashboard theo role. |
| Lưu trữ demo | JSON file | Lưu user khi `DB_STORAGE_TYPE=json`. |
| Lưu trữ mở rộng | MySQL schema | Lưu `users`, `roles`, `user_roles`, audit log và dữ liệu nghiệp vụ khi `DB_STORAGE_TYPE=mysql`. |
| Bảo vệ API | `helmet`, `cors`, `express-rate-limit` | Header bảo mật, CORS whitelist, giới hạn request. |

## 3. Các API xác thực

| Method | Endpoint | Chức năng | Yêu cầu xác thực |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Đăng ký tài khoản công dân | Không |
| `POST` | `/api/auth/login` | Đăng nhập, cấp JWT | Không |
| `POST` | `/api/auth/logout` | Xóa cookie JWT | Không bắt buộc |
| `GET` | `/api/auth/me` | Lấy thông tin người dùng hiện tại | Có JWT |

Các API nghiệp vụ trong `/api/app/documents` dùng `authenticate` để bắt buộc JWT. Một số route dành cho cán bộ/quản trị viên dùng thêm `requireRole("officer", "admin")`.

## 4. Flow đăng ký tài khoản

```text
Người dùng mở register.html
    -> frontend đọc form full_name, email, password, confirm_password
    -> kiểm tra password và confirm_password khớp nhau
    -> POST /api/auth/register
    -> backend kiểm tra thiếu trường cơ bản
    -> auth.service validate full_name, email, password
    -> kiểm tra email đã tồn tại
    -> bcrypt.hash(password, 10)
    -> lưu user mới với role citizen
    -> trả thông tin user an toàn, không trả password_hash
    -> frontend chuyển sang login.html?registered=1
```

Chi tiết xử lý:

- `full_name` tối thiểu 2 ký tự.
- `email` phải đúng định dạng regex cơ bản.
- `password` tối thiểu 6 ký tự.
- Nếu dùng JSON store, user được lưu ở `backend/src/data/users.json`.
- Nếu dùng MySQL, user được lưu vào bảng `users`, sau đó gán role `citizen` trong bảng `user_roles`.
- Mật khẩu không lưu dạng plaintext, chỉ lưu `password_hash`.

## 5. Flow đăng nhập

```text
Người dùng mở login.html
    -> frontend gửi email/password đến POST /api/auth/login
    -> backend tìm user theo email
    -> kiểm tra trạng thái tài khoản không bị locked
    -> bcrypt.compare(password, password_hash)
    -> tạo JWT chứa id, email, full_name, roles
    -> set cookie httpOnly tên token
    -> trả token và user trong response body
    -> frontend lưu token/user vào localStorage
    -> frontend điều hướng theo role
```

Điều hướng sau đăng nhập:

| Role đầu tiên trong danh sách | Trang được chuyển tới |
| --- | --- |
| `officer` hoặc `admin` | `/officer/dashboard.html` |
| Role khác, mặc định là `citizen` | `/citizen/dashboard.html` |

Payload JWT hiện tại gồm:

```json
{
  "id": "user id",
  "email": "user email",
  "full_name": "user full name",
  "roles": ["citizen", "officer", "admin"]
}
```

Thời hạn token lấy từ biến môi trường `JWT_EXPIRES_IN`, mặc định là `24h`.

## 6. Cơ chế lưu và gửi token

Backend đang dùng hai cách để nhận JWT:

1. Cookie httpOnly tên `token`.
2. Header `Authorization: Bearer <token>`.

Thứ tự ưu tiên trong `auth.middleware.js` là cookie trước, header sau.

```text
Request tới API được bảo vệ
    -> extractToken(req)
    -> nếu có req.cookies.token: dùng cookie
    -> nếu không có cookie: đọc Authorization Bearer
    -> jwt.verify(token, JWT_SECRET)
    -> nếu hợp lệ: gắn req.user
    -> nếu thiếu/sai/hết hạn: trả 401
```

Frontend `apiFetch` luôn gửi `credentials: "include"` để trình duyệt gửi cookie. Đồng thời, nếu `localStorage` có token thì frontend gửi thêm `Authorization: Bearer <token>` để tương thích ngược.

## 7. Flow kiểm tra người dùng hiện tại

```text
Frontend hoặc client gọi GET /api/auth/me
    -> authenticate kiểm tra JWT
    -> meHandler lấy user theo req.user.id
    -> trả về thông tin user không có password_hash
```

Endpoint này giúp xác minh session/token còn hợp lệ và lấy lại thông tin user từ storage.

## 8. Flow đăng xuất

```text
Người dùng bấm đăng xuất
    -> frontend xóa token và user khỏi localStorage
    -> frontend gọi POST /api/auth/logout với credentials include
    -> backend clearCookie("token")
    -> frontend chuyển về /login.html
```

Đăng xuất hiện tại là dạng client-side và cookie clear. Hệ thống chưa có blacklist/revocation list cho JWT, nên token đã cấp vẫn hợp lệ cho tới khi hết hạn nếu bị lộ.

## 9. Flow phân quyền nghiệp vụ

Middleware `authenticate` chỉ kiểm tra token hợp lệ và gắn `req.user`.

Middleware `requireRole(...roles)` kiểm tra `req.user.roles` có chứa ít nhất một role được yêu cầu hay không.

Ví dụ route nghiệp vụ:

| Nhóm route | Middleware | Ý nghĩa |
| --- | --- | --- |
| `GET /api/app/documents/` | `authenticate` | Người dùng đã đăng nhập mới được xem danh sách hồ sơ. Controller quyết định phạm vi dữ liệu theo role/chủ sở hữu. |
| `POST /api/app/documents/preview` | `authenticate` | Công dân/cán bộ/admin đã đăng nhập được tạo preview. |
| `POST /api/app/documents/submit` | `authenticate` | Người dùng đã đăng nhập được nộp hồ sơ. |
| `GET /api/app/documents/:documentId/download` | `authenticate` | Chỉ người có token hợp lệ được vào controller tải file; controller tiếp tục kiểm tra quyền truy cập hồ sơ. |
| `GET /api/app/documents/pending` | `authenticate` + `requireRole("officer", "admin")` | Chỉ cán bộ/admin xem hồ sơ chờ xử lý. |
| `POST /api/app/documents/:documentId/sign` | `authenticate` + `requireRole("officer", "admin")` | Chỉ cán bộ/admin ký số và phát hành hồ sơ. |

Các endpoint public verify nằm ở `/api/public/documents/verify/:documentId` không yêu cầu đăng nhập, vì chúng xác minh tài liệu bằng `documentId` và token QR riêng.

## 10. Rate limit và bảo vệ request

Trong `server.js`, hệ thống áp dụng:

- `globalLimiter`: tối đa 100 request/15 phút/IP cho mọi `/api`.
- `authLimiter`: tối đa 10 request/15 phút/IP cho `/api/auth`.
- `verifyLimiter`: tối đa 30 request/15 phút/IP cho `/api/public`.

Ý nghĩa:

- Giảm brute-force vào login/register.
- Giảm spam endpoint xác minh tài liệu công khai.
- Có lớp bảo vệ chung cho toàn bộ API.

Ngoài ra:

- `helmet` bật security headers cơ bản.
- CORS whitelist origin local mặc định và bật `credentials: true`.
- Cookie JWT dùng `httpOnly`, `sameSite: "strict"`, `secure: true` khi không phải dev.

## 11. Review logic hiện tại

### Điểm hợp lý

- Mật khẩu được hash bằng bcrypt, không lưu plaintext.
- JWT có thời hạn qua `JWT_EXPIRES_IN`.
- Backend đã ưu tiên httpOnly cookie, tốt hơn so với chỉ dùng `localStorage`.
- Middleware xác thực và middleware phân quyền được tách riêng, dễ đọc và dễ mở rộng.
- Role `citizen` được gán mặc định khi đăng ký.
- Route officer/admin có RBAC cơ bản.
- Có rate limit cho nhóm auth và public verify.
- Service hỗ trợ cả JSON demo và MySQL, phù hợp giai đoạn đồ án/demo.

### Điểm cần lưu ý

- Frontend vẫn lưu JWT trong `localStorage`. Cách này tiện cho demo nhưng tăng rủi ro nếu có XSS. Vì backend đã set httpOnly cookie, có thể tiến tới bỏ lưu token trong `localStorage`.
- `logout` chưa thu hồi JWT ở server. Nếu token bị lộ, token vẫn dùng được tới khi hết hạn.
- JWT chứa `roles`, và middleware tin vào role trong token đến hết hạn. Nếu admin đổi quyền hoặc khóa tài khoản, token cũ vẫn còn quyền cho tới khi hết hạn.
- `authenticate` không kiểm tra lại trạng thái tài khoản `locked` trên mỗi request. Trạng thái này chỉ được kiểm tra lúc login.
- `authLimiter` đang áp dụng cho toàn bộ `/api/auth`, bao gồm cả `/me` và `/logout`, không chỉ login/register. Điều này vẫn chạy được nhưng có thể gây khó chịu nếu frontend gọi `/me` nhiều.
- Một số lỗi validate từ `auth.service` có thể bị controller trả về `500` thay vì `400`, ví dụ email sai định dạng hoặc `full_name` quá ngắn nếu lọt qua kiểm tra thiếu trường ở controller.
- Bảng `audit_logs` có action `login/logout`, nhưng flow auth hiện tại chưa ghi audit log cho đăng nhập/đăng xuất.
- Schema có bảng `verification_tokens`, nhưng flow xác minh tài liệu hiện tại chủ yếu lưu `token_hash` trong `documents`. Cần thống nhất nếu muốn mở rộng token có hạn dùng/trạng thái `used/revoked`.

### Đề xuất cải thiện

| Mức ưu tiên | Đề xuất | Lý do |
| --- | --- | --- |
| Cao | Bỏ lưu JWT trong `localStorage`, chỉ dùng httpOnly cookie + `/api/auth/me` để lấy user | Giảm rủi ro token bị đánh cắp qua XSS. |
| Cao | Re-check user status và role từ DB/JSON trong middleware hoặc với token version | Khóa tài khoản/đổi quyền có hiệu lực nhanh hơn. |
| Trung bình | Tách rate limit: chỉ áp dụng `authLimiter` cho `/login` và `/register` | Tránh giới hạn nhầm `/me` và `/logout`. |
| Trung bình | Chuẩn hóa status code validate về `400` | API rõ ràng hơn, dễ debug hơn. |
| Trung bình | Ghi audit log cho login/logout thất bại/thành công | Phù hợp yêu cầu bảo mật và truy vết. |
| Thấp | Thêm refresh token hoặc session store nếu muốn trải nghiệm đăng nhập dài hạn | Có thể thu hồi session tốt hơn JWT stateless thuần. |

## 12. Kết luận

Flow xác thực hiện tại đủ cho đồ án demo: có đăng ký, đăng nhập, JWT, cookie httpOnly, phân quyền role và rate limit. Kiến trúc tách route/controller/service/middleware khá rõ ràng, dễ trình bày trong báo cáo.

Nếu hướng tới triển khai thực tế, phần cần ưu tiên nhất là giảm phụ thuộc vào `localStorage`, bổ sung cơ chế thu hồi/kiểm tra lại quyền của token, ghi audit log cho auth và chuẩn hóa lỗi validate.
