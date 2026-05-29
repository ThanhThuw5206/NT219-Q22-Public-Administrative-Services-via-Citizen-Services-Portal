/**
 * Strip HTML tags to prevent stored XSS.
 */
function sanitize(str) {
    if (typeof str !== "string") return str;
    return str.replace(/<[^>]*>/g, "").trim();
}

export const validateCT01 = (data) => {

    // 1. basic info
    if (!data.full_name || typeof data.full_name !== "string") {
        throw new Error("full_name required");
    }
    if (data.full_name.length > 200) {
        throw new Error("full_name must be at most 200 characters");
    }
    data.full_name = sanitize(data.full_name);

    if (!data.dob || typeof data.dob !== "string") {
        throw new Error("dob required");
    }
    // Validate date format (YYYY-MM-DD or similar)
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(data.dob)) {
        throw new Error("dob must be in YYYY-MM-DD format");
    }

    if (!data.gender || typeof data.gender !== "string") {
        throw new Error("gender required");
    }
    if (!["male", "female", "other", "nam", "nữ", "khác"].includes(data.gender.toLowerCase())) {
        throw new Error("gender must be male/female/other");
    }

    if (!data.cccd || typeof data.cccd !== "string") {
        throw new Error("cccd required");
    }
    // Vietnamese citizen ID: 9-12 digits
    if (!/^\d{9,12}$/.test(data.cccd)) {
        throw new Error("cccd must be 9-12 digits");
    }

    if (!data.reason || typeof data.reason !== "string") {
        throw new Error("reason required");
    }
    if (data.reason.length > 2000) {
        throw new Error("reason must be at most 2000 characters");
    }
    data.reason = sanitize(data.reason);

    // 2. phone (optional but nếu có thì validate)
    if (data.phone) {
        if (typeof data.phone !== "string" || !/^\d{9,11}$/.test(data.phone)) {
            throw new Error("phone invalid: must be 9-11 digits");
        }
    }

    // 3. email (optional)
    if (data.email) {
        if (typeof data.email !== "string" || data.email.length > 254) {
            throw new Error("email too long");
        }
        data.email = sanitize(data.email);
    }

    // 4. address fields (optional, sanitize)
    if (data.address) data.address = sanitize(data.address);
    if (data.ward) data.ward = sanitize(data.ward);
    if (data.district) data.district = sanitize(data.district);
    if (data.province) data.province = sanitize(data.province);

    // 5. members array (quan trọng DB mới)
    if (data.members) {
        if (!Array.isArray(data.members)) {
            throw new Error("members must be array");
        }
        if (data.members.length > 50) {
            throw new Error("members array too large (max 50)");
        }
        // Sanitize each member's name
        data.members.forEach((m, i) => {
            if (m.full_name) m.full_name = sanitize(m.full_name);
            if (m.cccd && !/^\d{9,12}$/.test(m.cccd)) {
                throw new Error(`members[${i}].cccd must be 9-12 digits`);
            }
        });
    }
};