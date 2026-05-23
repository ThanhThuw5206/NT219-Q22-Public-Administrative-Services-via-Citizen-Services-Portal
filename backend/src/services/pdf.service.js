/**
 * PDF Embedder Service
 * --------------------
 * Embeds a QR code image and (optionally) a metadata box into a PDF document.
 *
 * Layout (Requirement 3.1, 3.2, 3.3):
 *   - Target page: the LAST page of the source PDF
 *     (`pages[pages.length - 1]`, NOT the first page).
 *   - QR code:
 *       position : (x: 32, y: 32) measured in points from bottom-left
 *       size     : 82 x 82 points
 *   - Metadata box (only when `metadata` is supplied):
 *       position    : (x: 120, y: 32) measured in points from bottom-left
 *       min width   : 200 points
 *       border      : 1 point
 *       padding     : 8 points (internal)
 *       font        : Helvetica 9pt
 *       lines       : Document ID, Verify URL, Algorithm, Key ID, Issued at
 *       overflow    : `verify_url` is visually truncated with an ellipsis
 *                     if it exceeds the inner width at 9pt.
 *
 * PDF document info (Requirement 3.5) — set on every successful embed:
 *   - Title    : metadata.document_id
 *   - Subject  : "Signed Administrative Document"
 *   - Keywords : ["digital signature", "Falcon-512", "government document"]
 *   - Producer : "Falcon Digital Signature System"
 *   - Creator  : "Public Administrative Services Portal"
 *
 * Error handling — all thrown errors are instances of `PdfEmbedderError` with
 * a `code` field. Possible codes:
 *   - INVALID_PDF              : `PDFDocument.load` rejected the source bytes
 *                                (corrupted / non-PDF input).
 *   - STORAGE_OPERATION_FAILED : read/write of the source PDF, QR image, or
 *                                output PDF failed at the filesystem layer.
 *                                A best-effort cleanup of the partial output
 *                                file is performed before the error is thrown.
 *   - PDF_EMBED_FAILED         : `pdf-lib` raised during draw/save/embedPng.
 *
 * Public exports:
 *   - embedQRAndMetadata({pdfBytes, qrImagePath, metadata}) -> Buffer
 *   - validatePDF(pdfBytes) -> boolean
 *   - embedQrIntoPdf({sourceFilePath, qrPath, outputFilePath, metadata?})
 *       Backwards-compatible adapter consumed by `document.service1.js`.
 *       When `metadata` is omitted, ONLY the QR is drawn (no metadata box) —
 *       this preserves the existing production call shape. The QR is always
 *       placed on the LAST page (the bug fix applies to both code paths).
 *   - PdfEmbedderError -> typed error class
 */

import fs from "fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// QR placement (Requirement 3.2)
const QR_X = 32;
const QR_Y = 32;
const QR_SIZE = 82;

// Metadata box placement (Requirement 3.3)
const META_X = 120;
const META_Y = 32;
const META_MIN_WIDTH = 200;
const META_BORDER = 1;
const META_PADDING = 8;
const META_FONT_SIZE = 9;
// Roughly font-size * 1.25 — matches Helvetica's natural line height closely
// enough for our 5-line layout while keeping the box compact.
const META_LINE_HEIGHT = Math.round(META_FONT_SIZE * 1.25);
const META_LABELS = [
    "Document ID",
    "Verify URL",
    "Algorithm",
    "Key ID",
    "Issued at"
];

/**
 * Typed error for the PDF Embedder Service.
 * @property {string} code - One of: INVALID_PDF, STORAGE_OPERATION_FAILED, PDF_EMBED_FAILED
 */
export class PdfEmbedderError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "PdfEmbedderError";
        this.code = code;
        if (options.cause !== undefined) {
            this.cause = options.cause;
        }
    }
}

const removePartialFile = (filePath) => {
    if (!filePath) {
        return;
    }
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (_cleanupErr) {
        // Swallow cleanup errors — the original failure is the one that matters.
    }
};

const loadPdfDocument = async (pdfBytes) => {
    try {
        return await PDFDocument.load(pdfBytes);
    } catch (err) {
        throw new PdfEmbedderError(
            "INVALID_PDF",
            "Source PDF could not be parsed (malformed or non-PDF input)",
            { cause: err }
        );
    }
};

