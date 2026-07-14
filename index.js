import "dotenv/config";

import express from "express";
import { runHealthChecks } from "./utils/Healthcheck.js";
import authRoutes from "./routes/authRoutes.js";
import menuRoutes from "./routes/menuRoutes.js";
import lostFoundRoutes
  from "./routes/lostFoundRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import grievanceRoutes from "./routes/grievanceRoutes.js";
const app = express();
app.use(express.json());

await runHealthChecks();



app.use("/api/auth", authRoutes);
app.use("/api/menu", menuRoutes);
app.use(
"/api/lost-found",
lostFoundRoutes
);
app.use("/api/events", eventRoutes);
app.use("/api/grievances", grievanceRoutes);
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running safely on port ${PORT}`);
});