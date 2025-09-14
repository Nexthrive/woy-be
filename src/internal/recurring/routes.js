import express from "express";
import mongoose from "mongoose";
import { createRecurring, listRecurring, disableRecurring } from "./service.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { user_id, title, description, hour, minute, days_of_week, start_date, end_date } = req.body;
    if (!mongoose.Types.ObjectId.isValid(user_id)) return res.status(400).json({ error: "invalid user_id" });
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: "title required" });
    if (typeof hour !== 'number' || typeof minute !== 'number') return res.status(400).json({ error: "hour and minute required" });
    const doc = await createRecurring({ user_id, title: title.trim(), description, hour, minute, days_of_week: days_of_week || undefined, start_date, end_date });
    res.json({ message: "Recurring created", data: doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/", async (req, res) => {
  try {
    const { user_id } = req.query;
    const filter = user_id ? { user_id } : {};
    const list = await listRecurring(filter);
    res.json({ data: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/:id/disable", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await disableRecurring(id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Recurring disabled", data: doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
