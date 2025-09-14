import express from "express";
import * as authController from "./controller.js";

const router = express.Router();

router.post("/", authController.login);
router.post("/register", authController.register);

export default router;
