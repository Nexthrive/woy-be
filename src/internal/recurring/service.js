import RecurringTask from "../../models/recurringTask.js";
import { createTask } from "../task/service.js";

export async function createRecurring(data) {
  if (!Array.isArray(data.days_of_week) || data.days_of_week.length === 0) {
    data.days_of_week = [0,1,2,3,4,5,6];
  }
  const now = new Date();
  const next = RecurringTask.computeNextRun(now, data.days_of_week, data.hour, data.minute);
  const doc = new RecurringTask({ ...data, next_run_at: next });
  return await doc.save();
}

export async function listRecurring(filter = {}) {
  return await RecurringTask.find(filter).sort({ next_run_at: 1 });
}

export async function disableRecurring(id) {
  return await RecurringTask.findOneAndUpdate({ id }, { enabled: false }, { new: true });
}

export async function tickRecurring(now = new Date()) {
  const due = await RecurringTask.find({ enabled: true, next_run_at: { $lte: now } });
  const results = [];
  for (const r of due) {
    try {
      const dueAt = new Date(now);
      results.push(await createTask({
        user_id: r.user_id,
        title: r.title,
        description: r.description,
        due_date: dueAt,
        status: "pending"
      }));
      // compute next
      const next = RecurringTask.computeNextRun(new Date(now.getTime() + 1000), r.days_of_week, r.hour, r.minute);
      r.next_run_at = next;
      await r.save();
    } catch (e) {
      // continue processing others
    }
  }
  return results;
}
