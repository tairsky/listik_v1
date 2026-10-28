/* Листик: сервер без внешних зависимостей (Node 18+).
   Запуск: node server.js
   Переменные: PORT (по умолчанию 3000), TRUST_PROXY=1 (если за nginx/Cloudflare),
               COOKIE_SECURE=1 (обязательно при работе по https).

   Главное правило: ответы, правила и фразы «верно» лежат только в data/private/
   и в браузер не отправляются, пока ребёнок не ответил.
   Ответ шага взрослому выдаётся только после ввода PIN-кода кабинета родителя.

   Данные кабинетов пишутся в storage/users.json (создаётся сам). Это временное
   хранилище для прототипа: перед запуском для пользователей его нужно заменить
   на базу данных. Сессии входа хранятся в памяти: после перезапуска сервера
   нужно войти заново. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
/* счётчики нагрузки для вкладки «Нагрузка» в админ-панели (подробнее ниже, у loadSnapshot) */
const M = { started: Date.now(), turns: 0, busy: 0, fail: 0, o429: 0, r429: 0, err: 0, peak: 0, saveMs: 0, saveBytes: 0, saveAt: 0, saveMax: 0, saveCount: 0, hist: [] };

const readJSON = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const TASKS_FILE = readJSON("data/private/tasks.json");
const TASKS = TASKS_FILE.tasks;
/* Сквозная нумерация: задачи идут по порядку разделов, номер не начинается заново в новом разделе.
   Номер считается сам, поэтому при добавлении задач порядковые номера править руками не нужно. */
{
  const secOrder = new Map((TASKS_FILE.sections || []).map((x, i) => [x.id, i]));
  const pos = x => (secOrder.has(x.section) ? secOrder.get(x.section) : 1e9);
  TASKS.sort((a, b) => pos(a) - pos(b));
  TASKS.forEach((t, i) => { t.no = String(i + 1); });
}
const SUBJECT = { title: TASKS_FILE.subject_title || "Математика", grade: TASKS_FILE.grade || 3 };
const CONFIG = readJSON("data/private/config.json");
const MAX_ATTEMPTS = 3;

/* ---------- голос (OpenAI Realtime) ---------- */
/* Ключ берём из переменной окружения OPENAI_API_KEY или из файла .env рядом с server.js
   (одна строка: OPENAI_API_KEY=sk-...). Ключ остаётся на сервере: браузер получает
   только временный ключ на одну сессию. */
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {}
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
/* Голос: три отдельных шага вместо дорогого Realtime: распознавание речи -> текстовая модель -> озвучка.
   Версия на Realtime сохранена в server.realtime.js. */
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "gpt-6-luna";            // дёшево; если плохо слушается: gpt-6.1-sol
const STT_MODEL = process.env.STT_MODEL || "gpt-4o-mini-transcribe";
const TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.TTS_VOICE || process.env.VOICE || "marin";
const TTS_STYLE = process.env.TTS_STYLE === undefined
  ? "Говори по-русски, с русским произношением и русскими ударениями, тепло, дружелюбно и спокойно, не торопясь, как добрая старшая сестра, которая объясняет ребёнку 8–9 лет. Чётко произноси числа."
  : process.env.TTS_STYLE;
const VOICE_SERVER_MAX_MIN = Number(process.env.VOICE_MAX_MINUTES || 45);   // потолок одной голосовой сессии; дневной лимит голоса считается отдельно (VOICE_DAY_MIN)
const VOICE_PROMPT = `Ты — Листик, добрый голосовой помощник-репетитор для ребёнка 8-9 лет (3 класс, Казахстан). Ты общаешься по-русски, голосом.

КТО ЧТО ДЕЛАЕТ
- Правильные ответы ты НЕ знаешь. Ответы проверяет программа, а не ты. Всё, что ребёнок отвечает на вопрос шага, ты передаёшь функции submit_answer и пересказываешь её результат своими словами.
- Слова ребёнка приходят к тебе уже текстом после распознавания речи, в нём бывают ошибки и «лишние» слова. Если текст не похож на ответ, переспроси.
- Кашель, шум, вздохи, шёпот, обрывки слов и разговоры на фоне — это не ответ. Если за ними нет понятного ответа, ничего не говори и жди тишины. Никогда не начинай читать вопрос заново из-за постороннего звука: повторяй только когда ребёнок явно просит словами («повтори»).
- Сообщения с пометкой [Программа] приходят от программы: в них условие, вопрос текущего шага и события. Не зачитывай их дословно, говори своими словами.
- Пока функция не вернула результат, не говори «верно» или «неверно» и не угадывай ответ.
- Никогда не произноси и не пиши служебные пометки и комментарии в скобках, не упоминай слова «функция» и «инструмент». Ребёнок слышит только то, что ты говоришь ему лично.

ПРАВИЛО ТОЧНОСТИ (самое важное)
- Все тексты для ребёнка (вопросы, правила, примеры, фразы «верно») написаны и проверены учителями. Ты берёшь их только из сообщений программы и результатов функции и произносишь ДОСЛОВНО.
- Ничего не пересказывай своими словами, не добавляй новых чисел, фактов, правил и способов решения, не предлагай другие способы. Если ребёнок предлагает свой способ или спрашивает «а почему», скажи «Давай вернёмся к вопросу» и повтори вопрос.

КАК ТЫ ВЕДЁШЬ РАЗГОВОР
1. Когда приходит новый шаг, прочитай ребёнку вопрос вслух дословно и замолчи, давая подумать. Текст вопроса уже подготовлен для чтения вслух: знаки в нём заменены словами. Читай его слово в слово и ничего не пропускай, особенно «умножить на», «разделить на», «плюс», «минус», «равно».
2. Ребёнок называет ответ: вызови submit_answer. Числа передавай целыми («сорок два» это 42). Если ответ неразборчив или не похож на ответ, не вызывай функцию, а переспроси: «Я услышал сорок два, верно?».
3. Если ребёнок задаёт вопрос не по теме или болтает, ответь одной короткой фразой и верни его к вопросу шага.
4. Результат correct: произнеси message из результата дословно и добавь не больше пяти слов одобрения. Следующий вопрос не задавай, программа сама перейдёт к нему.
5. Результат wrong: скажи «Пока не так», дословно прочитай rule, затем similar (если он есть) и попроси попробовать ещё раз. Ничего не считай за ребёнка и не называй готовый ответ. Если locked равно true, скажи «Так бывает у всех. Можно сделать перерыв или позвать взрослого» и больше этот шаг не обсуждай.
6. Если ребёнок говорит «не понимаю», «я тупой», «бесит» или отвечает наугад несколько раз подряд: остановись, скажи, что так бывает у всех, предложи перерыв.

КАК ТЫ ГОВОРИШЬ
- Говори на чистом русском языке с русским произношением, как носитель русского языка: русские гласные и согласные, русские ударения, без английского акцента. Числа и математические слова произноси по-русски, не торопясь.
- Короткими фразами, простыми словами, как старший брат или сестра. Не больше 2-3 предложений за раз. Спокойно, не торопясь, чётко произноси числа.
- Хвали за действие, а не общими словами. Не сравнивай с другими детьми, не торопи, без сарказма.
- Не придумывай новых математических фактов и чисел: говори только то, что пришло от программы.

БЕЗОПАСНОСТЬ
- Не спрашивай и не принимай личные данные (фамилию, адрес, школу, телефон). Если ребёнок их называет, мягко скажи, что делиться ими не нужно.
- Говори только про учёбу. Если ребёнок говорит, что ему плохо, страшно или его обижают, скажи, что стоит рассказать маме, папе или учителю, и не продолжай тему.
- Ты компьютерная программа-помощник, а не человек. Если спросят, так и скажи.`;
const VOICE_TOOLS = [{
  type: "function", name: "submit_answer",
  description: "Отправить ответ ребёнка на проверку программе. Вызывай, когда ребёнок назвал ответ на текущий шаг.",
  parameters: { type: "object", properties: {
    number: { type: "integer", description: "Ответ-число (для шага с одним числом)" },
    choice: { type: "string", description: "Буква выбранного варианта: А, Б, В... (для шага с выбором)" },
    values: { type: "array", items: { type: "integer" }, description: "Числа по порядку полей (для шага с несколькими числами)" }
  } }
}];

/* ---------- голос: распознавание -> модель -> озвучка ---------- */
class Upstream extends Error { constructor(stage, detail) { super(detail); this.stage = stage; this.detail = detail; } }
const voiceSessions = new Map();   // sid -> { instructions, last (id прошлого ответа модели), pending (вызовы без результата) }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of voiceSessions) if (now - v.created > (VOICE_SERVER_MAX_MIN + 5) * 60000) voiceSessions.delete(k);
}, 60000).unref();

