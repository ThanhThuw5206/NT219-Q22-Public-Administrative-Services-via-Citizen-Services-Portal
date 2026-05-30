export const validateCT01 = (data) => {

    // 1. basic info
    if (!data.full_name) {
        throw new Error("full_name required");
    }

    if (!data.dob) {
        throw new Error("dob required");
    }

    if (!data.gender) {
        throw new Error("gender required");
    }

    if (!data.cccd) {
        throw new Error("cccd required");
    }

    if (!data.reason) {
        throw new Error("reason required");
    }

    // 3. phone (optional but nếu có thì validate)
    if (data.phone && !/^\d{9,11}$/.test(data.phone)) {
        throw new Error("phone invalid");
    }

    // 4. members array (quan trọng DB mới)
    if (data.members && !Array.isArray(data.members)) {
        throw new Error("members must be array");
    }

    // 5. Validate từng thành viên
    if (Array.isArray(data.members)) {
        const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
        data.members.forEach((m, i) => {
            const num = i + 1;
            if (!m.full_name) throw new Error(`Thành viên ${num}: Thiếu họ tên`);
            if (!m.birth_date) throw new Error(`Thành viên ${num}: Thiếu ngày sinh`);
            if (!dateRegex.test(m.birth_date)) throw new Error(`Thành viên ${num}: Ngày sinh không hợp lệ (định dạng yyyy-mm-dd, tháng/ngày phải hợp lệ)`);
            if (!m.gender) throw new Error(`Thành viên ${num}: Thiếu giới tính`);
            if (!m.personal_id) throw new Error(`Thành viên ${num}: Thiếu số định danh cá nhân`);
            if (!/^\d{12}$/.test(m.personal_id)) throw new Error(`Thành viên ${num}: Số định danh phải có đúng 12 chữ số`);
        });
    }
};