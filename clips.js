"use strict";
/* Готовые озвученные реплики Листика.
   Тексты шагов (вопрос, «верно», правило, подсказки под ошибки) написаны учителями и не меняются, поэтому
   озвучиваем их ОДИН РАЗ заранее и храним как mp3-файлы. Во время урока модель и озвучка не нужны:
   сервер отдаёт файл по номеру (хешу текста), браузер играет его сразу.
   Номер = хеш от (модель озвучки + голос + стиль + текст), поэтому смена голоса или правка текста
   даёт новый номер и новый файл, а старые файлы просто не используются. */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const ROOT = __dirname;

try {   // .env читаем и здесь, чтобы build-audio.js работал отдельно от сервера (уже заданные переменные не трогаем)
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {}

/* настройки озвучки: ЕДИНЫЙ источник и для сервера, и для build-audio.js (иначе номера файлов разошлись бы) */
const PROVIDER = (process.env.TTS_PROVIDER || "openai").toLowerCase();      // "openai", "elevenlabs" или "gemini"
const EL = {
  key: process.env.ELEVENLABS_API_KEY || "",
  voice: process.env.ELEVENLABS_VOICE_ID || "",
  model: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2"           // для русского надёжна multilingual_v2; можно попробовать eleven_v3
};
/* Gemini (Google AI Studio): голос Sulafat выбран на слепом тесте 13.11.2026; модель в статусе preview, имя может смениться */
const GM = {
  key: process.env.GEMINI_API_KEY || "",
  style: "Say in Russian, in a warm, friendly, gentle female teacher's voice, speaking to a child aged 8 to 10, at a calm unhurried pace"
};
const config = {
  provider: PROVIDER,
  model: PROVIDER === "elevenlabs" ? EL.model : PROVIDER === "gemini" ? (process.env.TTS_MODEL || "gemini-2.5-flash-preview-tts") : (process.env.TTS_MODEL || "gpt-4o-mini-tts"),
  voice: PROVIDER === "elevenlabs" ? EL.voice : PROVIDER === "gemini" ? (process.env.TTS_VOICE || "Sulafat") : (process.env.TTS_VOICE || process.env.VOICE || "marin"),
  style: PROVIDER === "elevenlabs" ? "" : PROVIDER === "gemini" ? (process.env.TTS_STYLE === undefined ? GM.style : process.env.TTS_STYLE) : process.env.TTS_STYLE === undefined
    ? "Говори по-русски, с русским произношением и русскими ударениями, тепло, дружелюбно и спокойно, не торопясь, как добрая старшая сестра, которая объясняет ребёнку 8–9 лет. Чётко произноси числа."
    : process.env.TTS_STYLE,
  base: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  key: process.env.OPENAI_API_KEY || ""
};
const DIR = process.env.CLIPS_DIR || path.join(ROOT, "clips");

/* «Знаки -> слова»: берём ту же функцию voiceMath, что в listik.html (между метками voiceMath:start/end),
   чтобы сервер и браузер читали тексты одинаково */
function loadVsay() {
  const html = fs.readFileSync(path.join(ROOT, "listik.html"), "utf8");
  const m = /\/\/ voiceMath:start\n([\s\S]*?)\/\/ voiceMath:end/.exec(html);
  if (!m) throw new Error("в listik.html нет меток voiceMath:start / voiceMath:end");
  const voiceMath = new Function(m[1] + "\nreturn voiceMath;")();
  const plain = s => String(s == null ? "" : s).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return s => voiceMath(plain(s));
}
let _vsay = null;
const vsay = s => (_vsay = _vsay || loadVsay())(s);

const clipId = spoken => crypto.createHash("sha1").update((config.provider === "openai" ? [] : [config.provider]).concat([config.model, config.voice, config.style, spoken]).join("\u0001")).digest("hex").slice(0, 16);   // для openai номера те же, что были до смены голоса
const clipFile = id => path.join(DIR, id + ".mp3");
const isId = id => /^[0-9a-f]{16}$/.test(id);

const registry = new Map();     // номер -> озвучиваемый текст (то, что сервер уже видел: тексты шагов и общие фразы)
function reg(raw) {
  const spoken = vsay(raw);
  if (!spoken) return null;
  const id = clipId(spoken);
  if (!registry.has(id)) registry.set(id, spoken);
  return id;
}

/* общие фразы (приветствие, «пока не так», перерыв…): data/private/voice_clips.json */
function loadGeneral() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data/private/voice_clips.json"), "utf8")); } catch (e) { return {}; }
}
function generalIds() {
  const g = loadGeneral(), out = {};
  for (const [k, arr] of Object.entries(g)) if (Array.isArray(arr)) out[k] = arr.map(reg).filter(Boolean);
  return out;
}

/* все тексты задач, которые можно озвучить заранее */
function registerTasks(tasks) {
  const add = x => { if (x && typeof x === "string") reg(x); };
  for (const t of tasks) {
    add(t.condition); add(t.similar);
    if (t.lesson && Array.isArray(t.lesson.cards)) t.lesson.cards.forEach(c => add(c.text));
    if (t.kind === "lesson" && Array.isArray(t.frames)) t.frames.forEach(f => add(f.say));   // объяснения-ролики: фраза каждого кадра
    for (const s of t.steps || []) {
      add(s.q); add(s.ok); add(s.rule); add(s.similar);
      if (s.wrong) for (const w of Object.values(s.wrong)) add(w && w.hint);
    }
  }
  generalIds();
}

