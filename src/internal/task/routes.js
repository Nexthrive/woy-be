import express from "express";
import {
  createTaskController,
  getTasksController,
  getTaskByIdController,
  updateTaskController,
  deleteTaskController
} from "./controller.js";

const router = express.Router();

router.post("/", createTaskController);
router.get("/", getTasksController);
router.get("/:id", getTaskByIdController);
router.put("/:id", updateTaskController);
router.delete("/:id", deleteTaskController);

export default router;
