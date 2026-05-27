import "dotenv/config";

import express from "express";
import { runHealthChecks } from "./utils/Healthcheck.js";
import authRoutes from "./routes/authRoutes.js";
import menuRoutes from "./routes/menuRoutes.js";
const app = express();
app.use(express.json());

await runHealthChecks();



app.use("/api/auth", authRoutes);
app.use("/api/menu", menuRoutes);
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});