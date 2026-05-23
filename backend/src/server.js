import "dotenv/config";
import express from "express";
import cors from "cors";
import documentRoutes from "./routes/document.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/documents", documentRoutes);

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});