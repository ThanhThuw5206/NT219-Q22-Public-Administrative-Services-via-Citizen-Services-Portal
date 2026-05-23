import mysql from "mysql2";

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "121806",
    database: "document_verification"
});

db.connect((err) => {
    if (err) {
        console.log("DB connection error", err);
    } else {
        console.log("MySQL Connected");
    }
});

export default db;