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
};