function wavFromPcm(pcm) {            // сырой звук 16 кГц, 16 бит, моно -> WAV для распознавания
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 25000);   // без таймаута зависший OpenAI держал бы запросы (и память) до 5 минут
async function upstream(stage, url, init) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }); } catch (e) { throw new Upstream(stage, "нет связи: " + e.message); }
}
const GHOST = /субтитр|продолжение следует|спасибо за просмотр|редактор|корректор|подписывайтесь/i;  // «слова из тишины»
async function sttText(pcm) {
  const fd = new FormData();
  fd.append("file", new Blob([wavFromPcm(pcm)], { type: "audio/wav" }), "speech.wav");
  fd.append("model", STT_MODEL);
  fd.append("language", "ru");
  const r = await upstream("stt", OPENAI_BASE + "/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + OPENAI_KEY }, body: fd });
  const text = await r.text();
  if (!r.ok) throw new Upstream("stt", r.status + " " + text.slice(0, 200));
  let t = "";
  try { t = (JSON.parse(text).text || "").trim(); } catch (e) { throw new Upstream("stt", "непонятный ответ"); }
  return t.length < 2 || GHOST.test(t) ? "" : t;
}
function outputText(j) {
  if (typeof j.output_text === "string" && j.output_text) return j.output_text.trim();
  const parts = [];
  for (const o of j.output || []) if (o.type === "message") for (const c of o.content || []) if (c.type === "output_text" && c.text) parts.push(c.text);
  return parts.join("").trim();
}
async function modelCall(body) {
  let r, text;
  for (const extra of [{ reasoning: { effort: "low" } }, {}]) {   // если модель не принимает параметр, повторяем без него
    r = await upstream("llm", OPENAI_BASE + "/responses", {
      method: "POST", headers: { Authorization: "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra })
    });
    text = await r.text();
    if (r.ok || r.status !== 400 || !("reasoning" in extra)) break;
  }
  if (!r.ok) throw new Upstream("llm", r.status + " " + text.slice(0, 300));
  try { return JSON.parse(text); } catch (e) { throw new Upstream("llm", "непонятный ответ"); }
}
function speechText(t) {              // запасная замена знаков словами (основные уже заменены в тексте программы)
  return String(t).replace(/[*_`#>~]/g, "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/(\d)\s*[-−–]\s*(\d)/g, "$1 минус $2").replace(/[×·*]/g, " умножить на ").replace(/÷/g, " разделить на ")
    .replace(/\+/g, " плюс ").replace(/=/g, " равно ").replace(/\s+/g, " ").trim().slice(0, 1800);
}
async function speak(text) {
  const input = speechText(text);
  let last = "";
  for (const withStyle of [true, false]) {
    if (!TTS_STYLE && withStyle) continue;
    const bodyObj = { model: TTS_MODEL, voice: TTS_VOICE, input, response_format: "mp3" };
    if (withStyle) bodyObj.instructions = TTS_STYLE;
    const r = await upstream("tts", OPENAI_BASE + "/audio/speech", {
      method: "POST", headers: { Authorization: "Bearer " + OPENAI_KEY, "Content-Type": "application/json" }, body: JSON.stringify(bodyObj)
    });
    if (r.ok) return { audio: Buffer.from(await r.arrayBuffer()).toString("base64"), mime: "audio/mpeg" };
    last = r.status + " " + (await r.text()).slice(0, 200);
  }
  throw new Upstream("tts", last);
}
function bigBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { reject(new Error("big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

/* Один шаг голоса. Браузер присылает то, что случилось: звук ребёнка (audio), сообщения программы (tell),
   результаты вызова проверки (outputs). Сервер отвечает: услышанным текстом, вызовами проверки (calls)
   или готовой репликой с озвучкой (reply + audio). */
const AUDIO_MAX_BYTES = Number(process.env.AUDIO_MAX_BYTES || 520000);           // ~16 секунд речи; браузер режет куски по 15 секунд
const VOICE_MAX_INFLIGHT = Number(process.env.VOICE_MAX_INFLIGHT || 40);          // одновременно обрабатываемых голосовых ходов (защита памяти)
const VOICE_USER_TURNS_DAY = Number(process.env.VOICE_USER_TURNS_DAY || 800);     // обращений к голосу на кабинет в сутки (считает сервер, а не браузер)
const VOICE_GLOBAL_DAY = Number(process.env.VOICE_GLOBAL_DAY || 30000);           // потолок голосовых обращений на весь сайт в сутки (защита бюджета OpenAI)
const VOICE_GUESTS = process.env.VOICE_GUESTS !== "0";                            // пускать ли в голос без входа в кабинет (по умолчанию да; VOICE_GUESTS=0 закрывает)
let voiceBusy = 0;
const voiceGlobal = { day: "", n: 0 };
async function voiceTurn(req, res, ip, a) {
  if (voiceBusy >= VOICE_MAX_INFLIGHT) { M.busy++; req.resume(); return send(res, 503, { error: "busy" }); }
  voiceBusy++; if (voiceBusy > M.peak) M.peak = voiceBusy;
  try { return await voiceTurnInner(req, res, ip, a); } finally { voiceBusy--; }
}
async function voiceTurnInner(req, res, ip, a) {
  let b;
  try { b = await bigBody(req, 900000); } catch (e) { return send(res, 400, { error: "bad_request" }); }
  const vs = voiceSessions.get(String(b.sid || ""));
  if (!vs) return send(res, 404, { error: "no_session" });
  vs.seen = Date.now();
  if (!SETTINGS.voiceEnabled || (vs.ukey && voiceOver(vs.ukey))) { voiceSessions.delete(String(b.sid)); return send(res, 403, { error: "voice_limit" }); }
  if (Date.now() - vs.created > VOICE_SERVER_MAX_MIN * 60000 || vs.turns >= 400) { voiceSessions.delete(String(b.sid)); return send(res, 410, { error: "limit" }); }
  const who = a ? "u" + a.user.id : ip;
  if (tooMany("vturn:" + who, 600, 60 * MIN)) return send(res, 429, { error: "too_many" });
  const dn = dayStamp(); if (voiceGlobal.day !== dn) { voiceGlobal.day = dn; voiceGlobal.n = 0; }
  if (voiceGlobal.n >= VOICE_GLOBAL_DAY) return send(res, 503, { error: "busy" });
  const du = usageOf(vs.ukey || "ip:" + ip);
  if ((du.vt || 0) >= VOICE_USER_TURNS_DAY) return send(res, 403, { error: "voice_limit" });
  hit("vturn:" + who);
  voiceGlobal.n++; M.turns++; du.vt = (du.vt || 0) + 1; scheduleUsageSave();
  vs.turns++;
  const prevPending = vs.pending;
  try {
    const input = [];
    const outs = Array.isArray(b.outputs) ? b.outputs.slice(0, 8) : [];
    for (const id of vs.pending) {     // у модели не должно остаться вызовов без результата
      const o = outs.find(x => x && x.call_id === id);
      input.push({ type: "function_call_output", call_id: id, output: o && typeof o.output === "string" ? o.output.slice(0, 3000) : JSON.stringify({ error: "ответ не проверен" }) });
    }
    for (const t of (Array.isArray(b.tell) ? b.tell.slice(0, 10) : [])) if (typeof t === "string" && t.trim()) input.push({ role: "system", content: t.slice(0, 8000) });
    let heard = "";
    if (typeof b.audio === "string" && b.audio.length > 4000) {
      const pcm = Buffer.from(b.audio, "base64");
      if (pcm.length > AUDIO_MAX_BYTES) return send(res, 413, { error: "too_big" });
      heard = await sttText(pcm);
      if (heard) input.push({ role: "user", content: heard });
    }
    if (!input.length) return send(res, 200, { heard });
    vs.pending = [];
    const r = await modelCall({
      model: LLM_MODEL, instructions: vs.instructions, tools: VOICE_TOOLS, tool_choice: "auto",
      previous_response_id: vs.last || undefined, input, store: true, max_output_tokens: 800
    });
    vs.last = r.id;
    const calls = (r.output || []).filter(o => o.type === "function_call");
    if (calls.length) {
      vs.pending = calls.map(c => c.call_id);
      return send(res, 200, { heard, calls: calls.map(c => ({ call_id: c.call_id, name: c.name, arguments: c.arguments })) });
    }
    const reply = outputText(r).replace(/\s*\([^()]*(инструмент|функци|вызыва)[^()]*\)/gi, "").trim();   // служебные пометки в скобках ребёнку не озвучиваем
    if (!reply) return send(res, 200, { heard, reply: "" });
    const sp = await speak(reply);
    return send(res, 200, { heard, reply, audio: sp.audio, mime: sp.mime });
  } catch (e) {
    vs.pending = prevPending;
    if (e instanceof Upstream) { M.fail++; if (/^429/.test(String(e.detail))) M.o429++; console.error("[голос:" + e.stage + "]", e.detail); return send(res, 502, { error: "voice_failed", stage: e.stage }); }
    throw e;
  }
}

/* ---------- контент: что видит браузер ---------- */
const SECRET_STEP = ["correct", "answer", "rule", "ok", "note"];
const publicTask = t => {
  const { similar, ...task } = t;
  task.steps = t.steps.map(s => { const o = { ...s }; SECRET_STEP.forEach(k => delete o[k]); return o; });
  return task;
};
const PUBLIC_TASKS = TASKS.map(publicTask);

/* ---------- пробные и платные задачи ----------
   В data/private/tasks.json у задачи может быть "access": "trial" (открыта всем без оплаты).
   Без этого поля задача считается платной: её условие и шаги не уходят в браузер, пока нет подписки.
   Подписку выдаёт владелец командой: node admin.js plan <почта> <дней> (см. admin.js). */
const isPaidTask = t => t.access !== "trial";
const hasPlan = a => !!(a && a.user.plan && a.user.plan.until && Date.parse(a.user.plan.until) > Date.now());
const taskLocked = (t, a) => isPaidTask(t) && !hasPlan(a);
/* Список задач для страницы: только то, что нужно для каталога (номер, название, раздел, короткое условие, статус).
   При сотнях задач целиком каждую отдавать нельзя: шаги и урок приходят по запросу /api/task/<id> при открытии задачи. */
const shortCond = t => String(t.condition || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 110);
const tasksFor = a => {
  const P = a && progress(a.user).tasks;
  return TASKS.map(t => {
    const locked = taskLocked(t, a);
    const o = { id: t.id, no: t.no, title: t.title, section: t.section, cond: locked ? "" : shortCond(t), locked };
    if (P) { const x = P[t.id]; o.st = x && x.completions ? "done" : x && x.inProgress ? "progress" : "new"; }
    return o;
  });
};
const publicById = new Map(TASKS.map((t, i) => [t.id, PUBLIC_TASKS[i]]));
const taskById = id => TASKS.find(t => t.id === id);

/* ---------- хранилище кабинетов ---------- */
const STORE_DIR = process.env.STORE_DIR || path.join(ROOT, "storage");
const USERS_FILE = path.join(STORE_DIR, "users.json");
const KEY_FILE = path.join(STORE_DIR, "secret.key");
fs.mkdirSync(STORE_DIR, { recursive: true });
let USERS = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, "utf8")) : [];
function saveUsers() {
  const t0 = process.hrtime.bigint(), tmp = USERS_FILE + ".tmp", txt = JSON.stringify(USERS, null, 2);
  fs.writeFileSync(tmp, txt, { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;       // пока идёт сохранение, сервер никого не обслуживает: меряем это время
  M.saveMs = Math.round(ms); M.saveBytes = Buffer.byteLength(txt); M.saveAt = Date.now(); M.saveCount++;
  if (ms > M.saveMax) M.saveMax = Math.round(ms);
}
let saveTimer = null;
function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveUsers(); }, 1500); }
function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveUsers(); } }
process.on("SIGINT", () => { flushSave(); flushUsage(); process.exit(0); });
process.on("SIGTERM", () => { flushSave(); flushUsage(); process.exit(0); });
const maskEmail = e => e.replace(/^(.).*(@.*)$/, "$1***$2");

/* «перец» для PIN: у 4 цифр всего 10 000 вариантов, поэтому без секрета, лежащего отдельно от
   users.json, утёкший файл подбирается за секунды */
if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
const PEPPER = Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "hex");

async function hashSecret(secret, kind, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const input = kind === "pin" ? crypto.createHmac("sha256", PEPPER).update(secret).digest() : Buffer.from(secret, "utf8");
  const h = await scrypt(input, salt, 32);
  return { salt: salt.toString("hex"), hash: h.toString("hex") };
}
async function checkSecret(secret, kind, rec) {
  const { hash } = await hashSecret(secret, kind, rec.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(rec.hash, "hex"));
}
const DUMMY = { salt: "00".repeat(16), hash: "00".repeat(32) };

/* ---------- ограничения по времени ---------- */
const buckets = new Map(); // ключ -> [метки времени]
function tooMany(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  buckets.set(key, arr);
  return arr.length >= limit;
}
function hit(key) { const a = buckets.get(key) || []; a.push(Date.now()); buckets.set(key, a); }
const MIN = 60000;
const MAIL = require("./mail.js");
/* адрес сайта для ссылок в письмах: SITE_URL из настроек или адрес, по которому пришёл запрос */
const siteUrl = req => (process.env.SITE_URL || ((COOKIE_SECURE ? "https" : "http") + "://" + (req.headers.host || "localhost:" + PORT))).replace(/\/$/, "");
const mailFail = e => console.log("[письмо] не отправлено: " + e.message);
/* ссылка для нового пароля без хранения на сервере: подпись привязана к текущему паролю, поэтому после смены пароля старая ссылка перестаёт работать */
function resetToken(user) {
  const exp = Date.now() + 60 * MIN;
  return user.id + "." + exp + "." + crypto.createHmac("sha256", PEPPER).update("reset|" + user.id + "|" + exp + "|" + user.pass.hash.slice(0, 16)).digest("hex");
}
function userByResetToken(tok) {
  const p = typeof tok === "string" ? tok.split(".") : [];
  if (p.length !== 3 || !/^\d+$/.test(p[1]) || Number(p[1]) < Date.now()) return null;
  const user = USERS.find(u => u.id === p[0]);
  if (!user || user.blocked) return null;
  const want = crypto.createHmac("sha256", PEPPER).update("reset|" + user.id + "|" + p[1] + "|" + user.pass.hash.slice(0, 16)).digest();
  if (!/^[0-9a-f]{64}$/.test(p[2])) return null;
  const got = Buffer.from(p[2], "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? user : null;
}

/* ---------- сессии ---------- */
const play = new Map();    // ключ прогресса -> { steps: Map, seen }
const auth = new Map();    // токен входа -> { uid, exp, parentUntil }
const AUTH_TTL = 14 * 24 * 3600 * 1000;
const PARENT_TTL = 10 * MIN;
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of play) if (now - s.seen > 2 * 3600 * 1000) play.delete(k);
  for (const [k, s] of auth) if (s.exp < now) auth.delete(k);
  for (const [k, arr] of buckets) { const f = arr.filter(t => now - t < 3600 * 1000); if (f.length) buckets.set(k, f); else buckets.delete(k); }
}, MIN).unref();

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function currentAuth(req) {
  const token = parseCookies(req).lt;
  const s = token && auth.get(token);
  if (!s || s.exp < Date.now()) return null;
  const user = USERS.find(u => u.id === s.uid);
  return user && !user.blocked ? { token, s, user } : null;
}
function setLoginCookie(res, token, maxAgeSec) {
  res.setHeader("Set-Cookie", "lt=" + token + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + maxAgeSec + (COOKIE_SECURE ? "; Secure" : ""));
}
function startLogin(res, user) {
  user.lastLoginAt = new Date().toISOString(); scheduleSave();
  const token = crypto.randomBytes(32).toString("hex");
  auth.set(token, { uid: user.id, exp: Date.now() + AUTH_TTL, parentUntil: 0 });
  setLoginCookie(res, token, AUTH_TTL / 1000);
}
const isParent = a => a && a.s.parentUntil > Date.now();
const publicUser = (a) => ({ email: a.user.email, child: a.user.child, parent: isParent(a), plan: hasPlan(a) ? { until: a.user.plan.until } : null });

const PLAY_MAX = 20000;
function playState(key, ip) {
  let s = play.get(key);
  if (!s) {
    /* новые гостевые сессии: не чаще 60 в час с одного адреса, иначе таблицу можно забить и никого не пускать */
    if (key.startsWith("s:")) { if (tooMany("newplay:" + ip, 60, 60 * MIN)) return null; hit("newplay:" + ip); }
    if (play.size >= PLAY_MAX) { let n = 0; for (const k of play.keys()) { play.delete(k); if (++n >= 500) break; } }   // вытесняем самые давние, а не отказываем новым
    s = { steps: new Map() }; play.set(key, s);
  } else { play.delete(key); play.set(key, s); }   // свежие уходят в конец
  s.seen = Date.now();
  return s;
}
function stepState(s, taskId, i) {
  const k = taskId + ":" + i;
  if (!s.steps.has(k)) s.steps.set(k, { attempts: 0, locked: false, errors: 0, helped: false, solved: false });
  return s.steps.get(k);
}

/* ---------- прогресс ребёнка ---------- */
function progress(u) {
  return u.progress || (u.progress = { firstLessonAt: null, lastLessonAt: null, tasks: {}, skills: {}, lessons: [] });
}
function recordSolved(user, task, ps, i, st) {
  const P = progress(user), now = new Date().toISOString();
  P.lastLessonAt = now; if (!P.firstLessonAt) P.firstLessonAt = now;
  const step = task.steps[i], clean = st.errors === 0 && !st.helped, name = step.skill || "без темы";
  const sk = (P.skills[name] = P.skills[name] || { steps: 0, firstTry: 0, helped: 0 });
  sk.steps++; if (clean) sk.firstTry++; if (st.helped) sk.helped++;
  const T = (P.tasks[task.id] = P.tasks[task.id] || { completions: 0, bestFirstTry: 0, lastFirstTry: 0, inProgress: null, lastAt: null });
  T.lastAt = now;
  const states = task.steps.map((_, k) => ps.steps.get(task.id + ":" + k));
  const solved = states.filter(x => x && x.solved).length;
  if (solved < task.steps.length) { T.inProgress = { solved }; }
  else {
    const first = states.filter(x => x.errors === 0 && !x.helped).length;
    T.completions++; T.inProgress = null; T.lastFirstTry = first; T.bestFirstTry = Math.max(T.bestFirstTry, first);
    const hard = new Set(), repeat = new Set();
    task.steps.forEach((s, k) => { const x = states[k]; if (x.errors > 0) hard.add(s.skill); if (x.errors >= 2 || x.helped) repeat.add(s.skill); });
    P.lessons.push({ at: now, task: task.id, firstTry: first, total: task.steps.length, hard: [...hard], repeat: [...repeat] });
    if (P.lessons.length > 50) P.lessons.splice(0, P.lessons.length - 50);
  }
  scheduleSave();
}
const LEVEL_ORDER = { repeat: 0, train: 1, good: 2 };
/* Дополнительные сведения для кабинета родителя: время, серия, недели, разделы, история занятий, подписка. */
function cabinetExtra(user, tasksView) {
  const P = progress(user), log = user.usageLog || {}, now = Date.now();
  const dk = ms => new Date(ms + 5 * 3600 * 1000).toISOString().slice(0, 10);
  const days = n => Array.from({ length: n }, (_, i) => dk(now - (n - 1 - i) * 86400000));
  const st = d => (log[d] && log[d].study) || 0, vo = d => (log[d] && log[d].voice) || 0;
  const sum = (arr, f) => arr.reduce((n, d) => n + f(d), 0);
  const d90 = days(90), d30 = days(30), w1 = days(7), w0 = days(14).slice(0, 7);
  const activity = d30.map(d => ({ day: d, study: Math.round(st(d) / 60), voice: Math.round(vo(d) / 60) }));
  let streak = 0, i = d90.length - 1;
  if (!(st(d90[i]) > 0)) i--;                       // сегодня ещё могли не заниматься: серия считается со вчера
  for (; i >= 0 && st(d90[i]) > 0; i--) streak++;
  const week = { minutes: Math.round(sum(w1, st) / 60), prev: Math.round(sum(w0, st) / 60), activeDays: w1.filter(d => st(d) > 0).length,
    voice: Math.round(sum(w1, vo) / 60) };
  const sections = (TASKS_FILE.sections || []).map(s => {
    const ts = TASKS.filter(x => x.section === s.id);
    const v = ts.map(x => tasksView.find(y => y.id === x.id));
    return { id: s.id, title: s.title, tasksTotal: ts.length, tasksDone: v.filter(x => x && x.status === "done").length,
      tasksStarted: v.filter(x => x && x.status !== "new").length,
      minutes30: Math.round(sum(d30, d => (log[d] && log[d].sec && log[d].sec[s.id]) || 0) / 60) };
  });
  const history = P.lessons.map(l => {
    const tk = taskById(l.task) || {};
    return { at: l.at, no: tk.no || l.task, title: tk.title || "", firstTry: l.firstTry, total: l.total, pct: l.total ? Math.round(100 * l.firstTry / l.total) : 0, hard: l.hard || [] };
  });
  const monday = ms => { const wd = (new Date(ms + 5 * 3600 * 1000).getUTCDay() + 6) % 7; return dk(ms - wd * 86400000); };
  const weeks = []; for (let k = 7; k >= 0; k--) weeks.push({ start: monday(now - k * 7 * 86400000), minutes: 0, lessons: 0, ft: 0, tot: 0 });
  const wi = Object.fromEntries(weeks.map((w, k) => [w.start, k]));
  Object.keys(log).forEach(d => { const k = wi[monday(Date.parse(d + "T12:00:00Z"))]; if (k !== undefined) weeks[k].minutes += st(d) / 60; });
  P.lessons.forEach(l => { const k = wi[monday(Date.parse(l.at))]; if (k !== undefined) { weeks[k].lessons++; weeks[k].ft += l.firstTry; weeks[k].tot += l.total; } });
  const weeksOut = weeks.map(w => ({ start: w.start, minutes: Math.round(w.minutes), lessons: w.lessons, pct: w.tot ? Math.round(100 * w.ft / w.tot) : null }));
  const hardCount = {}; P.lessons.slice(-10).forEach(l => (l.hard || []).forEach(n => { hardCount[n] = (hardCount[n] || 0) + 1; }));
  const hardTop = Object.entries(hardCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, lessons: n }));
  const active = hasPlan({ user }), key = "u:" + user.id, uv = usageView(key);
  return {
    plan: { active, until: user.plan && user.plan.until || null, daysLeft: active ? Math.ceil((Date.parse(user.plan.until) - now) / 86400000) : 0,
      freeTasks: TASKS.filter(x => !isPaidTask(x)).length },
    today: { studyUsed: Math.round(uv.studyMax - uv.studyLeft), studyMax: uv.studyMax, voiceUsed: Math.round(uv.voiceMax - uv.voiceLeft), voiceMax: uv.voiceMax },
    createdAt: user.createdAt || null,
    activity, streak, week, sections, history, weeks: weeksOut, hardTop,
    totals: { minutes90: Math.round(sum(d90, st) / 60), activeDays90: d90.filter(d => st(d) > 0).length }
  };
}
function cabinetView(user) {
  const P = progress(user);
  const tasks = TASKS.map(t => {
    const x = P.tasks[t.id] || {};
    return { id: t.id, no: t.no, title: t.title, total: t.steps.length, completions: x.completions || 0,
      status: x.completions ? "done" : x.inProgress ? "progress" : "new",
      solved: x.inProgress ? x.inProgress.solved : 0, again: !!(x.completions && x.inProgress), lastFirstTry: x.lastFirstTry || 0 };
  });
  const skills = Object.entries(P.skills).map(([name, v]) => {
    const pct = v.steps ? v.firstTry / v.steps : 0;
    const level = (pct < 0.5 || (v.steps && v.helped / v.steps >= 0.3)) ? "repeat" : pct < 0.8 ? "train" : "good";
    return { name, steps: v.steps, firstTry: v.firstTry, helped: v.helped, level };
  }).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.name.localeCompare(b.name, "ru"));
  const totalSteps = skills.reduce((n, x) => n + x.steps, 0), first = skills.reduce((n, x) => n + x.firstTry, 0);
  const lessons = P.lessons.slice(-5).reverse().map(l => {
    const t = taskById(l.task) || {};
    return { at: l.at, no: t.no || l.task, title: t.title || "", firstTry: l.firstTry, total: l.total, hard: l.hard || [] };
  });
  return {
    email: user.email, child: user.child, subject: SUBJECT, startedAt: P.firstLessonAt, lastAt: P.lastLessonAt,
    summary: { tasksTotal: TASKS.length, tasksDone: tasks.filter(t => t.status === "done").length, lessons: P.lessons.length,
      firstTryPct: totalSteps ? Math.round(100 * first / totalSteps) : null },
    tasks, skills, lessons, ...cabinetExtra(user, tasks)
  };
}

/* ---------- проверка ответа ---------- */
function isCorrect(step, a) {
  if (step.type === "choice") return Number.isInteger(a) && a === step.correct;
  if (step.type === "number") return Number.isInteger(a) && a === step.answer;
  return Array.isArray(a) && a.length === step.answer.length && a.every((v, i) => Number.isInteger(v) && v === step.answer[i]);
}
function answerText(step) {
  if (step.type === "choice") return step.options[step.correct];
  if (step.type === "number") return String(step.answer);
  return step.fields.map((f, i) => f + " = " + step.answer[i]).join(", ");
}

/* ---------- проверка полей ---------- */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const WEAK_PINS = new Set(["0123", "1234", "2345", "3456", "4567", "5678", "6789", "3210", "4321", "5432", "6543", "7654", "8765", "9876", "2580", "1212", "1122"]);
function pinProblem(pin) {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return "PIN должен состоять из 4 цифр.";
  if (/^(\d)\1{3}$/.test(pin) || WEAK_PINS.has(pin)) return "Этот PIN слишком простой, его легко угадать. Выберите другой.";
  return null;
}
const cleanName = n => typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 30) : "";

/* ---------- HTTP ---------- */
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/listik.html": ["listik.html", "text/html; charset=utf-8"],
  "/start.html": ["start.html", "text/html; charset=utf-8"],
  "/pricing.html": ["pricing.html", "text/html; charset=utf-8"],
  "/about.html": ["about.html", "text/html; charset=utf-8"],
  "/hidden-blocks.html": ["hidden-blocks.html", "text/html; charset=utf-8"],
  "/admin": ["admin.html", "text/html; charset=utf-8"],
  "/admin.html": ["admin.html", "text/html; charset=utf-8"],
  "/site.css": ["site.css", "text/css; charset=utf-8"],
  "/img/hero-boy.jpg": ["img/hero-boy.jpg", "image/jpeg"],
  "/img/tired-girl.jpg": ["img/tired-girl.jpg", "image/jpeg"],
  "/img/happy-girl.jpg": ["img/happy-girl.jpg", "image/jpeg"],
  "/img/think-boy.webp": ["img/think-boy.webp", "image/webp"],
  "/img/aha-girl.webp": ["img/aha-girl.webp", "image/webp"],
  "/img/logo.png": ["img/logo.png", "image/png"],
  "/img/logo_footer.png": ["img/logo_footer.png", "image/png"],
  "/img/hero-boy.webp": ["img/hero-boy.webp", "image/webp"],
  "/img/tired-girl.webp": ["img/tired-girl.webp", "image/webp"],
  "/img/happy-girl.webp": ["img/happy-girl.webp", "image/webp"],
  "/fonts/Unbounded.woff2": ["fonts/Unbounded.woff2", "font/woff2"],
  "/fonts/Manrope-latin.woff2": ["fonts/Manrope-latin.woff2", "font/woff2"],
  "/fonts/Manrope-cyrillic.woff2": ["fonts/Manrope-cyrillic.woff2", "font/woff2"],
  "/fonts/Manrope-cyrillic-ext.woff2": ["fonts/Manrope-cyrillic-ext.woff2", "font/woff2"],
  "/fonts/Onest.woff2": ["fonts/Onest.woff2", "font/woff2"],
  "/fonts/Nunito-800-cyrillic.woff2": ["fonts/Nunito-800-cyrillic.woff2", "font/woff2"],
  "/fonts/Nunito-800-latin.woff2": ["fonts/Nunito-800-latin.woff2", "font/woff2"],
  "/fonts/Nunito-var-cyrillic.woff2": ["fonts/Nunito-var-cyrillic.woff2", "font/woff2"],
  "/fonts/Nunito-var-latin.woff2": ["fonts/Nunito-var-latin.woff2", "font/woff2"],
  "/fonts/Caveat.woff2": ["fonts/Caveat.woff2", "font/woff2"],
  "/data/public/phrases.json": ["data/public/phrases.json", "application/json; charset=utf-8"],
  "/data/public/prompts.json": ["data/public/prompts.json", "application/json; charset=utf-8"]
};
const send = (res, code, obj) => {
  if (code === 429) M.r429++; else if (code === 500) M.err++;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(code); res.end(JSON.stringify(obj));
};
function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 4096) { reject(new Error("big")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
/* За прокси (Render, Cloudflare) настоящий адрес — не первый, а TRUST_HOPS+1-й с конца в X-Forwarded-For: левые записи клиент
   подделывает сам, а прокси дописывают свои справа. TRUST_HOPS = сколько прокси дописали адрес после клиента (по умолчанию 1).
   Проверить на Render: DEBUG_IP=1 печатает в лог первые заголовки и выбранный адрес. */
const TRUST_HOPS = process.env.TRUST_HOPS === undefined ? 1 : Math.max(0, Number(process.env.TRUST_HOPS) || 0);
let ipDebug = process.env.DEBUG_IP === "1" ? 6 : 0;
const clientIp = req => {
  const h = req.headers["x-forwarded-for"];
  if (!TRUST_PROXY || !h) return req.socket.remoteAddress;
  const parts = String(h).split(",").map(x => x.trim()).filter(Boolean);
  const ip = parts.length ? (parts[parts.length - 1 - TRUST_HOPS] || parts[0]) : req.socket.remoteAddress;
  if (ipDebug > 0) { ipDebug--; console.log("[ip] X-Forwarded-For=" + h + " | сокет=" + req.socket.remoteAddress + " -> " + ip); }
  return ip;
};
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}

async function verifyPin(res, a, pin) {
  const key = "pin:" + a.user.id;
  if (tooMany(key, 5, 10 * MIN)) { send(res, 429, { error: "locked" }); return false; }
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin) || !(await checkSecret(pin, "pin", a.user.pin))) {
    hit(key); send(res, 200, { ok: false }); return false;
  }
  buckets.delete(key);
  return true;
}
async function verifyPassword(res, a, password) {
  const key = "pw:" + a.user.id;
  if (tooMany(key, 5, 10 * MIN)) { send(res, 429, { error: "locked" }); return false; }
  if (typeof password !== "string" || !(await checkSecret(password, "pass", a.user.pass))) {
    hit(key); send(res, 200, { ok: false }); return false;
  }
  buckets.delete(key);
  return true;
}

/* ---------- время занятий ----------
   До 45 минут занятий в день (голос и программа вместе); голос может звучать все 45 минут; когда время вышло, «тихий режим».
   Время считает сервер по сигналам страницы (раз в 15 секунд), а не браузер: перезагрузка страницы лимит не сбрасывает.
   Ключ: вошедший кабинет, иначе IP. Сутки по Казахстану (UTC+5). Переменные: STUDY_DAY_MIN, VOICE_DAY_MIN. */
/* Настройки, которые владелец меняет в админ-панели (storage/settings.json). Значения по умолчанию берутся из переменных окружения. */
const SETTINGS_FILE = path.join(STORE_DIR, "settings.json");
const SETTINGS = { studyDayMin: Number(process.env.STUDY_DAY_MIN || 45), voiceDayMin: Number(process.env.VOICE_DAY_MIN || 45), registrationOpen: true, voiceEnabled: true };
try { Object.assign(SETTINGS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))); } catch (e) {}
function saveSettings() { try { const tmp = SETTINGS_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(SETTINGS, null, 2), { mode: 0o600 }); fs.renameSync(tmp, SETTINGS_FILE); } catch (e) { console.error(e); } }
const USAGE_FILE = path.join(STORE_DIR, "usage.json");
let USAGE = {};
try { USAGE = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")); } catch (e) { USAGE = {}; }
const dayStamp = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
let usageTimer = null;
function flushUsage() {
  if (usageTimer) { clearTimeout(usageTimer); usageTimer = null; }
  const d = dayStamp();
  for (const k of Object.keys(USAGE)) if (USAGE[k].day !== d) delete USAGE[k];
  try { const tmp = USAGE_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(USAGE), { mode: 0o600 }); fs.renameSync(tmp, USAGE_FILE); } catch (e) {}
}
function scheduleUsageSave() { if (!usageTimer) usageTimer = setTimeout(flushUsage, 5000); }
const usageKey = (a, ip) => a ? "u:" + a.user.id : "ip:" + ip;
function usageOf(key) {
  const d = dayStamp();
  let u = USAGE[key];
  if (!u || u.day !== d) u = USAGE[key] = { day: d, study: 0, voice: 0, last: 0 };
  return u;
}
/* Лимит в секундах на сегодня: общий (или личный, если владелец задал его ученику) плюс разовая добавка на сегодня. */
function limitsFor(key) {
  let study = SETTINGS.studyDayMin, voice = SETTINGS.voiceDayMin;
  if (key.startsWith("u:")) {
    const usr = USERS.find(x => x.id === key.slice(2));
    if (usr && usr.limits) {
      if (Number.isFinite(usr.limits.study)) study = usr.limits.study;
      if (Number.isFinite(usr.limits.voice)) voice = usr.limits.voice;
    }
  }
  const r = usageOf(key);
  return { study: Math.max(0, study * 60 + (r.bonusStudy || 0)), voice: Math.max(0, voice * 60 + (r.bonusVoice || 0)) };
}
const usageView = key => {
  const u = usageOf(key), L = limitsFor(key);
  return { studyLeft: Math.max(0, Math.round(L.study - u.study)), studyMax: L.study, voiceLeft: Math.max(0, Math.round(L.voice - u.voice)), voiceMax: L.voice };
};
const studyOver = key => usageOf(key).study >= limitsFor(key).study;
const voiceOver = key => usageOf(key).voice >= limitsFor(key).voice;

async function api(req, res, url) {
  const ip = clientIp(req);
  const a = currentAuth(req);
  const who = a ? "u" + a.user.id : ip;   // лимиты частоты: по кабинету, если вошли (школа и мобильный интернет дают одному адресу много детей)

  if (req.method === "GET") {
    if (url === "/api/tasks") return send(res, 200, { tasks: tasksFor(a), sections: TASKS_FILE.sections || [] });
    if (url.startsWith("/api/task/")) {
      let id = ""; try { id = decodeURIComponent(url.slice(10)); } catch (e) {}
      const t = taskById(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (taskLocked(t, a)) return send(res, 403, { error: "paid_only" });
      return send(res, 200, { task: Object.assign({}, publicById.get(id), { locked: false }) });
    }
    if (url === "/api/me") return send(res, 200, { user: a ? publicUser(a) : null });
    if (url === "/api/voice/available") return send(res, 200, { ok: !!OPENAI_KEY && SETTINGS.voiceEnabled && (!!a || VOICE_GUESTS) });
    if (url === "/api/usage") return send(res, 200, usageView(usageKey(a, ip)));
    if (url === "/api/cabinet") return isParent(a) ? send(res, 200, cabinetView(a.user)) : send(res, a ? 403 : 401, { error: "parent_required" });
    return send(res, 404, { error: "not_found" });
  }
  if (req.method !== "POST" || !sameOrigin(req) || !String(req.headers["content-type"] || "").includes("application/json"))
    return send(res, 403, { error: "forbidden" });
  if (url === "/api/voice/turn") return voiceTurn(req, res, ip, a);
  let b;
  try { b = await body(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }

  /* --- админ-панель владельца (вход по отдельному паролю ADMIN_PASSWORD из .env) --- */
  if (url.startsWith("/api/admin/")) return ADMIN(req, res, url, ip, b);

  /* --- кабинет: регистрация и вход --- */
  if (url === "/api/register") {
    if (!SETTINGS.registrationOpen) return send(res, 403, { error: "closed", message: "Регистрация новых кабинетов пока закрыта. Напишите нам в WhatsApp." });
    if (tooMany("reg:" + ip, 10, 60 * MIN)) return send(res, 429, { error: "too_many" });
    hit("reg:" + ip);
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) return send(res, 400, { error: "email", message: "Проверьте адрес почты." });
    if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 100)
      return send(res, 400, { error: "password", message: "Пароль должен быть не короче 8 символов." });
    const pp = pinProblem(b.pin);
    if (pp) return send(res, 400, { error: "pin", message: pp });
    const name = cleanName(b.childName);
    if (!name) return send(res, 400, { error: "child", message: "Введите имя или псевдоним ребёнка (без фамилии)." });
    if (USERS.some(u => u.email === email)) return send(res, 409, { error: "exists", message: "Не получилось создать кабинет. Возможно, этот адрес уже занят: попробуйте войти." });
    const user = {
      id: crypto.randomBytes(8).toString("hex"), email,
      pass: await hashSecret(b.password, "pass"), pin: await hashSecret(b.pin, "pin"),
      child: { name, grade: 3 }, createdAt: new Date().toISOString(), progress: null
    };
    USERS.push(user); saveUsers();
    MAIL.welcome(email, name, siteUrl(req)).catch(mailFail);      // письмо не задерживает ответ и не ломает регистрацию, если почта недоступна
    startLogin(res, user);
    return send(res, 200, { user: { email, child: user.child, parent: false } });
  }
  if (url === "/api/login") {
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (tooMany("login:" + ip, 30, 10 * MIN) || tooMany("login:" + email, 8, 10 * MIN)) return send(res, 429, { error: "too_many" });
    const user = USERS.find(u => u.email === email);
    const ok = typeof b.password === "string" && await checkSecret(b.password, "pass", user ? user.pass : DUMMY);
    if (!user || !ok) {
      console.log("[вход не удался] " + (user ? "почта найдена, пароль не подошёл" : "такой почты нет среди " + USERS.length + " кабинетов") + " (" + maskEmail(email) + ")");
      hit("login:" + ip); hit("login:" + email); return send(res, 401, { error: "login", message: "Неверный адрес или пароль." });
    }
    if (user.blocked) return send(res, 403, { error: "blocked", message: "Доступ к этому кабинету закрыт. Напишите нам в WhatsApp, мы поможем." });
    startLogin(res, user);
    return send(res, 200, { user: { email: user.email, child: user.child, parent: false, plan: hasPlan({ user }) ? { until: user.plan.until } : null } });
  }
  /* --- забыли пароль: письмо со ссылкой (ответ всегда одинаковый, чтобы нельзя было выяснить, какие адреса зарегистрированы) --- */
  if (url === "/api/password/forgot") {
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (tooMany("fgt:" + ip, 6, 60 * MIN) || tooMany("fgt:" + email, 3, 60 * MIN)) return send(res, 429, { error: "too_many" });
    hit("fgt:" + ip); hit("fgt:" + email);
    const user = EMAIL_RE.test(email) ? USERS.find(u => u.email === email) : null;
    if (user && !user.blocked) MAIL.passwordReset(user.email, siteUrl(req) + "/listik.html#reset=" + resetToken(user)).catch(mailFail);
    return send(res, 200, { ok: true });
  }
  if (url === "/api/password/reset") {
    if (tooMany("rst:" + ip, 10, 60 * MIN)) return send(res, 429, { error: "too_many" });
    hit("rst:" + ip);
    if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 100)
      return send(res, 400, { error: "password", message: "Пароль должен быть не короче 8 символов." });
    const user = userByResetToken(b.token);
    if (!user) return send(res, 400, { error: "token", message: "Ссылка устарела или уже использована. Запросите новую." });
    user.pass = await hashSecret(b.password, "pass"); saveUsers();
    for (const [k, v] of auth) if (v.uid === user.id) auth.delete(k);      // старые входы закрываем
    startLogin(res, user);
    return send(res, 200, { user: { email: user.email, child: user.child, parent: false, plan: hasPlan({ user }) ? { until: user.plan.until } : null } });
  }
  if (url === "/api/logout") {
    if (a) auth.delete(a.token);
    setLoginCookie(res, "", 0);
    return send(res, 200, { ok: true });
  }

  /* --- кабинет: вход в режим родителя по PIN --- */
  if (url === "/api/parent/enter") {
    if (!a) return send(res, 401, { error: "login" });
    if (!(await verifyPin(res, a, b.pin))) return;
    a.s.parentUntil = Date.now() + PARENT_TTL;
    return send(res, 200, { ok: true, user: publicUser(a) });
  }
  if (url === "/api/parent/leave") { if (a) a.s.parentUntil = 0; return send(res, 200, { ok: true }); }
  if (url === "/api/parent/child") {
    if (!isParent(a)) return send(res, 403, { error: "parent_required" });
    const name = cleanName(b.childName);
    if (!name) return send(res, 400, { error: "child", message: "Введите имя или псевдоним ребёнка (без фамилии)." });
    a.user.child.name = name; saveUsers();
    return send(res, 200, { ok: true, user: publicUser(a) });
  }
  /* смена PIN (и «Забыли PIN»): всегда нужен пароль от кабинета, ребёнок его не знает */
  if (url === "/api/pin/change") {
    if (!a) return send(res, 401, { error: "login" });
    const pp = pinProblem(b.newPin);
    if (pp) return send(res, 400, { error: "pin", message: pp });
    if (!(await verifyPassword(res, a, b.password))) return;
    a.user.pin = await hashSecret(b.newPin, "pin"); saveUsers();
    buckets.delete("pin:" + a.user.id);
    return send(res, 200, { ok: true });
  }

  /* --- время занятий: страница раз в 15 секунд сообщает, идёт ли занятие и звучит ли голос --- */
  if (url === "/api/usage/ping") {
    if (tooMany("uping:" + who, 40, MIN)) return send(res, 429, { error: "too_many" });
    hit("uping:" + who);
    const ukey0 = usageKey(a, ip), u = usageOf(ukey0), now = Date.now();
    const dt = u.last && now - u.last < 60000 ? Math.min(now - u.last, 20000) / 1000 : 0;   // не больше реально прошедшего времени
    u.last = now;
    if (b.active === true) u.study += dt;
    if (b.voice === true) u.voice += dt;
    if (a && dt > 0 && (b.active === true || b.voice === true)) {     // история по дням для админ-панели
      const L = a.user.usageLog || (a.user.usageLog = {}), d = dayStamp(), e = L[d] || (L[d] = { study: 0, voice: 0 });
      if (b.active === true) {
        e.study = Math.round((e.study + dt) * 10) / 10;
        const tk = typeof b.task === "string" ? taskById(b.task) : null;      // время по разделам предмета
        if (tk && tk.section) { const sec = e.sec || (e.sec = {}); sec[tk.section] = Math.round(((sec[tk.section] || 0) + dt) * 10) / 10; }
      }
      if (b.voice === true) e.voice = Math.round((e.voice + dt) * 10) / 10;
      const days = Object.keys(L).sort(); while (days.length > 90) delete L[days.shift()];
      scheduleSave();
    }
    scheduleUsageSave();
    return send(res, 200, usageView(ukey0));
  }

  /* --- голос: начало занятия с голосом --- */
  if (url === "/api/voice/session") {
    if (!OPENAI_KEY || !SETTINGS.voiceEnabled) return send(res, 503, { error: "no_key" });
    if (!a && !VOICE_GUESTS) return send(res, 401, { error: "login" });
    if (tooMany("voice:" + who, 20, 60 * MIN)) return send(res, 429, { error: "too_many" });
    hit("voice:" + who);
    const ukey = usageKey(a, ip);
    if (studyOver(ukey)) return send(res, 403, { error: "day_limit" });
    if (voiceOver(ukey)) return send(res, 403, { error: "voice_limit" });
    const instructions = VOICE_PROMPT + (a && a.user.child && a.user.child.name ? "\n\nРебёнка зовут " + a.user.child.name + ". Можно изредка обращаться по имени." : "");
    const sid = crypto.randomBytes(16).toString("hex");
    voiceSessions.set(sid, { instructions, created: Date.now(), last: null, pending: [], turns: 0, ukey });
    return send(res, 200, { sid });
  }

  /* --- занятие --- */
  const stateKey = a ? "u:" + a.user.id : (typeof b.session === "string" && /^[a-f0-9]{32}$/.test(b.session) ? "s:" + b.session : null);
  const ps = stateKey && playState(stateKey, ip);
  if (!ps) return send(res, 400, { error: "bad_session" });
  const task = taskById(b.task);
  if (!task) return send(res, 400, { error: "bad_step" });
  if ((url === "/api/start" || url === "/api/check") && taskLocked(task, a)) return send(res, 403, { error: "paid_only" });
  if ((url === "/api/start" || url === "/api/check") && studyOver(usageKey(a, ip))) return send(res, 403, { error: "day_limit" });
  if (url === "/api/start") {
    /* новый заход в задачу: счётчики занятия обнуляются, блокировки шагов остаются */
    for (const [k, v] of ps.steps) if (k.startsWith(task.id + ":")) { v.errors = 0; v.helped = false; v.solved = false; }
    if (a) { const P = progress(a.user); if (!P.firstLessonAt) P.firstLessonAt = new Date().toISOString(); scheduleSave(); }
    return send(res, 200, { ok: true });
  }
  const step = Number.isInteger(b.step) ? task.steps[b.step] : null;
  if (!step) return send(res, 400, { error: "bad_step" });
  const st = stepState(ps, task.id, b.step);

  if (url === "/api/check") {
    if (tooMany("chk:" + who, 120, MIN)) return send(res, 429, { error: "too_many" });
    hit("chk:" + who);
    if (st.locked) return send(res, 423, { locked: true, rule: step.rule });
    if (isCorrect(step, b.answer)) {
      st.attempts = 0;
      if (!st.solved) { st.solved = true; if (a) recordSolved(a.user, task, ps, b.step, st); }
      return send(res, 200, { correct: true, ok: step.ok, note: step.note || null });
    }
    st.errors++; st.attempts++;
    if (st.attempts >= MAX_ATTEMPTS) st.locked = true;
    return send(res, 200, { correct: false, attempts: st.attempts, locked: st.locked, rule: step.rule, similar: st.attempts >= 2 ? task.similar : null });
  }
  if (url === "/api/unlock") {
    if (!a) return send(res, 403, { error: "guest" });
    if (!st.locked) return send(res, 409, { error: "not_locked" });
    if (!(await verifyPin(res, a, b.pin))) return;
    st.locked = false; st.attempts = MAX_ATTEMPTS - 1; st.helped = true;
    return send(res, 200, { ok: true, answer_text: CONFIG.reveal_answer_to_adult ? answerText(step) : null });
  }
  return send(res, 404, { error: "not_found" });
}

/* ---------- нагрузка: раз в минуту снимок показателей, на вкладке «Нагрузка» в админ-панели видно последний час ----------
   Данные хранятся только в памяти: после перезапуска сервера график начинается заново. */
const { monitorEventLoopDelay } = require("perf_hooks");
const os = require("os");
const EL_RES = 20;
const elDelay = monitorEventLoopDelay({ resolution: EL_RES }); elDelay.enable();
const lagMs = ns => Math.max(0, Math.round(ns / 1e6 - EL_RES));          // таймер и без нагрузки приходит с опозданием в EL_RES мс
const MEM_LIMIT_MB = (() => {                                              // лимит памяти контейнера (на Render задан тарифом), иначе вся память машины
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try { const n = Number(fs.readFileSync(f, "utf8").trim()); if (n > 0 && n < 2 ** 45) return Math.round(n / 1048576); } catch (e) {}
  }
  return Math.round(os.totalmem() / 1048576);
})();
function activeNow() {                                                     // страницы отправляли «пинг времени» за последние 45 с
  const now = Date.now(), day = dayStamp(); let users = 0, guests = 0;
  for (const [k, r] of Object.entries(USAGE)) if (r.day === day && r.last && now - r.last < 45000) (k.startsWith("u:") ? users++ : guests++);
  return { users, guests, total: users + guests };
}
function voiceActiveNow() { const now = Date.now(); let n = 0; for (const v of voiceSessions.values()) if (now - (v.seen || v.created) < 60000) n++; return n; }
let prevM = { turns: 0, busy: 0, fail: 0, o429: 0, r429: 0, err: 0 }, lastCpu = process.cpuUsage(), lastCpuAt = Date.now();
setInterval(() => {
  const now = Date.now(), c = process.cpuUsage(lastCpu), el = Math.max(1, now - lastCpuAt);
  lastCpu = process.cpuUsage(); lastCpuAt = now;
  const s = { t: now, kids: activeNow().total, voice: voiceActiveNow(), peak: M.peak, saveMax: M.saveMax,
    rss: Math.round(process.memoryUsage().rss / 1048576), cpu: Math.round(100 * (c.user + c.system) / 1000 / el),
    lagP99: lagMs(elDelay.percentile(99)), lagMax: lagMs(elDelay.max) };
  for (const k of Object.keys(prevM)) { s[k] = M[k] - prevM[k]; prevM[k] = M[k]; }
  elDelay.reset(); M.peak = voiceBusy; M.saveMax = 0;
  M.hist.push(s); if (M.hist.length > 180) M.hist.shift();
}, Number(process.env.METRICS_SAMPLE_MS || 60000)).unref();
const fmtDur = ms => { const m = Math.floor(ms / 60000); return m < 60 ? m + " мин" : m < 1440 ? Math.floor(m / 60) + " ч " + (m % 60) + " мин" : Math.floor(m / 1440) + " дн. " + Math.floor((m % 1440) / 60) + " ч"; };
/* Пороги (те же в таблице «Как читать» на странице): норма / наблюдать / пора действовать */
function loadSnapshot() {
  const h = M.hist.slice(-60), sum = k => h.reduce((n, s) => n + (s[k] || 0), 0), mx = k => h.reduce((m, s) => Math.max(m, s[k] || 0), 0);
  const act = activeNow(), vNow = voiceActiveNow(), rss = Math.round(process.memoryUsage().rss / 1048576);
  const st = (v, warn, bad) => v >= bad ? "bad" : v >= warn ? "warn" : "ok";
  const last = M.hist[M.hist.length - 1], cards = [];
  const add = (id, title, value, sub, state, advice) => cards.push({ id, title, value: String(value), sub, state, advice: advice || "" });

  add("kids", "Занимаются сейчас", act.total, "вошли в кабинет: " + act.users + " · гостей: " + act.guests + " (гости с одного адреса считаются за одного)", "info");

  const peakH = Math.max(mx("peak"), voiceBusy), busyH = sum("busy");
  const vState = busyH > 0 ? "bad" : st(100 * peakH / VOICE_MAX_INFLIGHT, 50, 80);
  add("voice", "Голос: ходов в обработке", voiceBusy + " из " + VOICE_MAX_INFLIGHT,
    "говорят сейчас: " + vNow + " · пик за час: " + peakH + " · отказов «занято»: " + busyH + " · ходов за час: " + sum("turns"), vState,
    busyH > 0 ? "Были отказы «занято»: дети слышали «скажи ещё раз». Если память в норме (см. карточку «Память»), поднимите VOICE_MAX_INFLIGHT в переменных Render (сейчас " + VOICE_MAX_INFLIGHT + "). Если память близка к пределу, нужен тариф выше или второй экземпляр."
    : "Пик голосовых ходов близок к потолку. Если память позволяет, заранее поднимите VOICE_MAX_INFLIGHT в переменных Render.");

  const rssH = Math.max(mx("rss"), rss), memPct = Math.round(100 * rss / MEM_LIMIT_MB);
  add("mem", "Память", memPct + "%", rss + " МБ из " + MEM_LIMIT_MB + " МБ · максимум за час: " + rssH + " МБ", st(100 * rssH / MEM_LIMIT_MB, 60, 80),
    "Память почти исчерпана: при превышении Render перезапустит сервер, и все выйдут из кабинетов. Поднимите тариф или уменьшите VOICE_MAX_INFLIGHT.");

  const c10 = M.hist.slice(-10), cpuAvg = c10.length ? Math.round(c10.reduce((n, s) => n + s.cpu, 0) / c10.length) : 0;
  add("cpu", "Процессор", last ? last.cpu + "%" : "—", "доля одного ядра · среднее за 10 минут: " + cpuAvg + "% · максимум за час: " + mx("cpu") + "%", st(cpuAvg, 60, 85),
    "Сервер на Node использует одно ядро, поэтому тариф с большим числом ядер не поможет. Нужны несколько экземпляров: сначала перенос кабинетов в Postgres и вынос сессий из памяти.");

  const lagH = mx("lagP99");
  add("lag", "Задержка сервера", last ? last.lagP99 + " мс" : "—", "в 99% случаев за последнюю минуту · наибольшая за час: " + lagH + " мс (самый длинный простой: " + mx("lagMax") + " мс)", st(lagH, 50, 200),
    "Сервер «замирает» и все запросы ждут. Чаще всего причина — сохранение кабинетов (см. карточку «Сохранение кабинетов») или перегруженный процессор.");

  const saveH = Math.max(mx("saveMax"), M.saveMax);
  add("save", "Сохранение кабинетов", M.saveCount ? M.saveMs + " мс" : "—", "семей: " + USERS.length + " · файл ≈ " + (M.saveBytes / 1048576).toFixed(1) + " МБ · самое долгое за час: " + saveH + " мс", st(saveH, 150, 400),
    saveH >= 400 ? "Каждое сохранение останавливает весь сервер. Пора переносить кабинеты из users.json в базу данных (Postgres)."
    : "Сохранение заметно тормозит сервер. Приготовьтесь к переносу кабинетов в Postgres (ориентир — 1000–2000 семей).");

  const failH = sum("fail"), o429H = sum("o429");
  add("openai", "Ошибки голоса за час", failH, "из них отказы OpenAI по лимиту (429): " + o429H, o429H > 0 ? "bad" : failH >= 5 ? "warn" : "ok",
    o429H > 0 ? "OpenAI отклоняет запросы из-за лимита. Проверьте лимиты в своём кабинете OpenAI (запросов в минуту) и повысьте тариф: один говорящий ребёнок делает около 12 запросов в минуту."
    : "Есть ошибки связи с OpenAI (распознавание, модель или озвучка). Если повторяются, проверьте статус OpenAI и ключ, смотрите строки «[голос:…]» в логах Render.");

  const r429H = sum("r429"), errH = sum("err");
  let lState = st(r429H, 20, 100); if (lState === "ok" && errH > 0) lState = "warn";
  add("limits", "Отказы по частоте за час", r429H, "ошибок сервера (500) за час: " + errH, lState,
    errH > 0 && r429H < 20 ? "Были внутренние ошибки сервера (500). Посмотрите логи Render."
    : "Много отказов «слишком часто». Если дети из одной школы заходят без кабинета, у них общий лимит на адрес: заведите кабинеты. Иначе возможна атака: проверьте журнал и что TRUST_PROXY=1.");

  add("play", "Сессии занятий в памяти", play.size, "из " + PLAY_MAX + " · вошедших в кабинет: " + auth.size, st(100 * play.size / PLAY_MAX, 50, 80),
    "Таблица почти заполнена, старые записи вытесняются. Это признак большого наплыва гостей или атаки.");

  add("uptime", "Работает без перезапуска", fmtDur(Date.now() - M.started), "после каждого деплоя и перезапуска все выходят из кабинетов, а график ниже начинается заново", "info");

  const rank = { ok: 0, info: 0, warn: 1, bad: 2 }, worst = cards.reduce((m, c) => Math.max(m, rank[c.state]), 0);
  const verdict = [
    { state: "ok", text: "Всё в порядке: нагрузка далека от пределов." },
    { state: "warn", text: "Есть за чем следить: часть показателей приближается к пределу. Подсказки ниже." },
    { state: "bad", text: "Пора действовать: хотя бы один показатель в красной зоне. Подсказки ниже." }][worst];
  return { verdict, cards, hist: h.map(s => ({ t: s.t, kids: s.kids, peak: s.peak, turns: s.turns, lag: s.lagMax, rss: s.rss })), samples: M.hist.length };
}

const ADMIN = require("./admin_panel.js")({
  users: () => USERS, metrics: loadSnapshot, saveUsers, usage: () => USAGE, usageOf, flushUsage, dayStamp, limitsFor, SETTINGS, saveSettings,
  cabinetView, hasPlan, hashSecret, TASKS, SECTIONS: () => TASKS_FILE.sections || [], SUBJECT, EMAIL_RE, auth, tooMany, hit, buckets, send, STORE_DIR, COOKIE_SECURE, parseCookies, voiceSessions,
  envDefaults: { study: Number(process.env.STUDY_DAY_MIN || 45), voice: Number(process.env.VOICE_DAY_MIN || 45) }
});

http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url.startsWith("/api/")) return api(req, res, url).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, { error: "server" }); });
  let f = STATIC[url];
  const lm = /^\/img\/lessons\/([\w-]+)\.(png|jpg|webp|svg)$/.exec(url);
  if (!f && lm) f = ["img/lessons/" + lm[1] + "." + lm[2], { png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" }[lm[2]]];
  if (!f || req.method !== "GET") { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Не найдено"); }
  fs.readFile(path.join(ROOT, f[0]), (err, data) => {
    if (err) { res.writeHead(404); return res.end("Не найдено"); }
    const hdr = { "Content-Type": f[1], "Cache-Control": f[0] === "admin.html" ? "no-store" : "no-cache" };
    if (f[0] === "admin.html") hdr["X-Robots-Tag"] = "noindex, nofollow";
    res.writeHead(200, hdr);
    res.end(data);
  });
}).listen(PORT, () => {
  console.log("Листик: http://localhost:" + PORT);
  console.log(OPENAI_KEY ? "Голос: включён (дешёвая схема: " + STT_MODEL + " + " + LLM_MODEL + " + " + TTS_MODEL + ")" : "Голос: выключен (нет OPENAI_API_KEY в файле .env)");
  console.log("Кабинетов в базе: " + USERS.length + " (файл: " + USERS_FILE + ")");
  console.log(TRUST_PROXY ? "Прокси: TRUST_PROXY=1, TRUST_HOPS=" + TRUST_HOPS + " (DEBUG_IP=1 покажет, какой адрес выбирается)"
    : "Прокси: TRUST_PROXY не задан. Если сервер стоит за прокси (Render), все посетители будут выглядеть как один адрес!");
  console.log("Голос: " + (VOICE_GUESTS ? "доступен и без входа" : "только после входа в кабинет") + "; одновременных ходов не больше " + VOICE_MAX_INFLIGHT + ", на кабинет до " + VOICE_USER_TURNS_DAY + " в сутки, на сайт до " + VOICE_GLOBAL_DAY);
  if (STORE_DIR === path.join(ROOT, "storage") && process.env.RENDER) console.log("ВНИМАНИЕ: STORE_DIR не задан. На Render без Persistent Disk кабинеты и подписки пропадут при деплое.");
});