/* ElevenLabs: один запрос -> mp3 */
async function synthEleven(spoken, voiceId) {
  const id = voiceId || EL.voice;
  if (!EL.key || !id) throw new Error("для ElevenLabs нужны ELEVENLABS_API_KEY и ELEVENLABS_VOICE_ID в .env");
  const r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(id) + "?output_format=mp3_44100_128", {
    method: "POST", headers: { "xi-api-key": EL.key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: spoken.slice(0, 1800), model_id: EL.model, language_code: "ru",
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }),
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw new Error("ElevenLabs: " + r.status + " " + (await r.text()).slice(0, 200));
  return Buffer.from(await r.arrayBuffer());
}

/* Gemini: один запрос -> сырой звук (PCM 16 бит, обычно 24 кГц) -> mp3 через ffmpeg (ffmpeg должен быть установлен на машине, где идёт озвучка) */
function pcmToMp3(pcm, rate) {
  return new Promise((resolve, reject) => {
    const cp = require("child_process").spawn("ffmpeg", ["-loglevel", "error", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0", "-b:a", "128k", "-f", "mp3", "pipe:1"]);
    const out = [], err = [];
    cp.stdout.on("data", d => out.push(d)); cp.stderr.on("data", d => err.push(d));
    cp.on("error", e => reject(new Error(e.code === "ENOENT" ? "не найден ffmpeg (Mac: brew install ffmpeg; Ubuntu: apt install ffmpeg)" : e.message)));
    cp.on("close", code => code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error("ffmpeg: " + Buffer.concat(err).toString().slice(0, 200))));
    cp.stdin.on("error", () => {});
    cp.stdin.end(pcm);
  });
}
async function synthGemini(spoken) {
  if (!GM.key) throw new Error("для Gemini нужен GEMINI_API_KEY в .env");
  const models = [config.model];                              // только выбранная модель: запасных нет, чтобы не прятать настоящую ошибку
  let last = "";
  for (const model of models) {
    for (let attempt = 0; attempt < 6; attempt++) {             // 429/5xx: подождать и повторить (лимит запросов у Google)
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
        method: "POST", headers: { "x-goog-api-key": GM.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: (config.style ? config.style + ": " : "") + spoken.slice(0, 1800) }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } } }
        }),
        signal: AbortSignal.timeout(60000)
      });
      if (r.ok) {
        const j = await r.json();
        const part = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0];
        const inl = part && part.inlineData;
        if (!inl || !inl.data) { last = "Gemini: пустой ответ"; break; }
        const rate = +((/rate=(\d+)/.exec(inl.mimeType || "") || [])[1]) || 24000;
        return pcmToMp3(Buffer.from(inl.data, "base64"), rate);
      }
      last = "Gemini " + model + ": " + r.status + " " + (await r.text()).slice(0, 200);
      if (r.status === 404) break;                              // такой модели нет: пробуем следующую
      if (r.status !== 429 && r.status < 500) throw new Error(last);
      await new Promise(res => setTimeout(res, 5000 * (attempt + 1)));
    }
  }
  throw new Error(last);
}

/* чего не хватает для озвучки у выбранного провайдера (пустая строка = всё есть) */
function keyError() {
  if (config.provider === "elevenlabs") return EL.key && EL.voice ? "" : "Нет ELEVENLABS_API_KEY или ELEVENLABS_VOICE_ID в .env";
  if (config.provider === "gemini") return GM.key ? "" : "Нет GEMINI_API_KEY в .env";
  return config.key ? "" : "Нет OPENAI_API_KEY в .env";
}

/* озвучка одного текста -> Buffer (mp3). Без стиля повторяем, если модель его не принимает */
async function synth(spoken, opts) {
  if (config.provider === "elevenlabs") return synthEleven(spoken);
  if (config.provider === "gemini") return synthGemini(spoken);
  let last = "";
  for (const withStyle of [true, false]) {
    if (!config.style && withStyle) continue;
    const body = { model: config.model, voice: config.voice, input: spoken.slice(0, 1800), response_format: "mp3" };
    if (withStyle) body.instructions = config.style;
    const r = await fetch(config.base + "/audio/speech", {
      method: "POST", headers: { Authorization: "Bearer " + config.key, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25000)
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    last = r.status + " " + (await r.text()).slice(0, 200);
  }
  throw new Error("озвучка: " + last);
}

const inflight = new Map();
/* файл для номера: есть на диске -> путь; нет, но текст известен -> озвучиваем один раз (даже если просят 20 детей сразу) */
async function ensure(id, synthFn) {
  const f = clipFile(id);
  if (fs.existsSync(f)) return f;
  const spoken = registry.get(id);
  if (!spoken) return null;
  if (!inflight.has(id)) {
    inflight.set(id, (async () => {
      const buf = await (synthFn || synth)(spoken);
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = f + "." + process.pid + ".tmp";
      fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
      return f;
    })().finally(() => inflight.delete(id)));
  }
  return inflight.get(id);
}
const have = id => fs.existsSync(clipFile(id));

module.exports = { synthEleven, synthGemini, keyError, EL, config, DIR, vsay, clipId, clipFile, isId, reg, registry, registerTasks, generalIds, loadGeneral, synth, ensure, have };
