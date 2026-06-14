-- =========================================================================
-- 1. TẠO DATABASE
-- =========================================================================
CREATE DATABASE IF NOT EXISTS document_verification CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE document_verification;

-- =========================================================================
-- 2. BẢNG USERS (Người dùng)
-- =========================================================================
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status ENUM('active', 'locked') DEFAULT 'active',
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =========================================================================
-- 3. BẢNG ROLES (Vai trò)
-- =========================================================================
CREATE TABLE roles (
    role_id INT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(50) UNIQUE NOT NULL
) ENGINE=InnoDB;

-- Chèn sẵn các vai trò hệ thống
INSERT IGNORE INTO roles (role_name) VALUES ('citizen'), ('officer'), ('verifier'), ('admin');

-- =========================================================================
-- 4. BẢNG USER_ROLES (Gán quyền phân vai trò)
-- =========================================================================
CREATE TABLE user_roles (
    user_id INT,
    role_id INT,
    assigned_by INT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =========================================================================
-- 4B. BẢNG ORGANIZATIONS (Cơ quan phát hành)
-- =========================================================================
CREATE TABLE organizations (
    organization_id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) UNIQUE NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE user_organizations (
    user_id INT NOT NULL,
    organization_id VARCHAR(100) NOT NULL,
    position VARCHAR(255) NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, organization_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================================================
-- 5. BẢNG KEYS_PUB (Khóa công khai)
-- =========================================================================
CREATE TABLE keys_pub (
    key_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    algorithm VARCHAR(50) NOT NULL DEFAULT 'FALCON',
    public_key TEXT NOT NULL,
    status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE signing_keys (
    key_id VARCHAR(150) PRIMARY KEY,
    algorithm VARCHAR(50) NOT NULL DEFAULT 'FALCON-512',
    provider VARCHAR(100) NOT NULL DEFAULT 'file',
    public_key TEXT NOT NULL,
    private_key_ref TEXT NULL,
    owner_type ENUM('user', 'organization') NOT NULL DEFAULT 'organization',
    owner_id VARCHAR(100) NOT NULL,
    owner_name VARCHAR(255) NULL,
    status ENUM('active', 'retired', 'revoked', 'expired') DEFAULT 'active',
    valid_from TIMESTAMP NULL,
    valid_to TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rotated_at TIMESTAMP NULL,
    revoked_at TIMESTAMP NULL,
    revocation_reason TEXT NULL
) ENGINE=InnoDB;

-- =========================================================================
-- 6. BẢNG DOCUMENT_PREVIEWS (Bản xem trước tài liệu nháp)
-- =========================================================================
CREATE TABLE document_previews (
    preview_id VARCHAR(100) PRIMARY KEY,
    document_id VARCHAR(50) NULL,
    owner_id INT NULL,
    preview_path TEXT NOT NULL,
    preview_url TEXT NULL,
    document_folder TEXT NULL,
    form_data JSON NOT NULL,
    status ENUM('preview', 'issued', 'expired') DEFAULT 'preview',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP NULL,
    issued_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =========================================================================
-- 7. BẢNG DOCUMENTS (Hồ sơ/Tài liệu chính - Không dùng AUTO_INCREMENT trường chuỗi)
-- =========================================================================
CREATE TABLE documents (
    document_id VARCHAR(50) PRIMARY KEY,
    owner_id INT NOT NULL,
    file_hash CHAR(64) NULL,
    signed_file_hash CHAR(64) NULL,
    signature TEXT NULL,
    public_key_id VARCHAR(100) NULL,
    public_key TEXT NULL,
    token_hash CHAR(64) NULL,
    status ENUM('submitted', 'issued', 'revoked') DEFAULT 'submitted',
    verify_url TEXT NULL,
    qr_payload JSON NULL,
    signature_payload JSON NULL,
    algorithm VARCHAR(50) NULL,
    signature_provider VARCHAR(100) NULL,
    original_name VARCHAR(255) NULL,
    file_path TEXT NULL,
    original_file_hash CHAR(64) NULL,
    preview_id VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    signed_at TIMESTAMP NULL,
    original_pdf_path TEXT NULL,
    signed_pdf_path TEXT NULL,
    signature_evidence_path TEXT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (preview_id) REFERENCES document_previews(preview_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Không thêm FK từ document_previews.document_id → documents vì preview được tạo TRƯỚC khi document tồn tại
-- document_id trong document_previews là plain reference string, không phải FK

-- =========================================================================
-- 8. BẢNG DOCUMENT_SIGNATURES (Lịch sử chữ ký số)
-- =========================================================================
CREATE TABLE document_signatures (
    id INT PRIMARY KEY AUTO_INCREMENT,
    document_id VARCHAR(50) NOT NULL,
    file_hash CHAR(64) NOT NULL,
    signature TEXT NOT NULL,
    algorithm VARCHAR(50) DEFAULT 'FALCON',
    public_key_id VARCHAR(100) NULL,
    signature_type ENUM('officer_personal_falcon', 'organization_falcon', 'pdf_native_pades') DEFAULT 'organization_falcon',
    signature_payload_json JSON NULL,
    payload_hash CHAR(64) NULL,
    original_file_hash CHAR(64) NULL,
    signer_user_id VARCHAR(100) NULL,
    signer_full_name VARCHAR(255) NULL,
    signer_role VARCHAR(100) NULL,
    organization_id VARCHAR(100) NULL,
    organization_name VARCHAR(255) NULL,
    signing_ip VARCHAR(50) NULL,
    signing_reason TEXT NULL,
    signature_status ENUM('active', 'revoked') DEFAULT 'active',
    signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================================================
-- 9. BẢNG VERIFICATION_TOKENS (Token xác thực QR nhanh)
-- =========================================================================
CREATE TABLE verification_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    document_id VARCHAR(50) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expired_at TIMESTAMP NULL,
    status ENUM('active', 'used', 'revoked') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================================================
-- 10. BẢNG AUDIT LOGS (Nhật ký hành động bảo mật)
-- =========================================================================
CREATE TABLE audit_logs (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    action ENUM('submit', 'sign', 'verify', 'download', 'login', 'logout', 'key_access') NOT NULL,
    document_id VARCHAR(50) NULL,
    ip_address VARCHAR(50) NULL,
    result ENUM('success', 'fail') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =========================================================================
-- 11. BẢNG TEMP_RESIDENCE_REGISTRATIONS (Đơn đăng ký tạm trú)
-- =========================================================================
CREATE TABLE temp_residence_registrations (
    registration_id INT PRIMARY KEY AUTO_INCREMENT,
    citizen_id INT NOT NULL,
    current_address TEXT NOT NULL,
    temporary_address TEXT NOT NULL,
    reason TEXT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    guardian_consent BOOLEAN DEFAULT FALSE,
    status ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled') DEFAULT 'pending',
    reviewed_by INT NULL,
    reviewed_at TIMESTAMP NULL,
    rejection_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_temp_residence_dates CHECK (end_date > start_date AND DATEDIFF(end_date, start_date) <= 730),
    FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =========================================================================
-- 12. BẢNG TEMP_RESIDENCE_DOCUMENTS (Giấy tờ minh chứng tạm trú đính kèm)
-- =========================================================================
CREATE TABLE temp_residence_documents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    registration_id INT NOT NULL,
    document_id VARCHAR(50) NOT NULL,
    document_type ENUM('residence_form', 'legal_residence_proof', 'guardian_consent', 'other') NOT NULL,
    attached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES temp_residence_registrations(registration_id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================================================
-- 13. BẢNG TEMP_RESIDENCE_EXTENSIONS (Gia hạn tạm trú)
-- =========================================================================
CREATE TABLE temp_residence_extensions (
    extension_id INT PRIMARY KEY AUTO_INCREMENT,
    registration_id INT NOT NULL,
    old_end_date DATE NOT NULL,
    new_end_date DATE NOT NULL,
    reason TEXT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    approved_by INT NULL,
    approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES temp_residence_registrations(registration_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =========================================================================
-- 14. BẢNG HOUSEHOLD_MEMBER_CHANGES (Thay đổi thành viên hộ gia đình)
-- =========================================================================
CREATE TABLE household_member_changes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    document_id VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    birth_date DATE NOT NULL,
    gender ENUM('Nam', 'Nữ', 'Khác') NOT NULL,
    personal_id VARCHAR(20) NOT NULL,
    relationship_to_head VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================================================
-- 15. HỆ THỐNG INDEXES TỐI ƯU TRUY VẤN TỐC ĐỘ CAO
-- =========================================================================
CREATE INDEX idx_temp_residence_citizen ON temp_residence_registrations(citizen_id);
CREATE INDEX idx_temp_residence_status ON temp_residence_registrations(status);
CREATE INDEX idx_temp_residence_dates ON temp_residence_registrations(start_date, end_date);
CREATE INDEX idx_temp_documents_registration ON temp_residence_documents(registration_id);
CREATE INDEX idx_temp_extensions_registration ON temp_residence_extensions(registration_id);
CREATE INDEX idx_documents_token_hash ON documents(token_hash);
CREATE INDEX idx_verification_tokens_token_hash ON verification_tokens(token_hash);
CREATE INDEX idx_preview_document_id ON document_previews(document_id);
CREATE INDEX idx_preview_status ON document_previews(status);

-- =========================================================================
-- 16. MỞ RỘNG: Thêm trạng thái "rejected" và thông tin từ chối hồ sơ
-- =========================================================================
ALTER TABLE documents
    MODIFY COLUMN status ENUM('submitted', 'issued', 'revoked', 'rejected') DEFAULT 'submitted',
    ADD COLUMN rejection_reason TEXT NULL,
    ADD COLUMN rejected_at TIMESTAMP NULL;

ALTER TABLE audit_logs
    MODIFY COLUMN action ENUM('submit', 'sign', 'verify', 'download', 'login', 'logout', 'key_access', 'reject') NOT NULL;
