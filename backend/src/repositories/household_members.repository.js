import db from "../config/db.js";

/**
 * Lưu danh sách thành viên hộ gia đình cùng thay đổi vào DB.
 * @param {string} documentId
 * @param {Array} members - [{ full_name, birth_date, gender, personal_id, relationship_to_head }]
 */
export const saveMembersForDocument = async (documentId, members) => {
    if (!members || members.length === 0) return;
    const values = members.map(m => [
        documentId,
        m.full_name || "",
        m.birth_date || null,
        m.gender || "Nam",
        m.personal_id || "",
        m.relationship_to_head || null
    ]);
    await db.query(
        `INSERT INTO household_member_changes
            (document_id, full_name, birth_date, gender, personal_id, relationship_to_head)
         VALUES ?`,
        [values]
    );
};

/**
 * Lấy danh sách thành viên theo documentId.
 * @param {string} documentId
 * @returns {Array}
 */
export const getMembersForDocument = async (documentId) => {
    const [rows] = await db.query(
        "SELECT * FROM household_member_changes WHERE document_id = ? ORDER BY id ASC",
        [documentId]
    );
    return rows;
};
