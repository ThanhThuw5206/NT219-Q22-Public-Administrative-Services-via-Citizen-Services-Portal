import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../data");
const dataFilePath = path.join(dataDirectory, "documents.json");

const readDocuments = () => {
    fs.mkdirSync(dataDirectory, { recursive: true });

    if (!fs.existsSync(dataFilePath)) {
        return [];
    }

    return JSON.parse(fs.readFileSync(dataFilePath, "utf8"));
};

const writeDocuments = (documents) => {
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(dataFilePath, JSON.stringify(documents, null, 2));
};

export const saveDocument = (document) => {
    const documents = readDocuments();
    documents.push(document);
    writeDocuments(documents);
    return document;
};

export const findDocumentById = (documentId) => {
    return readDocuments().find((document) => document.document_id === documentId) || null;
};

export const listDocuments = () => readDocuments();