/**
 * Truncate `text` so that its rendered width at `size` (using `font`) fits
 * within `maxWidth`. If the text already fits, it is returned unchanged.
 * Otherwise the tail is replaced with an ellipsis ("…").
 */
const truncateToWidth = (text, font, size, maxWidth) => {
    if (typeof text !== "string" || text.length === 0) {
        return "";
    }
    if (font.widthOfTextAtSize(text, size) <= maxWidth) {
        return text;
    }
    const ellipsis = "…";
    const ellipsisWidth = font.widthOfTextAtSize(ellipsis, size);
    if (ellipsisWidth >= maxWidth) {
        // Box is too narrow to even fit the ellipsis — give up gracefully.
        return ellipsis;
    }
    let lo = 0;
    let hi = text.length;
    // Binary search the longest prefix length whose width + ellipsis fits.
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        const candidate = text.slice(0, mid);
        const width = font.widthOfTextAtSize(candidate, size) + ellipsisWidth;
        if (width <= maxWidth) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return text.slice(0, lo) + ellipsis;
};

const drawQrOnLastPage = (pdfDoc, qrImage) => {
    const pages = pdfDoc.getPages();
    if (pages.length === 0) {
        throw new PdfEmbedderError(
            "PDF_EMBED_FAILED",
            "Source PDF contains no pages"
        );
    }
    // Bug fix (Requirement 3.1): embed on the LAST page, not pages[0].
    const lastPage = pages[pages.length - 1];
    lastPage.drawImage(qrImage, {
        x: QR_X,
        y: QR_Y,
        width: QR_SIZE,
        height: QR_SIZE
    });
    return lastPage;
};

const drawMetadataBox = (page, font, metadata) => {
    const labelValues = [
        `${META_LABELS[0]}: ${metadata.document_id ?? ""}`,
        `${META_LABELS[1]}: ${metadata.verify_url ?? ""}`,
        `${META_LABELS[2]}: ${metadata.algorithm ?? ""}`,
        `${META_LABELS[3]}: ${metadata.key_id ?? ""}`,
        `${META_LABELS[4]}: ${metadata.issued_at ?? ""}`
    ];

    const boxWidth = META_MIN_WIDTH;
    const innerWidth = boxWidth - 2 * META_PADDING;
    const boxHeight =
        2 * META_PADDING + labelValues.length * META_LINE_HEIGHT;

    // Border (1pt rectangle outline).
    page.drawRectangle({
        x: META_X,
        y: META_Y,
        width: boxWidth,
        height: boxHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: META_BORDER
    });

    // Render each line. The verify_url (index 1) is the one most likely to
    // overflow, but we apply truncation uniformly so any oversized value is
    // handled consistently.
    const textColor = rgb(0, 0, 0);
    // First line is rendered at the TOP of the box, so we start at
    // (top - padding - lineHeight) and work downward.
    const topY = META_Y + boxHeight - META_PADDING - META_LINE_HEIGHT;
    labelValues.forEach((line, idx) => {
        const safe = truncateToWidth(line, font, META_FONT_SIZE, innerWidth);
        page.drawText(safe, {
            x: META_X + META_PADDING,
            y: topY - idx * META_LINE_HEIGHT + META_FONT_SIZE * 0.25,
            size: META_FONT_SIZE,
            font,
            color: textColor
        });
    });
};

const applyDocumentInfo = (pdfDoc, metadata) => {
    pdfDoc.setTitle(String(metadata.document_id ?? ""));
    pdfDoc.setSubject("Signed Administrative Document");
    pdfDoc.setKeywords([
        "digital signature",
        "Falcon-512",
        "government document"
    ]);
    pdfDoc.setProducer("Falcon Digital Signature System");
    pdfDoc.setCreator("Public Administrative Services Portal");

    // pdf-lib's internal `updateInfoDict` (called during save()) unconditionally
    // overwrites Producer with "pdf-lib (https://github.com/Hopding/pdf-lib)"
    // and may overwrite ModificationDate. Override the instance method so the
    // values we just set survive the save round-trip (Requirement 3.5).
    if (typeof pdfDoc.updateInfoDict === "function") {
        const originalUpdate = pdfDoc.updateInfoDict.bind(pdfDoc);
        pdfDoc.updateInfoDict = function preserveProducer() {
            try {
                originalUpdate();
            } catch (_) {
                // If the original implementation fails for any reason, we
                // still want our Producer/Creator to take effect — fall
                // through and re-apply our values.
            }
            pdfDoc.setProducer("Falcon Digital Signature System");
            pdfDoc.setCreator("Public Administrative Services Portal");
        };
    }
};

