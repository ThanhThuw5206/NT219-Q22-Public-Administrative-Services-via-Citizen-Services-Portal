import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const dataDirectory = path.resolve(
    __dirname,
    "../data"
);

const dataFilePath = path.join(
    dataDirectory,
    "previews.json"
);

const readPreviews = () => {

    fs.mkdirSync(dataDirectory, {
        recursive: true
    });

    if (!fs.existsSync(dataFilePath)) {
        return [];
    }

    return JSON.parse(
        fs.readFileSync(
            dataFilePath,
            "utf8"
        )
    );

};

const writePreviews = (previews) => {

    fs.mkdirSync(dataDirectory, {
        recursive: true
    });

    fs.writeFileSync(
        dataFilePath,
        JSON.stringify(previews, null, 2)
    );

};

export const savePreview = async (
    preview
) => {

    const previews = readPreviews();

    previews.push(preview);

    writePreviews(previews);

    return preview;

};

export const findPreviewById = async (
    previewId
) => {

    return (
        readPreviews().find(
            (preview) =>
                preview.preview_id === previewId
        ) || null
    );

};