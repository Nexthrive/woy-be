import express from "express";
import * as friendController from "./controller.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

router.post("/send", auth, friendController.sendFriendRequest);
router.post("/accept", auth, friendController.acceptFriendRequest);

export default router;
