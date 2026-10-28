/* Отчёт по журналу попыток для теста на живых семьях.
   Запуск: node report.js [папка_хранилища]   (по умолчанию storage; на Render: /var/data)
   Ничего не меняет, только читает файлы log/attempts-*.jsonl. */
"use strict";
const fs = require("fs"), path = require("path");
const dir = path.join(process.argv[2] || process.env.STORE_DIR || path.join(__dirname, "storage"), "log");
if (!fs.existsSync(dir)) { console.log("Журнала пока нет: " + dir); process.exit(0); }
const ev = [];
for (const f of fs.readdirSync(dir).filter(x => /^attempts-.*\.jsonl$/.test(x)).sort())
  for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) { if (l.trim()) try { ev.push(JSON.parse(l)); } catch (e) {} }
if (!ev.length) { console.log("Журнал пуст."); process.exit(0); }
const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "—";
const med = a => { if (!a.length) return null; a = a.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const kids = new Set(ev.map(e => e.u)), reg = [...kids].filter(u => u[0] === "u"), guests = [...kids].filter(u => u[0] === "g");
console.log("Период: " + ev[0].t.slice(0, 10) + " — " + ev[ev.length - 1].t.slice(0, 10) + ", событий: " + ev.length);
console.log("Детей с кабинетом: " + reg.length + ", гостей: " + guests.length + "\n");
console.log("ПО ЗАДАЧАМ (начали → закончили)");
const tasks = {};
for (const e of ev) { const t = tasks[e.task] = tasks[e.task] || { starts: 0, done: 0, ft: 0, tot: 0, ms: [], wrong: 0, checks: 0 };
  if (e.kind === "start") t.starts++; else if (e.kind === "done") { t.done++; t.ft += e.firstTry; t.tot += e.total; }
  else if (e.kind === "check") { t.checks++; if (!e.ok) t.wrong++; if (e.ms != null) t.ms.push(e.ms); } }
for (const [id, t] of Object.entries(tasks).sort()) console.log(("  " + id).padEnd(10) + "начали " + String(t.starts).padStart(3) + ", закончили " + String(t.done).padStart(3) + " (" + pct(t.done, t.starts) + "), с первого раза " + pct(t.ft, t.tot) + ", медиана на шаг " + (med(t.ms) == null ? "—" : Math.round(med(t.ms) / 1000) + " с"));
console.log("\nТИПИЧНЫЕ ОШИБКИ");
const codes = {}; for (const e of ev) if (e.kind === "check" && !e.ok && e.code) codes[e.code] = (codes[e.code] || 0) + 1;
Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([c, n]) => console.log("  " + c.padEnd(22) + n));
if (!Object.keys(codes).length) console.log("  пока нет");
console.log("\nГДЕ ЗАСТРЕВАЮТ (шаги с наибольшей долей ошибок, не меньше 5 ответов)");
const st = {}; for (const e of ev) if (e.kind === "check") { const k = e.task + " шаг " + (e.step + 1) + " (" + e.skill + ")"; const x = st[k] = st[k] || { n: 0, bad: 0, lock: 0 }; x.n++; if (!e.ok) x.bad++; if (e.lock) x.lock++; }
Object.entries(st).filter(([, x]) => x.n >= 5).sort((a, b) => b[1].bad / b[1].n - a[1].bad / a[1].n).slice(0, 8).forEach(([k, x]) => console.log("  " + k + ": ошибок " + pct(x.bad, x.n) + " из " + x.n + (x.lock ? ", блокировок " + x.lock : "")));
console.log("\nВОЗВРАЩЕНИЕ (в какие дни ребёнок начинал задачи)");
const days = {}; for (const e of ev) if (e.kind === "start") (days[e.u] = days[e.u] || new Set()).add(e.t.slice(0, 10));
const dl = Object.values(days).map(s => s.size);
console.log("  детей, начавших задачу: " + dl.length + ", пришли в 2 разных дня и больше: " + dl.filter(n => n >= 2).length + " (" + pct(dl.filter(n => n >= 2).length, dl.length) + "), в 3 дня и больше: " + dl.filter(n => n >= 3).length);
console.log("\nСИГНАЛЫ: усталость " + ev.filter(e => e.kind === "tired").length + ", слова расстройства в голосе " + ev.filter(e => e.kind === "mood").length + ", помощь взрослого (разблокировка) " + ev.filter(e => e.kind === "unlock").length + ", пропущено шагов у освоивших " + ev.filter(e => e.kind === "start").reduce((n, e) => n + (e.skip || []).length, 0));
const qd = ev.filter(e => e.kind === "quizdone"), avg = k => { const a = qd.filter(e => e.quiz === k); return a.length ? Math.round(100 * a.reduce((n, e) => n + e.ok, 0) / a.reduce((n, e) => n + e.total, 0)) + "%" : "—"; };
console.log("ЗНАКОМСТВО И РАЗМИНКА: знакомство пройдено " + qd.filter(e => e.quiz === "diag").length + " раз (верно сразу " + avg("diag") + "), разминка " + qd.filter(e => e.quiz === "warm").length + " раз (верно сразу " + avg("warm") + ")");
const voice = ev.filter(e => e.kind === "check" && e.ch === "voice").length, tap = ev.filter(e => e.kind === "check" && e.ch === "tap").length;
console.log("Ответов голосом: " + voice + ", кнопками: " + tap + " (голосовые ответы могут быть неверно услышаны)");
