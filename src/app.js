import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import { initializeClient, sendMessage, sendMedia, sendReadReceipt, sendTypingStatus, markAsUnread, getAllGroups } from "./internal/whatsappwebjs/whatsapp.js";

import userRoutes from "./internal/user/routes.js";
import aiRoutes from "./internal/ai/routes.js";

dotenv.config();
const app = express();

// Initialize WhatsApp Client
initializeClient();

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

app.post("/api/whatsapp/send-message", async (req, res) => {
  const { chatId, message } = req.body;
  const result = await sendMessage(chatId, message);
  res.json(result);
});

app.post("/api/whatsapp/send-media", async (req, res) => {
  const { chatId, media, caption } = req.body;
  const result = await sendMedia(chatId, media, caption);
  res.json(result);
});

app.post("/api/whatsapp/send-read-receipt", async (req, res) => {
  const { chatId, messageIds } = req.body;
  const result = await sendReadReceipt(chatId, messageIds);
  res.json(result);
});

app.post("/api/whatsapp/send-typing-status", async (req, res) => {
  const { chatId } = req.body;
  const result = await sendTypingStatus(chatId);
  res.json(result);
});

app.post("/api/whatsapp/mark-as-unread", async (req, res) => {
  const { message } = req.body;
  const result = await markAsUnread(message);
  res.json(result);
});

app.get("/api/whatsapp/getGroups", async (req, res) => {
  const result = await getAllGroups();
  res.json(result);
});



app.use("/api/users", userRoutes);
app.use("/api/ai", aiRoutes);
app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  res.status(err.status || 500).json({ message: err.message });
});
export default app;
