import crypto from "crypto";

export const createPreviewDocument = async (data) => {

    const previewId = crypto.randomUUID();

    // TODO:
    // generate PDF preview tại đây

    return {
        preview_id: previewId,
        preview_url: `/storage/preview/${previewId}.pdf`
    };
};