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

-- 5. KEYS
-- Lưu public key (KHÔNG lưu private key)

CREATE TABLE keys (
    key_id INT PRIMARY KEY AUTO_INCREMENT,
    algorithm VARCHAR(50) NOT NULL,
    -- ví dụ: FALCON
    public_key TEXT NOT NULL,
    status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP NULL
    ALTER TABLE keys ADD COLUMN user_id INT NOT NULL AFTER key_id;
    ALTER TABLE keys ADD FOREIGN KEY (user_id) REFERENCES users(id);
);

-- 6. DOCUMENTS
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
    FOREIGN KEY (owner_id) REFERENCES users(id),
    FOREIGN KEY (public_key_id) REFERENCES keys(key_id)
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

-- 10. TEMP_RESIDENCE_REGISTRATIONS
-- Đăng ký tạm trú

CREATE TABLE temp_residence_registrations (
    registration_id INT PRIMARY KEY AUTO_INCREMENT,

    citizen_id INT NOT NULL,
    -- Người đăng ký
    current_address TEXT NOT NULL,
    -- Địa chỉ thường trú
    temporary_address TEXT NOT NULL,
    -- Địa chỉ tạm trú
    reason TEXT,
    -- Lý do:
    -- học tập, lao động,...
    start_date DATE NOT NULL,

    end_date DATE NOT NULL,

    guardian_consent BOOLEAN DEFAULT FALSE,
    -- dành cho người chưa thành niên
    status ENUM(
        'pending',
        'approved',
        'rejected',
        'expired',
        'cancelled'
    ) DEFAULT 'pending',
    reviewed_by INT NULL,
    reviewed_at TIMESTAMP NULL,
    rejection_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_temp_residence_dates
    CHECK (
        end_date > start_date
        AND DATEDIFF(end_date, start_date) <= 730
    ),

    FOREIGN KEY (citizen_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    FOREIGN KEY (reviewed_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

-- 11. TEMP_RESIDENCE_DOCUMENTS
-- Giấy tờ minh chứng

CREATE TABLE temp_residence_documents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    registration_id INT NOT NULL,
    document_id INT NOT NULL,   -- tham chiếu đến bảng documents
    document_type ENUM('residence_form', 'legal_residence_proof', 'guardian_consent', 'other') NOT NULL,
   
    attached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES temp_residence_registrations(registration_id),
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);
-- 12. TEMP_RESIDENCE_EXTENSIONS
-- Gia hạn tạm trú

CREATE TABLE temp_residence_extensions (
    extension_id INT PRIMARY KEY AUTO_INCREMENT,
    registration_id INT NOT NULL,
    old_end_date DATE NOT NULL,
    new_end_date DATE NOT NULL,
    reason TEXT,

    status ENUM(
        'pending',
        'approved',
        'rejected'
    ) DEFAULT 'pending',

    approved_by INT NULL,
    approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (registration_id)
        REFERENCES temp_residence_registrations(registration_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    FOREIGN KEY (approved_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

-- 13. INDEXES

CREATE INDEX idx_temp_residence_citizen
ON temp_residence_registrations(citizen_id);

CREATE INDEX idx_temp_residence_status
ON temp_residence_registrations(status);

CREATE INDEX idx_temp_residence_dates
ON temp_residence_registrations(start_date, end_date);

CREATE INDEX idx_temp_documents_registration
ON temp_residence_documents(registration_id);

CREATE INDEX idx_temp_extensions_registration
ON temp_residence_extensions(registration_id);

CREATE INDEX idx_documents_token_hash 
ON documents(token_hash);

CREATE INDEX idx_verification_tokens_token_hash 
ON verification_tokens(token_hash);
