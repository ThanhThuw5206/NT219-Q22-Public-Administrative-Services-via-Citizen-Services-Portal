import db from "../config/db.js";

export const submitCT01 = async (data) => {
    const sql = `
        INSERT INTO temp_residence_registrations
        (citizen_id, current_address, temporary_address, reason, start_date, end_date, guardian_consent, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    const values = [
        data.citizen_id,
        data.current_address,
        data.temporary_address,
        data.reason,
        data.start_date,
        data.end_date,
        data.guardian_consent
    ];

    const [result] = await db.query(sql, values);

    return {
        registration_id: result.insertId,
        status: "pending"
    };
};