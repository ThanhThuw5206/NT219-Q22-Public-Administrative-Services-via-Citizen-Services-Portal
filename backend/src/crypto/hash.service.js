import fs from "fs";
import crypto from "crypto";

export const sha256File = (filePath) => {
    const fileBuffer = fs.readFileSync(filePath);

    return crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");
};

export const sha256Text = (value) => {
    return crypto
        .createHash("sha256")
        .update(value, "utf8")
        .digest("hex");
};
