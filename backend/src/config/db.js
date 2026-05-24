import mysql from "mysql2";

const db = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "document_verification"
});

db.connect((err) => {
    if (err) {
        console.log("DB connection error", err);
    } else {
        console.log("MySQL Connected");
    }
});

export default db;
