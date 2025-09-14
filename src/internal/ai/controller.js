import OpenAI from "openai";
import mongoose from "mongoose";
import { createTask, updateTask, deleteTask, getTaskById } from "../task/service.js";
import { getUserById } from "../user/service.js";
import { createRecurring } from "../recurring/service.js";
import { computeNextRunForRepeat } from "../task/repeat.js";

// Simple in-memory store for optional conversation history (future use)
// Keyed by session_id if provided, otherwise by user_id
const sessionMessages = new Map();
// Holds last proposed task per session for quick confirmation
const sessionProposals = new Map();

const DEFAULT_MODEL = process.env.GITHUB_MODELS_MODEL || "gpt-4o-mini";

// Simple in-memory rate limiter per key (e.g., userId:model)
const RATE_LIMIT = { max: 2, windowMs: 60_000 };
const rateBuckets = new Map(); // key -> number[] (timestamps)
function checkRateLimit(key) {
  const now = Date.now();
  const arr = rateBuckets.get(key) || [];
  const kept = arr.filter(ts => now - ts < RATE_LIMIT.windowMs);
  if (kept.length >= RATE_LIMIT.max) {
    const oldest = Math.min(...kept);
    const waitMs = RATE_LIMIT.windowMs - (now - oldest);
    rateBuckets.set(key, kept);
    return { ok: false, retryAfterSec: Math.ceil(waitMs / 1000) };
  }
  kept.push(now);
  rateBuckets.set(key, kept);
  return { ok: true };
}

