-- 1. TẠO DATABASE

CREATE DATABASE IF NOT EXISTS document_verification;
USE document_verification;

-- 2. USERS
-- Lưu thông tin người dùng

CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    full_name VARCHAR(255) NOT NULL,          -- Họ tên người dùng
    email VARCHAR(255) UNIQUE NOT NULL,       -- Email đăng nhập
    password_hash VARCHAR(255) NOT NULL,      -- Mật khẩu đã mã hóa
    
    status ENUM('active', 'locked') DEFAULT 'active',
    -- trạng thái tài khoản (khóa / hoạt động)
    
    created_by INT NULL,
    -- ai tạo tài khoản này (NULL nếu citizen tự đăng ký)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 3. ROLES
-- Danh sách vai trò trong hệ thống 

CREATE TABLE roles (
    role_id INT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(50) UNIQUE NOT NULL
    -- citizen, officer, verifier, admin
);

-- 4. USER_ROLES
-- Gán quyền cho user (RBAC - Role Based Access Control)
-- 1 user có thể có nhiều role nếu cần mở rộng

CREATE TABLE user_roles 
(
    user_id INT,
    role_id INT,
    
    assigned_by INT,
    -- admin nào cấp quyền
    
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (user_id, role_id),
    
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (role_id) REFERENCES roles(role_id),
    FOREIGN KEY (assigned_by) REFERENCES users(id)
);

-- 5. DOCUMENTS
-- Lưu thông tin tài liệu/hồ sơ

CREATE TABLE documents (
    document_id INT PRIMARY KEY AUTO_INCREMENT,
    owner_id INT NOT NULL,
    -- người sở hữu tài liệu
    file_hash CHAR(64) NOT NULL,
    -- SHA-256 của file PDF
    signature TEXT NOT NULL,
    -- chữ ký số FALCON
    public_key_id INT NOT NULL,
    -- khóa công khai dùng để verify
    token_hash CHAR(64) NOT NULL,
    -- hash của token QR xác minh
    status ENUM('submitted', 'issued', 'revoked') DEFAULT 'submitted',
    -- trạng thái hồ sơ
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    signed_at TIMESTAMP NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- 6. KEYS
-- Lưu public key (KHÔNG lưu private key)

CREATE TABLE keys (
    key_id INT PRIMARY KEY AUTO_INCREMENT,
    algorithm VARCHAR(50) NOT NULL,
    -- ví dụ: FALCON
    public_key TEXT NOT NULL,
    status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP NULL
);

-- 7. DOCUMENT_SIGNATURES
-- Lưu chữ ký số + hash tài liệu

CREATE TABLE document_signatures (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    document_id INT NOT NULL,
    
    file_hash CHAR(64) NOT NULL,
    signature TEXT NOT NULL,
    
    algorithm VARCHAR(50) DEFAULT 'FALCON',
    
    public_key_id INT NOT NULL,
    
    signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (document_id) REFERENCES documents(document_id),
    FOREIGN KEY (public_key_id) REFERENCES keys(key_id)
);

-- 8. VERIFICATION_TOKENS
-- Token dùng để verify tài liệu (QR / link)

CREATE TABLE verification_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    document_id INT NOT NULL,
    
    token_hash CHAR(64) NOT NULL,
    
    expired_at TIMESTAMP,
    
    status ENUM('active', 'used', 'revoked') DEFAULT 'active',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

-- 9. AUDIT LOGS
-- Ghi lại toàn bộ hành động hệ thống (log bảo mật)

CREATE TABLE audit_logs (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    
    user_id INT,
    -- ai thực hiện hành động
    
    action ENUM('submit', 'sign', 'verify', 'download', 'login', 'logout'),
    document_id INT,
    
    ip_address VARCHAR(50),
    
    result ENUM('success', 'fail'),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

-- 10. INDEX (TỐI ƯU HIỆU NĂNG)

CREATE INDEX idx_documents_owner ON documents(owner_id);
CREATE INDEX idx_signature_doc ON document_signatures(document_id);
CREATE INDEX idx_token_hash ON verification_tokens(token_hash);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_doc ON audit_logs(document_id);