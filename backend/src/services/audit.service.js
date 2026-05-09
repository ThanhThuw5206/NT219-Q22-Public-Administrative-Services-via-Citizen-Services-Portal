const auditLogs = [];

export const writeAuditLog = ({ action, documentId = null, result, actor = "anonymous", ipAddress = null, details = {} }) => {
    const entry = {
        log_id: `LOG-${Date.now()}-${auditLogs.length + 1}`,
        action,
        document_id: documentId,
        actor,
        ip_address: ipAddress,
        result,
        details,
        created_at: new Date().toISOString()
    };

    auditLogs.push(entry);
    return entry;
};

export const listAuditLogs = () => auditLogs;
