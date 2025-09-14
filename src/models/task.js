import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const taskSchema = new mongoose.Schema({
	id: {
		type: String,
		default: uuidv4,
		unique: true
	},
	user_id: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true
	},
	title: {
		type: String,
		required: true
	},
	description: {
		type: String
	},
	due_date: {
		type: Date
	},
	status: {
		type: String,
		enum: ["pending", "done"],
		default: "pending"
	},
	repeat: {
		enabled: { type: Boolean, default: false },
		frequency: { type: String, enum: ["daily","weekly","monthly"], default: undefined },
		interval: { type: Number, min: 1, default: 1 },
		days_of_week: { type: [Number] }, // weekly: 0=Sun..6=Sat (UTC)
		day_of_month: { type: Number, min: 1, max: 31 }, // monthly
		hour: { type: Number, min: 0, max: 23 },
		minute: { type: Number, min: 0, max: 59 },
		next_run_at: { type: Date }
	}
}, { timestamps: true });

export default mongoose.model("Task", taskSchema);
