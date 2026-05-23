export const validateCT01 = (data) => {

    if (!data.full_name) {
        throw new Error(
            "full_name required"
        );
    }

    if (!data.citizen_id) {
        throw new Error(
            "citizen_id required"
        );
    }

    if (
        !/^\d{12}$/.test(
            data.citizen_id
        )
    ) {
        throw new Error(
            "citizen_id invalid"
        );
    }

    if (!data.phone) {
        throw new Error(
            "phone required"
        );
    }

    if (!data.request_content) {
        throw new Error(
            "request_content required"
        );
    }

};