const validateMetadataShape = (metadata) => {
    if (metadata === null || typeof metadata !== "object") {
        throw new PdfEmbedderError(
            "PDF_EMBED_FAILED",
            "metadata must be an object with document_id, verify_url, algorithm, key_id, issued_at"
        );
    }
};

/**
 * Embed a QR code (and the signature metadata box) into the LAST page of the
 * supplied PDF, set the document info fields, and return the resulting bytes
 * as a Node `Buffer`.
 *
 * @param {Object} input
 * @param {Uint8Array|Buffer|ArrayBuffer} input.pdfBytes
 *        Raw bytes of the source PDF.
 * @param {string} input.qrImagePath
 *        Absolute path to the QR PNG to embed.
 * @param {Object} input.metadata
 *        `{document_id, verify_url, algorithm, key_id, issued_at}`. All five
 *        fields are required; missing values are rendered as empty strings.
 * @returns {Promise<Buffer>} The modified PDF as a Node Buffer.
 * @throws {PdfEmbedderError}
 */
export const embedQRAndMetadata = async ({
    pdfBytes,
    qrImagePath,
    metadata
} = {}) => {
    if (!pdfBytes) {
        throw new PdfEmbedderError(
            "INVALID_PDF",
            "pdfBytes is required"
        );
    }
    if (typeof qrImagePath !== "string" || qrImagePath.length === 0) {
        throw new PdfEmbedderError(
            "STORAGE_OPERATION_FAILED",
            "qrImagePath must be a non-empty string"
        );
    }
    validateMetadataShape(metadata);

    let qrImageBytes;
    try {
        qrImageBytes = fs.readFileSync(qrImagePath);
    } catch (err) {
        throw new PdfEmbedderError(
            "STORAGE_OPERATION_FAILED",
            `Failed to read QR image at ${qrImagePath}`,
            { cause: err }
        );
    }

    const pdfDoc = await loadPdfDocument(pdfBytes);

    let qrImage;
    let helvetica;
    try {
        qrImage = await pdfDoc.embedPng(qrImageBytes);
        helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    } catch (err) {
        throw new PdfEmbedderError(
            "PDF_EMBED_FAILED",
            "pdf-lib failed to embed QR image or Helvetica font",
            { cause: err }
        );
    }

    let savedBytes;
    try {
        const lastPage = drawQrOnLastPage(pdfDoc, qrImage);
        drawMetadataBox(lastPage, helvetica, metadata);
        applyDocumentInfo(pdfDoc, metadata);
        savedBytes = await pdfDoc.save();
    } catch (err) {
        if (err instanceof PdfEmbedderError) {
            throw err;
        }
        throw new PdfEmbedderError(
            "PDF_EMBED_FAILED",
            "pdf-lib failed during draw/save",
            { cause: err }
        );
    }

    return Buffer.from(savedBytes);
};

/**
 * QR-only variant used by the legacy `embedQrIntoPdf` adapter when the caller
 * does not supply metadata. The QR is still placed on the LAST page.
 *
 * @param {Object} input
 * @param {Uint8Array|Buffer|ArrayBuffer} input.pdfBytes
 * @param {string} input.qrImagePath
 * @returns {Promise<Buffer>}
 * @throws {PdfEmbedderError}
 */
