import "dotenv/config";

import express from "express";
import { runHealthChecks } from "./utils/Healthcheck.js";
import authRoutes from "./routes/authRoutes.js";
import menuRoutes from "./routes/menuRoutes.js";
import subjectRoutes from "./routes/subjectRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import busRoutes from "./routes/busRoutes.js";
import emergencyRoutes from "./routes/emergencyRoutes.js";
const app = express();
app.use(express.json());

await runHealthChecks();



app.use("/api/auth", authRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/user", userRoutes);
app.use("/api/bus", busRoutes);
app.use("/api/emergency",emergencyRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});