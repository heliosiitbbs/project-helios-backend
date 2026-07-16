import "dotenv/config";

import express from "express";
import { runHealthChecks } from "./utils/Healthcheck.js";
import busRoutes from "./routes/busRoutes.js";
import webRoutes from "./routes/webRoutes.js";
import emergencyRoutes from "./routes/emergencyRoutes.js";
import likeRoutes from "./routes/likeRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
const app = express();
app.use(express.json());

await runHealthChecks();



app.use("/api/bus", busRoutes);
app.use("/api/websites", webRoutes);
app.use("/api/emergency",emergencyRoutes);
app.use("/api/posts", likeRoutes);
app.use("/api/posts", commentRoutes);
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
