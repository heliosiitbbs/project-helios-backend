import express from "express";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend is running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});