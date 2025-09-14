import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";

import userRoutes from "./internal/user/routes.js";
import authRoutes from "./internal/auth/routes.js";
import friendRoutes from "./internal/friend/routes.js";

dotenv.config();
const app = express();

app.get("/test", (req, res) => {
  res.send("Test route works!");
});
app.use(cors());
app.use(express.json());

connectDB();

// Routes
app.get("/api/ping", (req, res) => {
  res.json({ message: "pong" });
});

app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/friend", friendRoutes);

app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  res.status(err.status || 500).json({ message: err.message });
});
export default app;
