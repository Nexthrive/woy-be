import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const RecurringTaskSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  description: { type: String },
  hour: { type: Number, required: true, min: 0, max: 23 },
  minute: { type: Number, required: true, min: 0, max: 59 },
  days_of_week: { type: [Number], default: [0,1,2,3,4,5,6] }, // 0=Sun..6=Sat (UTC)
  start_date: { type: Date, default: () => new Date() },
  end_date: { type: Date },
  next_run_at: { type: Date, required: true },
  enabled: { type: Boolean, default: true }
}, { timestamps: true });

function computeNextRun(fromDate, daysOfWeek, hour, minute) {
  const setHM = (d) => { d.setUTCHours(hour, minute, 0, 0); return d; };
  const now = new Date(fromDate);
  // Start at today
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + i);
    const dow = d.getUTCDay();
    if (daysOfWeek.includes(dow)) {
      const candidate = setHM(new Date(d));
      if (candidate.getTime() >= now.getTime()) return candidate;
    }
  }
  // Fallback one week ahead
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 7);
  return setHM(d);
}

RecurringTaskSchema.statics.computeNextRun = computeNextRun;

const RecurringTask = mongoose.model("RecurringTask", RecurringTaskSchema);
export default RecurringTask;
