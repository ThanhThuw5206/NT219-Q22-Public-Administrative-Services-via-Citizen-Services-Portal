import express from "express";
import cors from "cors";

import documentRoutes from "./routes/document.routes.js";

const app = express();

app.use(cors());
app.use(express.json());


export default app;