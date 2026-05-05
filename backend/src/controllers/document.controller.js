import multer from "multer";
import { processDocument } from "../services/document.service.js";

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "src/uploads/");
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage }).single("file");

export const uploadDocument = (req, res) => {
    upload(req, res, function (err) {
        if (err) {
            return res.status(500).json({ message: "Upload error" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        // gọi service xử lý
        const result = processDocument(req.file.path);
        res.json({
            message: "Upload OK",
            file: req.file.path,
            documentInfo: result
        });
    });
};