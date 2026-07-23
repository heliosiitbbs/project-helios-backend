import "dotenv/config";

import express from "express";
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
const app = express();
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running safely on port ${PORT}`);
});
