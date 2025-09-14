import app from "./app.js";
import { tickRecurring } from "./internal/recurring/service.js";
import { tickTaskRepeats } from "./internal/task/repeat.js";

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
	// simple scheduler: tick every minute
	setInterval(async () => {
		try { await tickRecurring(); } catch {}
		try { await tickTaskRepeats(); } catch {}
	}, 60 * 1000);
});
