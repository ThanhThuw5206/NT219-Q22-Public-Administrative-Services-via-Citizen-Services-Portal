import fs from "fs";
import path from "path";

const STORAGE_ROOT = "src/storage";

export const ensureStorageFolders = () => {

    if (!fs.existsSync(STORAGE_ROOT)) {
        fs.mkdirSync(STORAGE_ROOT, {
            recursive: true
        });
    }

};

export const createDocumentFolder = (documentId) => {

    const documentFolder = path.join(
        STORAGE_ROOT,
        documentId
    );

    if (!fs.existsSync(documentFolder)) {
        fs.mkdirSync(documentFolder, {
            recursive: true
        });
    }

    return documentFolder;
};