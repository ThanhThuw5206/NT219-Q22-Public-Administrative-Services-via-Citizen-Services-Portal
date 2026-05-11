import multer from "multer";
import fs from "fs";
import { processDocument } from "../services/document.service.js";

// đảm bảo folder tồn tại
const uploadFolder = "src/uploads/";

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
}

// cấu hình storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadFolder);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
}).single("file");

export const uploadDocument = (req, res) => {

    upload(req, res, (err) => {

        try {

            if (err) {
                return res.status(500).json({
                    message: "Upload error",
                    error: err.message
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    message: "No file uploaded"
                });
            }

            const result = processDocument(req.file.path);

            return res.status(200).json({
                message: "Upload success",
                data: {
                    file_name: req.file.filename,
                    file_path: req.file.path,
                    document: result
                }
            });

        } catch (error) {
            return res.status(500).json({
                message: "Server error",
                error: error.message
            });
        }

    });
};