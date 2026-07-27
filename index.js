import "dotenv/config";

// Node terminates the process on an unhandled rejection by default (since v15) -
// without these, a stray async error anywhere would silently kill the server
// with no indication of what happened.
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
});

import express from "express";
import cors from "cors";
import { runHealthChecks } from "./utils/Healthcheck.js";
import authRoutes from "./routes/authRoutes.js";
import menuRoutes from "./routes/menuRoutes.js";
import busRoutes from "./routes/busRoutes.js";
import webRoutes from "./routes/webRoutes.js";
import emergencyRoutes from "./routes/emergencyRoutes.js";
import likeRoutes from "./routes/likeRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
import lostFoundRoutes from "./routes/lostFoundRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";  
import grievanceRoutes from "./routes/grievanceRoutes.js";
import subjectRoutes from "./routes/subjectRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import foodStallRoutes from "./routes/foodStallRoutes.js";
import newsRoutes from "./routes/newsRoutes.js";
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        // Native mobile clients (Expo/React Native fetch) don't send an Origin header
        if (!origin) return callback(null, true);

        if (process.env.NODE_ENV !== "production") return callback(null, true);

        if (allowedOrigins.includes(origin)) return callback(null, true);

        return callback(new Error("Not allowed by CORS"));
    }
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

await runHealthChecks();



app.use("/api/auth", authRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/web", webRoutes);
app.use("/api/like", likeRoutes);
app.use("/api/comment", commentRoutes);
app.use("/api/lost-found",lostFoundRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/grievances", grievanceRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/bus", busRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/food-stalls", foodStallRoutes);
app.use("/api/news", newsRoutes);

app.use((err, req, res, next) => {
    console.error(err);

    if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
            success: false,
            message: "File too large"
        });
    }

    return res.status(err.status || 500).json({
        success: false,
        message: err.publicMessage || "Server Error"
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running safely on port ${PORT}`);
});
