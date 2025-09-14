import express from "express";
import { createAIResponse, chatAgent } from "./controller.js";

const router = express.Router();

router.post("/chat", createAIResponse);
router.post("/agent", chatAgent);

export default router;
