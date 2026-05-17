//embed QR vào PDF
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { createDocumentFolder } from "../utils/storage.util.js";

export const embedQrIntoPdf = async ({
    sourceFilePath,
    qrPath,
    outputFilePath
}) => {

    // CREATE DOCUMENT FOLDER

    // LOAD PDF
   const existingPdfBytes = fs.readFileSync(sourceFilePath);

    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // LOAD QR IMAGE
    const qrImageBytes = fs.readFileSync(qrPath);

    const qrImage = await pdfDoc.embedPng(qrImageBytes);

    // GET FIRST PAGE
    const pages = pdfDoc.getPages();

    const firstPage = pages[0];

   // DRAW QR
   firstPage.drawImage(qrImage, {
        x: 420,
        y: 40,
        width: 120,
        height: 120
    });

    // SAVE PDF
   const pdfBytes = await pdfDoc.save();

    fs.writeFileSync(outputFilePath, pdfBytes);

return outputFilePath;
};