const embedQrOnly = async ({ pdfBytes, qrImagePath }) => {
    if (!pdfBytes) {
        throw new PdfEmbedderError(
            "INVALID_PDF",
            "pdfBytes is required"
        );
    }
    if (typeof qrImagePath !== "string" || qrImagePath.length === 0) {
        throw new PdfEmbedderError(
            "STORAGE_OPERATION_FAILED",
            "qrImagePath must be a non-empty string"
        );
    }

    let qrImageBytes;
    try {
        qrImageBytes = fs.readFileSync(qrImagePath);
    } catch (err) {
        throw new PdfEmbedderError(
            "STORAGE_OPERATION_FAILED",
            `Failed to read QR image at ${qrImagePath}`,
            { cause: err }
        );
    }

    const pdfDoc = await loadPdfDocument(pdfBytes);

    let qrImage;
    try {
        qrImage = await pdfDoc.embedPng(qrImageBytes);
    } catch (err) {
        throw new PdfEmbedderError(
            "PDF_EMBED_FAILED",
            "pdf-lib failed to embed QR image",
            { cause: err }
        );
    }

    let savedBytes;
    try {
        drawQrOnLastPage(pdfDoc, qrImage);
        savedBytes = await pdfDoc.save();
    } catch (err) {
        if (err instanceof PdfEmbedderError) {
            throw err;
        }
        throw new PdfEmbedderError(
            "PDF_EMBED_FAILED",
            "pdf-lib failed during draw/save",
            { cause: err }
        );
    }

    return Buffer.from(savedBytes);
};

/**
 * Lightweight structural validation: try to parse the bytes as a PDF and
 * return whether the parse succeeded.
 *
 * @param {Uint8Array|Buffer|ArrayBuffer} pdfBytes
 * @returns {Promise<boolean>}
 */
export const validatePDF = async (pdfBytes) => {
    try {
        await PDFDocument.load(pdfBytes);
        return true;
    } catch (_err) {
        return false;
    }
};

/**
 * Backwards-compatible adapter consumed by `document.service1.js`. Reads the
 * source PDF from disk, embeds the QR (and optional metadata box) into the
 * LAST page, and writes the result to `outputFilePath`.
 *
 * When `metadata` is omitted (current production call shape), only the QR is
 * drawn — no metadata box, no PDF info mutation. When `metadata` is provided,
 * this delegates to {@link embedQRAndMetadata}.
 *
 * In either case, on any failure during the write step the partial output
 * file is removed before the error is re-thrown.
 *
 * @param {Object} input
 * @param {string} input.sourceFilePath
 * @param {string} input.qrPath
 * @param {string} input.outputFilePath
 * @param {Object} [input.metadata] Optional `{document_id, verify_url, algorithm, key_id, issued_at}`.
 * @returns {Promise<string>} The `outputFilePath` that was written.
 * @throws {PdfEmbedderError}
 */
export const embedQrIntoPdf = async ({
    sourceFilePath,
    qrPath,
    outputFilePath,
    metadata
} = {}) => {
    if (typeof sourceFilePath !== "string" || sourceFilePath.length === 0) {
        throw new PdfEmbedderError(
            "STORAGE_OPERATION_FAILED",
            "sourceFilePath must be a non-empty string"
        );
    }
    if (typeof outputFilePath !== "string" || outputFilePath.length === 0) {
        throw new PdfEmbedderError(
            "STORAGE_OPERATION_FAILED",
            "outputFilePath must be a non-empty string"
        );
    }

    let sourceBytes;
    try {
        sourceBytes = fs.readFileSync(sourceFilePath);
    } catch (err) {
        throw new PdfEmbedderError(
            "STORAGE_OPERATION_FAILED",
            `Failed to read source PDF at ${sourceFilePath}`,
            { cause: err }
        );
    }

    const outBuffer = metadata
        ? await embedQRAndMetadata({
            pdfBytes: sourceBytes,
            qrImagePath: qrPath,
            metadata
        })
        : await embedQrOnly({
            pdfBytes: sourceBytes,
            qrImagePath: qrPath
        });

    try {
        fs.writeFileSync(outputFilePath, outBuffer);
    } catch (err) {
        removePartialFile(outputFilePath);
        throw new PdfEmbedderError(
            "STORAGE_OPERATION_FAILED",
            `Failed to write signed PDF to ${outputFilePath}`,
            { cause: err }
        );
    }

    return outputFilePath;
};
