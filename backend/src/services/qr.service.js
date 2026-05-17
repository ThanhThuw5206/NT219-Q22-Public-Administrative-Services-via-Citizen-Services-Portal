//generate QR code
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import { createDocumentFolder } from "../utils/storage.util.js";

export const generateQrCode = async ({
    documentId,
    verifyUrl,
    token
}) => {

    // tạo folder cho document
    const documentFolder = createDocumentFolder(documentId);

    // khai báo qrFolder (ĐÂY LÀ LỖI CỦA BẠN)
    const qrFolder = path.join(documentFolder, "qr");

    if (!fs.existsSync(qrFolder)) {
        fs.mkdirSync(qrFolder, { recursive: true });
    }

    const qrData = JSON.stringify({
        documentId,
        verifyUrl,
        token
    });

    const qrPath = path.join(qrFolder, "qr.png");

    await QRCode.toFile(qrPath, qrData);

    return qrPath;
};