import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const signedDirectory = path.resolve(__dirname, "../signed");

const safeFileName = (value) => {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
};

const shorten = (value, length = 72) => {
    if (!value || value.length <= length) {
        return value;
    }

    return `${value.slice(0, length)}...`;
};

export const createSignedPdf = async ({ sourceFilePath, documentRecord }) => {
    fs.mkdirSync(signedDirectory, { recursive: true });

    const sourceBytes = fs.readFileSync(sourceFilePath);
    const pdfDocument = await PDFDocument.load(sourceBytes);
    const pages = pdfDocument.getPages();
    const targetPage = pages[pages.length - 1];
    const { width } = targetPage.getSize();
    const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);
    const qrDataUrl = await QRCode.toDataURL(JSON.stringify(documentRecord.qr_payload), {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 180
    });
    const qrImage = await pdfDocument.embedPng(qrDataUrl);

    const boxWidth = Math.min(420, width - 64);
    const boxHeight = 118;
    const x = 32;
    const y = 32;
    const qrSize = 82;

    targetPage.drawRectangle({
        x,
        y,
        width: boxWidth,
        height: boxHeight,
        borderColor: rgb(0.1, 0.28, 0.48),
        borderWidth: 1,
        color: rgb(0.96, 0.98, 1)
    });

    targetPage.drawImage(qrImage, {
        x: x + 12,
        y: y + 18,
        width: qrSize,
        height: qrSize
    });

    const textX = x + qrSize + 24;
    let textY = y + boxHeight - 24;

    targetPage.drawText("DIGITALLY SIGNED DOCUMENT", {
        x: textX,
        y: textY,
        size: 10,
        font: boldFont,
        color: rgb(0.08, 0.22, 0.38)
    });

    const lines = [
        `Document ID: ${documentRecord.document_id}`,
        `Verify URL: ${shorten(documentRecord.verify_url, 58)}`,
        `Algorithm: ${documentRecord.algorithm}`,
        `Key ID: ${documentRecord.public_key_id}`,
        `Issued at: ${documentRecord.signed_at}`
    ];

    for (const line of lines) {
        textY -= 16;
        targetPage.drawText(line, {
            x: textX,
            y: textY,
            size: 8,
            font,
            color: rgb(0.12, 0.12, 0.12)
        });
    }

    pdfDocument.setTitle(documentRecord.original_name || documentRecord.document_id);
    pdfDocument.setSubject(`Signed public administrative service document ${documentRecord.document_id}`);
    pdfDocument.setKeywords([
        "public-administrative-service",
        "digital-signature",
        documentRecord.document_id,
        documentRecord.public_key_id
    ]);
    pdfDocument.setProducer("Citizen Services Portal");
    pdfDocument.setCreator("Citizen Services Portal");

    const signedBytes = await pdfDocument.save();
    const signedFileName = `${documentRecord.document_id}-${safeFileName(documentRecord.original_name || "document.pdf")}`;
    const signedFilePath = path.join(signedDirectory, signedFileName);
    fs.writeFileSync(signedFilePath, signedBytes);

    return signedFilePath;
};
