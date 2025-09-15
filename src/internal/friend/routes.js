import express from "express";
import * as friendController from "./controller.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

// Friend request routes (require authentication)
router.post("/send", auth, friendController.sendFriendRequest);
router.post("/accept", auth, friendController.acceptFriendRequest);
router.delete("/remove", auth, friendController.removeFriend);

// Friends list and leaderboard routes
router.get("/list", auth, friendController.getFriendsList);
router.get("/leaderboard", auth, friendController.getLeaderboard);

export default router;
