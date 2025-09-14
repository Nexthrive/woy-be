import Task from "../../models/task.js";
import { createTask } from "./service.js";

export function computeNextRunForRepeat(fromDate, repeat) {
  if (!repeat || !repeat.enabled) return undefined;
  const now = new Date(fromDate);
  const hour = Number(repeat.hour ?? 9);
  const minute = Number(repeat.minute ?? 0);
  const freq = repeat.frequency || "daily";
  const interval = Math.max(1, Number(repeat.interval || 1));

  const setHM = (d) => { d.setUTCHours(hour, minute, 0, 0); return d; };

  if (freq === "daily") {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let candidate = setHM(new Date(base));
    if (candidate.getTime() < now.getTime()) {
      candidate.setUTCDate(candidate.getUTCDate() + interval);
    }
    return candidate;
  }

  if (freq === "weekly") {
    const days = Array.isArray(repeat.days_of_week) && repeat.days_of_week.length > 0 ? repeat.days_of_week : [now.getUTCDay()];
    for (let i = 0; i <= 7 * interval; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      d.setUTCDate(d.getUTCDate() + i);
      if (days.includes(d.getUTCDay())) {
        const candidate = setHM(new Date(d));
        if (candidate.getTime() >= now.getTime()) return candidate;
      }
    }
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 7 * interval);
    return setHM(d);
  }

  if (freq === "monthly") {
    const dom = Math.min(31, Math.max(1, Number(repeat.day_of_month || now.getUTCDate())));
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const daysIn = (yy, mm) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const clamped = Math.min(dom, daysIn(y, m));
    let candidate = setHM(new Date(Date.UTC(y, m, clamped)));
    if (candidate.getTime() < now.getTime()) {
      const ym = new Date(Date.UTC(y, m, 1));
      ym.setUTCMonth(ym.getUTCMonth() + interval);
      const y2 = ym.getUTCFullYear();
      const m2 = ym.getUTCMonth();
      const clamped2 = Math.min(dom, daysIn(y2, m2));
      candidate = setHM(new Date(Date.UTC(y2, m2, clamped2)));
    }
    return candidate;
  }

  return undefined;
}

export async function tickTaskRepeats(now = new Date()) {
  // initialize schedules missing next_run_at
  const needsInit = await Task.find({ "repeat.enabled": true, $or: [ { "repeat.next_run_at": { $exists: false } }, { "repeat.next_run_at": null } ] });
  for (const t of needsInit) {
    try {
      const next = computeNextRunForRepeat(now, t.repeat);
      t.repeat.next_run_at = next;
      // optional: align task's own due_date to next_run_at for visibility
      t.due_date = next;
      await t.save();
    } catch (e) {
      // ignore individual init failures
    }
  }

  const due = await Task.find({ "repeat.enabled": true, "repeat.next_run_at": { $lte: now } });
  const results = [];
  for (const t of due) {
    try {
      // create an instance task (one-off)
      const inst = await createTask({
        user_id: t.user_id,
        title: t.title,
        description: t.description,
        due_date: t.repeat.next_run_at || now,
        status: "pending"
      });
      results.push(inst);
      // schedule next
      const next = computeNextRunForRepeat(new Date(now.getTime() + 1000), t.repeat);
      t.repeat.next_run_at = next;
      // optionally reflect next due on template task
      t.due_date = next;
      await t.save();
    } catch (e) {
      // continue others
    }
  }
  return results;
}