function parseRetryAfterSecondsFromError(err) {
  // Try headers first (if available), then parse message text
  const retryHeader = err?.response?.headers?.["retry-after"] || err?.response?.headers?.["Retry-After"];
  if (retryHeader) {
    const n = parseInt(String(retryHeader), 10);
    if (!Number.isNaN(n)) return n;
  }
  const msg = String(err?.message || "");
  const m = msg.match(/wait\s+(\d+)\s*seconds?/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callWithRetries(makeCall, { maxRetries = 1, hardMaxWaitSec = 8 } = {}) {
  // maxRetries=1 means 1 retry (2 attempts total)
  let attempt = 0;
  while (true) {
    try {
      return await makeCall();
    } catch (err) {
      const status = err?.status || err?.statusCode;
      const is429 = status === 429 || /rate\s*limit/i.test(String(err?.message || ""));
      if (!is429 || attempt >= maxRetries) throw err;
      const retrySec = parseRetryAfterSecondsFromError(err);
      if (retrySec && retrySec > hardMaxWaitSec) throw err;
      const waitMs = (retrySec ? retrySec : (2 ** attempt)) * 1000;
      await sleep(Math.min(waitMs, hardMaxWaitSec * 1000));
      attempt++;
      continue;
    }
  }
}

function parseFallbackModels(primary) {
  const raw = process.env.GITHUB_MODELS_FALLBACK_MODELS || "";
  const arr = raw.split(",").map(s => s.trim()).filter(Boolean);
  return arr.filter(m => m && m !== primary);
}

async function tryCompletionWithFallbacks(client, baseOpts, primaryModel, { temperature, rateKeyPrefix, langToUse }) {
  const models = [primaryModel, ...parseFallbackModels(primaryModel)];
  let lastErr = null;
  for (const m of models) {
    // Rate-limit per model
    const rate = checkRateLimit(`${rateKeyPrefix}:${m}`);
    if (!rate.ok) {
      lastErr = Object.assign(new Error(`Local rate limit for model ${m}`), { status: 429 });
      continue;
    }
    const opts = { ...baseOpts, model: m };
    // Only set temperature for non-nano models
    if (!String(m).includes("gpt-5-nano") && typeof temperature === "number") {
      opts.temperature = temperature;
    } else {
      delete opts.temperature;
    }
    try {
      const result = await callWithRetries(() => client.chat.completions.create(opts), { maxRetries: 1 });
      return { result, modelUsed: m };
    } catch (err) {
      const status = err?.status || err?.statusCode;
      if (status === 429) {
        lastErr = err;
        continue; // try next model
      }
      throw err; // non-429, bubble up
    }
  }
  throw lastErr || new Error("All models failed");
}

function i18n(lang = 'en') {
  const isId = String(lang || '').toLowerCase().startsWith('id');
  return {
    ask: {
      title: isId ? "Judul tugasnya apa?" : "What's the task title?",
      description: isId ? "Bisa beri deskripsi singkat?" : "Could you provide a short description?",
      due_date: isId ? "Tanggal/waktu deadlinenya kapan (ISO, mis. 2025-09-16T09:00:00Z, atau 'dalam 3 hari')?" : "What's the due date/time (ISO, e.g., 2025-09-16T09:00:00Z, or say 'in 3 days')?",
      // We won't proactively ask status; default is pending if not mentioned
      status: isId ? "(Status akan diset 'pending' jika tidak disebutkan)" : "(Status defaults to 'pending' if not mentioned)"
    },
    confirmDay: (hh, mm) => isId ? `Konfirmasi dulu, ini untuk hari ini jam ${hh}:${mm} UTC, atau hari apa?` : `Just to confirm, is this for today at ${hh}:${mm} UTC, or which day?` ,
    createdMessage: isId ? "Task berhasil dibuat" : "Task created",
    rateLimited: (sec) => isId ? `Kena rate limit (maks 2/menit per model). Coba lagi dalam ${sec} detik.` : `Rate limit hit (max 2/min per model). Try again in ${sec} seconds.`,
    errorTitleRequired: isId ? "title wajib diisi" : "title is required",
    errorTitleRequiredConfirm: isId ? "title wajib diisi untuk konfirmasi" : "title is required to confirm",
    noteInvalidDue: isId ? "due_date tidak valid; tidak bisa diparse." : "Ignored invalid due_date; could not parse.",
    notePastDue: isId ? "due_date di masa lalu; mohon beri tanggal di masa depan." : "Ignored past due_date; provide a future date.",
    systemManage: (nowIso) => isId
      ? `Kamu adalah asisten yang membantu mengelola task. Hari ini (UTC) ${nowIso}. Saat user minta membuat task, panggil tool create_task dengan field yang diekstrak. Selalu kembalikan due_date dalam format ISO 8601 UTC dan pilih tanggal MASA DEPAN. Buat judul singkat. Jika bukan tentang membuat task, balas biasa. Gunakan bahasa Indonesia.`
      : `You are an assistant that helps manage tasks. Today (UTC) is ${nowIso}. When the user asks to create a task, call the create_task tool with extracted fields. Always return due_date as an ISO 8601 UTC string and prefer FUTURE dates (do not invent past years). Keep titles concise. If not about creating a task, just reply naturally. Reply in English.`
  };
}

function detectLangFromText(text = "") {
  const t = String(text).toLowerCase();
  const idHints = ["gw", "gue", "gua", "lu", "lo", "jam", "besok", "pulang", "kampus", "macet", "siang", "pagi", "malam", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu", "rapat", "kelas", "ya", "boleh", "oke", "ok", "bikin", "buat", "sekarang", "aja"];
  const isId = idHints.some(w => t.includes(w));
  return isId ? "id" : "en";
}

function deriveTitleFromPrompt(text, lang = 'en') {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  const isId = String(lang || '').toLowerCase().startsWith('id');
  if (/(\bmeet\b|\bmeeting\b|\brapat\b|\bpertemuan\b)/.test(lower)) return isId ? "Rapat" : "Meeting";
  if (/\bkelas\b|\bclass\b/.test(lower)) return isId ? "Kelas" : "Class";
  if (/\bcall\b|\btelepon\b|\btelpon\b/.test(lower)) return isId ? "Telepon" : "Call";
  if (/\bemail\b/.test(lower)) return isId ? "Email" : "Email";
  if (/\breview\b|\btinjau\b/.test(lower)) return isId ? "Tinjau" : "Review";
  if (/\bdeploy\b|\brilis\b/.test(lower)) return isId ? "Rilis" : "Deploy";
  return undefined; // let model/user supply better title
}

function mentionsDayOrDate(text) {
  if (!text) return false;
  const pattern = /(today|tomorrow|besok|senin|selasa|rabu|kamis|jumat|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|january|february|march|april|may|june|july|august|september|october|november|december|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)/i;
  return pattern.test(text);
}

function parseRelativeDate(text, now) {
  const m = text.match(/\bin\s*(\d+)\s*(day|days|hari|hour|hours|jam|minute|minutes|menit)\b/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const d = new Date(now);
  if (unit.startsWith("day") || unit === "hari") d.setDate(d.getDate() + n);
  else if (unit.startsWith("hour") || unit === "jam") d.setHours(d.getHours() + n);
  else if (unit.startsWith("minute") || unit === "menit") d.setMinutes(d.getMinutes() + n);
  // default time at 09:00 for day-level if time not specified
  return d;
}

function parseTimeAt(text, now) {
  // English: 'at 2 pm', '14:30', '2pm', '2:30 pm'
  // Indonesian: 'jam 10', 'pukul 7', 'jam 5 sore', 'pukul 8 pagi'
  const timeRegex = /(?:(\bat\b|jam|pukul)\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|pagi|siang|sore|malam)?\b/i;
  const m = text.match(timeRegex);
  if (!m) return undefined;
  const prefix = m[1] ? m[1].toLowerCase() : undefined;
  let hour = parseInt(m[2], 10);
  const minute = m[3] ? parseInt(m[3], 10) : 0;
  const mer = m[4] ? m[4].toLowerCase() : undefined;
  if (!prefix && !m[3] && !mer) return undefined; // avoid matching bare numbers like 'Q4'
  if (mer) {
    if (mer === "pm" && hour < 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
    if (mer === "pagi") {
      if (hour === 12) hour = 8; // heuristic: 12 pagi ~ 08:00
      if (hour === 24) hour = 0;
    }
    if (mer === "siang" || mer === "sore" || mer === "malam") {
      if (hour < 12) hour += 12;
      if (mer === "malam" && hour === 24) hour = 0; // 12 malam ~ 00:00
    }
  }
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now.getTime()) {
    // if time today already passed, use tomorrow
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function parseTimeAtToday(text, now) {
  const timeRegex = /(?:(\bat\b|jam|pukul)\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|pagi|siang|sore|malam)?\b/i;
  const m = text.match(timeRegex);
  if (!m) return undefined;
  const prefix = m[1] ? m[1].toLowerCase() : undefined;
  let hour = parseInt(m[2], 10);
  const minute = m[3] ? parseInt(m[3], 10) : 0;
  const mer = m[4] ? m[4].toLowerCase() : undefined;
  if (!prefix && !m[3] && !mer) return undefined;
  if (mer) {
    if (mer === "pm" && hour < 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
    if (mer === "pagi") {
      if (hour === 12) hour = 8;
      if (hour === 24) hour = 0;
    }
    if (mer === "siang" || mer === "sore" || mer === "malam") {
      if (hour < 12) hour += 12;
      if (mer === "malam" && hour === 24) hour = 0;
    }
  }
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function extractNewTitle(text = "", lang = "id") {
  const t = String(text).trim();
  const isId = String(lang || '').toLowerCase().startsWith('id');
  // Quoted title first
  const quoted = t.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) return (quoted[1] || quoted[2]).trim();
  // Indonesian patterns: "judulnya ...", "judul ...", "ganti judul ..."
  const idMatch = t.match(/(?:judul(?:nya)?|title)\s*(?:jadi|ke|:)?\s*(.+)$/i);
  if (idMatch) {
    let candidate = idMatch[1].trim();
    candidate = candidate.replace(/\b(aja|saja|dong|deh|ya)\b/gi, '').trim();
    return candidate || undefined;
  }
  // English patterns: title to X, name to X
  const enMatch = t.match(/(?:title|name)\s*(?:to|as|=|:)\s*(.+)$/i);
  if (enMatch) return enMatch[1].trim();
  return undefined;
}

function parseKeywordDate(text, now) {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const d = new Date(now);
  if (/(today|hari ini)\b/.test(t)) return d;
  if (/(tomorrow|besok)\b/.test(t)) { d.setDate(d.getDate() + 1); return d; }
  return undefined;
}

function setTimeOnDate(baseDate, timeSource) {
  if (!baseDate || !timeSource) return undefined;
  const d = new Date(baseDate);
  if (isNaN(d.getTime())) return undefined;
  const t = new Date(timeSource);
  if (isNaN(t.getTime())) return undefined;
  d.setHours(t.getHours(), t.getMinutes(), 0, 0);
  return d;
}

function isConfirm(text = "", lang = "en") {
  const t = String(text).toLowerCase();
  // Indonesian confirmations
  const idYes = ["ya", "boleh", "oke", "ok", "lanjut", "buat sekarang", "bikin", "gas", "silakan", "jadiin", "iy", "iyaa", "yoi"];
  if (idYes.some(w => t.includes(w))) return true;
  const enYes = ["yes", "ok", "okay", "sure", "go ahead", "create now", "make it", "do it", "confirm"];
  return enYes.some(w => t.includes(w));
}

function extractStatusFromText(text = "") {
  const t = String(text).toLowerCase();
  if (/(done|selesai|tuntas|beres)/.test(t)) return "done";
  if (/pending/.test(t)) return "pending";
  return undefined;
}

async function classifyConfirmationWithModel(client, modelName, assistantMsg, userMsg, lang, maxTokens = 80) {
  try {
    const isId = String(lang || '').toLowerCase().startsWith('id');
    const sys = isId
      ? "Kamu adalah pengklasifikasi. Balas HANYA JSON seperti: {\"confirm\": true|false, \"status\": \"pending\"|\"done\"|null }. Tentukan apakah pesan user adalah konfirmasi untuk membuat tugas. Jika ada indikasi status (done/selesai), kembalikan status itu; jika tidak ada, gunakan null."
      : "You are a classifier. Reply ONLY JSON like: {\"confirm\": true|false, \"status\": \"pending\"|\"done\"|null }. Decide if the user's message confirms creating the task. If there is a status hint (done), return it; else null.";
    const messages = [
      { role: "system", content: sys },
      assistantMsg ? { role: "assistant", content: assistantMsg } : null,
      { role: "user", content: userMsg }
    ].filter(Boolean);
    const opts = { model: modelName, messages, max_completion_tokens: maxTokens };
    if (!String(modelName).includes("gpt-5-nano")) opts.temperature = 0;
    const result = await client.chat.completions.create(opts);
    const content = result.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const status = parsed.status === 'done' || parsed.status === 'pending' ? parsed.status : undefined;
    return { confirm: !!parsed.confirm, status };
  } catch {
    return null;
  }
}

export const createAIResponse = async (req, res) => {
  try {
    const { prompt, max_tokens, temperature, model, lang } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required (string)" });
    }

    const token = process.env.GITHUB_MODELS_TOKEN; // PAT with models scope
    if (!token) {
      return res.status(500).json({ error: "GITHUB_MODELS_TOKEN not configured" });
    }

    const client = new OpenAI({
      apiKey: token,
      baseURL: "https://models.github.ai/inference"
    });

    const modelName = model || DEFAULT_MODEL;
    const sys = lang ? (String(lang).toLowerCase().startsWith('id') ? "Jawab dalam bahasa Indonesia." : `Answer in ${lang}.`) : undefined;
    const messages = sys ? [ { role: "system", content: sys }, { role: "user", content: prompt } ] : [ { role: "user", content: prompt } ];
    const createOpts = {
      model: modelName,
      messages,
      max_completion_tokens: max_tokens ?? 256
    };
    if (!String(modelName).includes("gpt-5-nano") && typeof temperature === "number") {
      createOpts.temperature = temperature;
    }
    // Soft rate limit for chat endpoint using IP
    const rateKey = `${req.ip || 'anon'}:${modelName}`;
    const rate = checkRateLimit(rateKey);
    if (!rate.ok) {
      return res.status(429).json({ error: `Rate limit: max ${RATE_LIMIT.max}/min per model`, retry_after_seconds: rate.retryAfterSec });
    }

  const { result } = await tryCompletionWithFallbacks(client, createOpts, modelName, { temperature, rateKeyPrefix: req.ip || 'anon', langToUse: lang });

    const message = result.choices?.[0]?.message?.content ?? "";
    res.json({ message, raw: result });
  } catch (err) {
    console.error("GitHub Models error:", err);
    const status = err?.status || err?.statusCode;
    if (status === 429 || /rate\s*limit/i.test(String(err?.message || ""))) {
      const retrySec = parseRetryAfterSecondsFromError(err) ?? 60;
      return res.status(429).json({ error: `Rate limit hit. Try again in ${retrySec}s.`, retry_after_seconds: retrySec });
    }
    res.status(500).json({ error: err.message });
  }
};

export const chatAgent = async (req, res) => {
  try {
    const { prompt, user_id, model, temperature, max_tokens, confirm, draft, session_id, auto, lang } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required (string)" });
    }

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(user_id)) {
      return res.status(400).json({ error: "user_id is not a valid ObjectId" });
    }
    const user = await getUserById(user_id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const token = process.env.GITHUB_MODELS_TOKEN;
    if (!token) {
      return res.status(500).json({ error: "GITHUB_MODELS_TOKEN not configured" });
    }

    const client = new OpenAI({
      apiKey: token,
      baseURL: "https://models.github.ai/inference"
    });
    const modelName = model || DEFAULT_MODEL;

    // Soft per-user+model rate limiting to avoid 429s
    const sessionKey = session_id || String(user_id);
  const rateKey = `${sessionKey}`;
    const langToUse = lang || detectLangFromText(prompt);
    const L = i18n(langToUse);
    const rate = checkRateLimit(rateKey);
    if (!rate.ok) {
      return res.status(429).json({ error: L.rateLimited(rate.retryAfterSec) , retry_after_seconds: rate.retryAfterSec });
    }
    // Tool schema for function calling
    const tools = [
      {
        type: "function",
        function: {
          name: "create_task",
          description: "Create a task for the current user. Use when enough details are known.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short task title" },
              description: { type: "string", description: "Optional description" },
              due_date: { type: "string", description: "Due date/time in ISO 8601 (UTC). If user gives relative time or local time in Bahasa Indonesia, resolve to a concrete future UTC timestamp." },
              status: { type: "string", enum: ["pending", "done"], description: "Task status" },
              repeat: {
                type: "object",
                description: "Optional repeat schedule (in-document). If enabled, the system will create new tasks at scheduled times.",
                properties: {
                  enabled: { type: "boolean" },
                  frequency: { type: "string", enum: ["daily","weekly","monthly"], description: "Repeat frequency" },
                  interval: { type: "number", description: "Every N units (default 1)" },
                  days_of_week: { type: "array", items: { type: "number" }, description: "0=Sun..6=Sat (UTC). For weekly, choose the days. For daily, you can omit or include all." },
                  day_of_month: { type: "number", description: "For monthly repeats: 1-31 (clamped to month length)" },
                  hour: { type: "number" },
                  minute: { type: "number" }
                }
              }
            },
            required: ["title"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_task",
          description: "Update an existing task by its UUID id for the current user.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Task UUID (not Mongo _id)" },
              title: { type: "string" },
              description: { type: "string" },
              due_date: { type: "string", description: "New due date/time in ISO 8601 (UTC)" },
              status: { type: "string", enum: ["pending", "done"] }
            },
            required: ["id"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "delete_task",
          description: "Delete an existing task by its UUID id for the current user.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Task UUID (not Mongo _id)" }
            },
            required: ["id"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_recurring",
          description: "Create a recurring (habit) schedule for the current user (daily/weekly at a specific time UTC).",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              hour: { type: "number", description: "UTC hour 0-23" },
              minute: { type: "number", description: "UTC minute 0-59" },
              days_of_week: { type: "array", items: { type: "number" }, description: "0=Sun..6=Sat (UTC). For daily, include all 0-6." }
            },
            required: ["title", "hour", "minute"]
          }
        }
      }
    ];

  const nowIso = new Date().toISOString();

    // If user explicitly confirms after a previous proposal, create immediately
    if (!confirm) {
      const proposal = sessionProposals.get(sessionKey);
      // Try model-based confirmation first if we have a proposal
      if (proposal) {
        // Title-only adjustment
        const newTitle = extractNewTitle(prompt, langToUse);
        if (newTitle) {
          const updated = { ...proposal, title: newTitle };
          sessionProposals.set(sessionKey, updated);
          const askMsg = String(langToUse).toLowerCase().startsWith('id')
            ? `Sip, judulnya aku ganti. Jadi "${newTitle}" pada ${updated.due_date}. Mau aku buat?`
            : `Okay, I’ve updated the title. So "${newTitle}" at ${updated.due_date}. Create it now?`;
          return res.json({ requires_confirmation: true, assistant_message: askMsg });
        }
        // If the user only adjusts the time (e.g., "jam 3"), update proposal's time only
        const nowForTime = new Date();
        const newTimeOnly = parseTimeAtToday(prompt, nowForTime);
        if (newTimeOnly && proposal.due_date) {
          const baseDate = new Date(proposal.due_date);
          const adjusted = setTimeOnDate(baseDate, newTimeOnly);
          if (adjusted && !isNaN(adjusted.getTime())) {
            const when = adjusted.toISOString();
            const titleGuess = proposal.title || deriveTitleFromPrompt(prompt, langToUse) || (String(langToUse).toLowerCase().startsWith('id') ? "Tugas" : "Task");
            sessionProposals.set(sessionKey, { ...proposal, due_date: when });
            const askMsg = String(langToUse).toLowerCase().startsWith('id')
              ? `Sip, jamnya aku ganti. Jadi "${titleGuess}" pada ${when}. Mau aku buat?`
              : `Okay, I’ve adjusted the time. So "${titleGuess}" at ${when}. Create it now?`;
            return res.json({ requires_confirmation: true, assistant_message: askMsg });
          }
        }
        // Check rate before classifier call; if limited, skip to heuristic
        const rate2 = checkRateLimit(rateKey);
        let clf = null;
        if (rate2.ok) {
          try {
            clf = await callWithRetries(() => classifyConfirmationWithModel(client, modelName, proposal.assistant_message || "", prompt, langToUse, Math.min(120, max_tokens ?? 120)), { maxRetries: 1 });
          } catch (e) {
            clf = null;
          }
        }
        if (clf && clf.confirm) {
          const statusHint = clf.status || extractStatusFromText(prompt) || proposal.status || "pending";
          const payload = {
            title: String(proposal.title).trim(),
            description: proposal.description || undefined,
            status: ["pending", "done"].includes(statusHint) ? statusHint : "pending",
            due_date: new Date(proposal.due_date),
            user_id
          };
          const notes = [];
          if (payload.due_date && isNaN(payload.due_date.getTime())) {
            payload.due_date = undefined;
            notes.push(L.noteInvalidDue || "Ignored invalid due_date; could not parse.");
          } else {
            const now = new Date();
            if (payload.due_date && payload.due_date.getTime() < now.getTime() - 60_000) {
              payload.due_date = undefined;
              notes.push(L.notePastDue || "Ignored past due_date; provide a future date.");
            }
          }
          const created = await createTask(payload);
          sessionProposals.delete(sessionKey);
          return res.json({ message: L.createdMessage || "Task created", data: created, notes });
        }
      }
      // Fallback: simple heuristic confirmation
      if (isConfirm(prompt, langToUse)) {
        if (proposal && proposal.title && proposal.due_date) {
          const statusHint = extractStatusFromText(prompt) || proposal.status || "pending";
          const payload = {
            title: String(proposal.title).trim(),
            description: proposal.description || undefined,
            status: ["pending", "done"].includes(statusHint) ? statusHint : "pending",
            due_date: new Date(proposal.due_date),
            user_id
          };
          const notes = [];
          if (payload.due_date && isNaN(payload.due_date.getTime())) {
            payload.due_date = undefined;
            notes.push(L.noteInvalidDue || "Ignored invalid due_date; could not parse.");
          } else {
            const now = new Date();
            if (payload.due_date && payload.due_date.getTime() < now.getTime() - 60_000) {
              payload.due_date = undefined;
              notes.push(L.notePastDue || "Ignored past due_date; provide a future date.");
            }
          }
          const created = await createTask(payload);
          sessionProposals.delete(sessionKey);
          return res.json({ message: L.createdMessage || "Task created", data: created, notes });
        }
      }
    }

    // Backward compatibility: explicit confirm using provided draft
    if (confirm) {
      const args = draft && typeof draft === "object" ? draft : {};
      const payload = {
        title: args.title ? String(args.title).trim() : "",
        description: args.description ? String(args.description) : undefined,
        status: ["pending", "done"].includes(args.status) ? args.status : "pending",
        due_date: args.due_date ? new Date(args.due_date) : undefined,
        user_id
      };
      if (!payload.title) {
        return res.status(400).json({ error: L.errorTitleRequiredConfirm || "title is required to confirm" });
      }
      const notes = [];
      if (payload.due_date) {
        if (isNaN(payload.due_date.getTime())) {
          payload.due_date = undefined;
          notes.push(L.noteInvalidDue || "Ignored invalid due_date; could not parse.");
        } else {
          const now = new Date();
          if (payload.due_date.getTime() < now.getTime() - 60_000) {
            payload.due_date = undefined;
            notes.push(L.notePastDue || "Ignored past due_date; provide a future date.");
          }
        }
      }
      const created = await createTask(payload);
      return res.json({ message: L.createdMessage || "Task created", data: created, notes });
    }

    // Start/continue conversation with tool-calling
    const baseSystem = String(langToUse).toLowerCase().startsWith('id')
  ? `Kamu adalah asisten pembuatan tugas. Hari ini (UTC) ${nowIso}.
TUGAS:
- Tafsirkan frasa waktu kasual (mis. "besok jam 8 pagi") menjadi timestamp UTC masa depan yang wajar (hindari tahun salah/masa lalu).
- Jika status tidak disebutkan, default 'pending' (JANGAN tanya status).
- Judul singkat; infer dari konteks (contoh: "Kelas", "Rapat").
- Untuk rentang, gunakan WAKTU MULAI sebagai due_date.
 - Jika user minta kebiasaan/berulang, gunakan field repeat pada create_task:
   - repeat.enabled=true
   - repeat.frequency: daily/weekly/monthly
   - repeat.interval: angka (default 1)
   - Untuk weekly: set repeat.days_of_week (0=Min..6=Sabtu, UTC)
   - Untuk monthly: set repeat.day_of_month (1..31)
   - Set repeat.hour dan repeat.minute (UTC)
ALUR:
- Selalu ringkas pemahaman terlebih dahulu (contoh: "Jadi kamu punya [acara] pada [tanggal jam]...") lalu TANYAKAN konfirmasi: "Mau aku buat tugas berjudul \"...\" pada [tanggal jam]?".
- Baru PANGGIL tool create_task setelah user konfirmasi.
 - Jika ini kebiasaan/berulang (mis. tiap Selasa 07:00), isi field repeat dengan benar seperti di atas.
` : `You are a task creation assistant. Today (UTC) is ${nowIso}.
TASK:
- Interpret casual time into a reasonable future UTC timestamp (avoid past years).
- If status isn't provided, default to 'pending' (DO NOT ask for status).
- Keep titles short; infer from context (e.g., "Class", "Meeting").
- For time ranges, use the START time as due_date.
 - If the user asks for a recurring habit, use the repeat object on create_task:
   - repeat.enabled=true
   - repeat.frequency: daily/weekly/monthly
   - repeat.interval: number (default 1)
   - For weekly: set repeat.days_of_week (0=Sun..6=Sat, UTC)
   - For monthly: set repeat.day_of_month (1..31)
   - Set repeat.hour and repeat.minute (UTC)
FLOW:
- First summarize your understanding (e.g., "So you have [event] at [date time]...") and ASK for confirmation: "Should I create a task titled \"...\" at [date time]?".
- Only CALL the create_task tool after the user confirms.
`;

    const history = sessionMessages.get(sessionKey) || [ { role: "system", content: baseSystem } ];
    history.push({ role: "user", content: prompt });

    const initialOpts = {
      model: modelName,
      messages: history,
      tools,
      tool_choice: "auto",
      max_completion_tokens: max_tokens ?? 500
    };
    if (!String(modelName).includes("gpt-5-nano") && typeof temperature === "number") {
      initialOpts.temperature = temperature;
    }
  const { result: response, modelUsed: usedModel } = await tryCompletionWithFallbacks(client, initialOpts, modelName, { temperature, rateKeyPrefix: rateKey, langToUse });

    const msg = response.choices?.[0]?.message;
    if (!msg) {
      return res.status(500).json({ error: "No response from model" });
    }

    // If the model decided to create/update/delete/recurring via tool call
    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length > 0) {
      // For simplicity handle the first relevant tool call
      const call = toolCalls.find(c => ["create_task","update_task","delete_task","create_recurring"].includes(c.function?.name)) || toolCalls[0];
      const rawArgs = call.function?.arguments || "{}";
      let argsObj = {};
      try { argsObj = JSON.parse(rawArgs); } catch { argsObj = {}; }
      const notes = [];
      if (call.function?.name === "create_task") {
        const payload = {
          title: argsObj.title ? String(argsObj.title).trim() : "",
          description: argsObj.description ? String(argsObj.description) : undefined,
          status: ["pending", "done"].includes(argsObj.status) ? argsObj.status : "pending",
          due_date: argsObj.due_date ? new Date(argsObj.due_date) : undefined,
          user_id
        };
        if (argsObj.repeat && typeof argsObj.repeat === 'object') {
          const r = argsObj.repeat;
          const rep = {};
          if (typeof r.enabled === 'boolean') rep.enabled = r.enabled;
          if (typeof r.frequency === 'string' && ["daily","weekly","monthly"].includes(r.frequency)) rep.frequency = r.frequency;
          if (Number.isInteger(r.interval) && r.interval > 0) rep.interval = r.interval;
          if (Array.isArray(r.days_of_week)) rep.days_of_week = r.days_of_week.filter(n => Number.isInteger(n) && n >=0 && n <=6);
          if (Number.isInteger(r.day_of_month)) rep.day_of_month = r.day_of_month;
          if (typeof r.hour === 'number') rep.hour = r.hour;
          if (typeof r.minute === 'number') rep.minute = r.minute;
          payload.repeat = rep;
          if (rep.enabled) {
            const next = computeNextRunForRepeat(new Date(), {
              enabled: true,
              frequency: rep.frequency || (rep.days_of_week ? "weekly" : "daily"),
              interval: rep.interval || 1,
              days_of_week: rep.days_of_week,
              day_of_month: rep.day_of_month,
              hour: rep.hour ?? 9,
              minute: rep.minute ?? 0
            });
            payload.repeat.next_run_at = next;
          }
        }
        if (!payload.title) {
          // Avoid extra model call; ask user directly
          const askTitle = i18n(langToUse).ask.title;
          history.push(msg);
          sessionMessages.set(sessionKey, history);
          return res.json({ requires_confirmation: true, assistant_message: askTitle });
        }
        if (payload.due_date) {
          if (isNaN(payload.due_date.getTime())) {
            payload.due_date = undefined;
            notes.push(L.noteInvalidDue || "Ignored invalid due_date; could not parse.");
          } else {
            const now = new Date();
            if (payload.due_date.getTime() < now.getTime() - 60_000) {
              payload.due_date = undefined;
              notes.push(L.notePastDue || "Ignored past due_date; provide a future date.");
            }
          }
        }
        const created = await createTask(payload);
        history.push(msg);
        sessionMessages.set(sessionKey, history);
        return res.json({ message: L.createdMessage || "Task created", assistant_message: L.createdMessage || "Task created", data: created, notes });
      } else if (call.function?.name === "update_task") {
        const id = String(argsObj.id || "").trim();
        if (!id) {
          history.push(msg);
          sessionMessages.set(sessionKey, history);
          return res.status(400).json({ error: "id is required for update" });
        }
        const existing = await getTaskById(id);
        if (!existing) return res.status(404).json({ error: "Task not found" });
        if (String(existing.user_id) !== String(user_id)) return res.status(403).json({ error: "Forbidden" });
        const patch = {};
        if (typeof argsObj.title === 'string' && argsObj.title.trim()) patch.title = argsObj.title.trim();
        if (typeof argsObj.description === 'string') patch.description = argsObj.description;
        if (typeof argsObj.status === 'string' && ["pending","done"].includes(argsObj.status)) patch.status = argsObj.status;
        if (typeof argsObj.due_date === 'string' && argsObj.due_date) {
          const d = new Date(argsObj.due_date);
          if (!isNaN(d.getTime())) {
            const now = new Date();
            if (d.getTime() >= now.getTime() - 60_000) patch.due_date = d;
            else notes.push(L.notePastDue || "Ignored past due_date; provide a future date.");
          } else {
            notes.push(L.noteInvalidDue || "Ignored invalid due_date; could not parse.");
          }
        }
        const updated = await updateTask(id, patch);
        history.push(msg);
        sessionMessages.set(sessionKey, history);
        const successMsg = String(langToUse).startsWith('id') ? "Task berhasil diupdate" : "Task updated";
        return res.json({ message: successMsg, data: updated, notes });
      } else if (call.function?.name === "delete_task") {
        const id = String(argsObj.id || "").trim();
        if (!id) {
          history.push(msg);
          sessionMessages.set(sessionKey, history);
          return res.status(400).json({ error: "id is required for delete" });
        }
        const existing = await getTaskById(id);
        if (!existing) return res.status(404).json({ error: "Task not found" });
        if (String(existing.user_id) !== String(user_id)) return res.status(403).json({ error: "Forbidden" });
        const deleted = await deleteTask(id);
        history.push(msg);
        sessionMessages.set(sessionKey, history);
        const successMsg = String(langToUse).startsWith('id') ? "Task berhasil dihapus" : "Task deleted";
        return res.json({ message: successMsg, data: deleted });
      } else if (call.function?.name === "create_recurring") {
        const title = argsObj.title ? String(argsObj.title).trim() : "";
        const hour = Number(argsObj.hour);
        const minute = Number(argsObj.minute);
        const description = typeof argsObj.description === 'string' ? argsObj.description : undefined;
        let days = Array.isArray(argsObj.days_of_week) ? argsObj.days_of_week.filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : undefined;
        if (!days) days = [0,1,2,3,4,5,6];
        if (!title || Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
          history.push(msg);
          sessionMessages.set(sessionKey, history);
          const ask = String(langToUse).startsWith('id') ? "Butuh title, jam (0-23 UTC), dan menit (0-59)." : "Need title, hour (0-23 UTC), and minute (0-59).";
          return res.status(400).json({ error: ask });
        }
        const createdRec = await createRecurring({ user_id, title, description, hour, minute, days_of_week: days });
        const successMsg = String(langToUse).startsWith('id') ? "Recurring task dibuat" : "Recurring task created";
        return res.json({ message: successMsg, data: createdRec });
      }
    }

    // Otherwise, the model asked a follow-up question or summarized
    let assistant_message = (msg.content || "").trim();
    // Try to persist a proposal snapshot from user's prompt for future quick confirm
    const isId = String(langToUse).toLowerCase().startsWith('id');
    const titleGuess = deriveTitleFromPrompt(prompt, langToUse) || (isId ? "Tugas" : "Task");
    const nowForProp = new Date();
    const tOnly = parseTimeAt(prompt, nowForProp);
    const baseDate = parseKeywordDate(prompt, nowForProp) || parseRelativeDate(prompt, nowForProp);
    let dueCandidate;
    if (baseDate && tOnly) dueCandidate = setTimeOnDate(baseDate, tOnly);
    else dueCandidate = tOnly || baseDate;
    if (!assistant_message) {
      if (dueCandidate && !isNaN(dueCandidate.getTime())) {
        const when = dueCandidate.toISOString();
        const proposalText = isId
          ? `Jadi kamu punya ${titleGuess.toLowerCase()} pada ${when}. Mau aku buat tugas berjudul "${titleGuess}" pada waktu itu?`
          : `So you have a ${titleGuess.toLowerCase()} at ${when}. Should I create a task titled "${titleGuess}" at that time?`;
        sessionProposals.set(sessionKey, { title: titleGuess, due_date: when, status: "pending", assistant_message: proposalText });
        assistant_message = isId
          ? `Jadi kamu punya ${titleGuess.toLowerCase()} pada ${when}. Mau aku buat tugas berjudul "${titleGuess}" pada waktu itu? (Status akan diset 'pending' jika tidak disebutkan)`
          : `So you have a ${titleGuess.toLowerCase()} at ${when}. Should I create a task titled "${titleGuess}" at that time? (Status defaults to 'pending' if not mentioned)`;
      } else {
        const q = L.ask;
        assistant_message = [q.title, q.due_date, q.description, q.status].join(' ');
      }
    } else {
      // If we can infer a due date from the user's message, remember it for next turn
      if (dueCandidate && !isNaN(dueCandidate.getTime())) {
        sessionProposals.set(sessionKey, { title: titleGuess, due_date: dueCandidate.toISOString(), status: "pending", assistant_message });
      }
    }
    history.push(msg);
    sessionMessages.set(sessionKey, history);
    return res.json({ requires_confirmation: true, assistant_message });
  } catch (err) {
    console.error("Agent error:", err);
    const status = err?.status || err?.statusCode;
    if (status === 429 || /rate\s*limit/i.test(String(err?.message || ""))) {
      const sec = parseRetryAfterSecondsFromError(err) ?? 60;
      const langToUse = req.body?.lang || detectLangFromText(req.body?.prompt || "");
      const L = i18n(langToUse);
      return res.status(429).json({ error: L.rateLimited(sec), retry_after_seconds: sec });
    }
    res.status(500).json({ error: err.message });
  }
};
