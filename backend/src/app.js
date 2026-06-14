import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";

const app = express();

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://esm.sh"],  // esm.sh for client-side Falcon-512
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "https://esm.sh"],  // esm.sh for dynamic imports
            frameSrc: ["'self'", "blob:"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
        }
    },
    crossOriginEmbedderPolicy: false // Allow embedding
}));

app.use(express.json());
app.use(cookieParser());

export default app;