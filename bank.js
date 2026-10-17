/* Банк задач Листика: загрузка, проверка арифметики и подключение к тренажёру.
   Без внешних зависимостей (Node 18+).

   Команды (запускать в папке listik):
     node bank.js                          проверить банк (арифметика, подсказки, ссылки)
     node bank.js review                   напечатать лист для учителя
     node bank.js review --out лист.txt    то же, но в файл
     node bank.js approve kr-001 kr-002 --by "Имя учителя"
     node bank.js approve all --by "Имя учителя"
                                           отметить задачи как проверенные учителем

   Главные гарантии:
   1. Каждый ответ и каждый шаг пересчитывается кодом. Если хоть одно число не сходится,
      сервер не подключает банк вообще (и пишет почему).
   2. Ребёнок видит только задачи с отметкой учителя. Отметка привязана к тексту задачи
      (хеш): если задачу потом изменили, отметка сгорает и её нужно поставить заново.
   3. ИИ к банку не подключён: ответы проверяет код, подсказки берутся из банка. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BANK_FILE = path.join(__dirname, "data", "private", "bank_zadach.json");
const MAX_NUMBER = 1000; // числа в 3 классе до 1000

/* ---------- безопасный калькулятор (только + - * / и скобки, деление нацело) ---------- */
function tokenize(expr) {
  const s = String(expr), toks = [], re = /\s*(?:(\d+)|([A-Za-z_]\w*)|([-+*/()]))/y;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) { if (/^\s*$/.test(s.slice(i))) break; throw new Error("недопустимый символ в выражении: " + s); }
    i = re.lastIndex;
    if (m[1] !== undefined) toks.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: "var", v: m[2] });
    else toks.push({ t: "op", v: m[3] });
  }
  return toks;
}
function calc(expr, env) {
  const toks = tokenize(expr);
  let p = 0;
  const isOp = (t, ...ops) => t && t.t === "op" && ops.includes(t.v);
  function primary() {
    const t = toks[p++];
    if (!t) throw new Error("обрыв выражения: " + expr);
    if (t.t === "num") return t.v;
    if (t.t === "var") {
      if (!Object.prototype.hasOwnProperty.call(env, t.v)) throw new Error("неизвестное имя «" + t.v + "» в выражении: " + expr);
      return env[t.v];
    }
    if (isOp(t, "(")) { const v = sum(); if (!isOp(toks[p], ")")) throw new Error("нет закрывающей скобки: " + expr); p++; return v; }
    throw new Error("неожиданный знак в выражении: " + expr);
  }
  function term() {
    let v = primary();
    while (isOp(toks[p], "*", "/")) {
      const op = toks[p++].v, r = primary();
      if (op === "*") v *= r;
      else { if (r === 0 || v % r !== 0) throw new Error("деление с остатком или на ноль: " + expr); v /= r; }
    }
    return v;
  }
  function sum() {
    let v = term();
    while (isOp(toks[p], "+", "-")) { const op = toks[p++].v, r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  const v = sum();
  if (p !== toks.length) throw new Error("лишнее в выражении: " + expr);
  return v;
}
const literals = expr => new Set(tokenize(expr).filter(t => t.t === "num").map(t => t.v));
const numbersIn = text => new Set((String(text).match(/\d+/g) || []).map(Number));
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

/* ---------- проверка одной задачи ---------- */
function checkTask(t, byId) {
  const errs = [], id = t && t.id ? t.id : "?";
  const err = m => errs.push(id + ": " + m);
  const need = ["id", "topic", "subtopic", "level", "condition", "numbers", "known", "find", "steps", "answer", "check", "hints", "common_mistakes", "prerequisites", "review"];
  for (const f of need) if (!(f in t)) err("нет поля «" + f + "»");
  if (errs.length) return errs;

  if (![1, 2, 3].includes(t.level)) err("level должен быть 1, 2 или 3");
  const inText = numbersIn(t.condition);
  if (!setEq(inText, new Set(t.numbers))) err("числа в условии [" + [...inText].sort((a, b) => a - b) + "] не совпадают со списком numbers [" + [...t.numbers].sort((a, b) => a - b) + "]");
  if ([...inText].some(n => n > MAX_NUMBER)) err("в условии число больше " + MAX_NUMBER);
  if (!String(t.find).trim()) err("пустое поле find");

  const env = {}, results = new Set();
  if (!Array.isArray(t.steps) || !t.steps.length) { err("нет шагов решения"); return errs; }
  t.steps.forEach((s, i0) => {
    const i = i0 + 1;
    if (!s.text || !s.unit) err("шаг " + i + ": нужны text и unit");
    let val;
    try { val = calc(s.expr, env); } catch (e) { err("шаг " + i + ": " + e.message); return; }
    if (!Number.isInteger(val) || val < 0) { err("шаг " + i + ": результат " + val + " не натуральное число"); return; }
    if (val !== s.result) err("шаг " + i + ": в файле " + s.result + ", а по выражению «" + s.expr + "» получается " + val);
    if (val > MAX_NUMBER) err("шаг " + i + ": результат больше " + MAX_NUMBER);
    const bad = [...literals(s.expr)].filter(c => !t.numbers.includes(c));
    if (bad.length) err("шаг " + i + ": в выражении числа [" + bad + "], которых нет в условии");
    env["s" + i] = val; results.add(val);
  });
  if (!("s1" in env)) return errs;

  const final = env["s" + t.steps.length];
  if (t.answer.value !== final) err("answer.value=" + t.answer.value + ", а последний шаг даёт " + final);
  if (!numbersIn(t.answer.text).has(final)) err("в тексте ответа нет числа ответа");

  env.answer = final;
  try {
    const got = calc(t.check.expr, env);
    if (got !== t.check.equals) err("проверка «" + t.check.expr + "» даёт " + got + ", а ожидается " + t.check.equals);
  } catch (e) { err("проверка: " + e.message); }

  if (!Array.isArray(t.common_mistakes)) err("common_mistakes должен быть списком");
  else for (const m of t.common_mistakes) {
    try {
      const got = calc(m.expr, {});
      if (got !== m.wrong_answer) err("типичная ошибка: «" + m.expr + "» даёт " + got + ", а в файле " + m.wrong_answer);
    } catch (e) { err("ошибка " + m.wrong_answer + ": " + e.message); continue; }
    if (m.wrong_answer === final) err("типичная ошибка совпадает с правильным ответом");
    if (!String(m.guiding_question || "").trim()) err("у типичной ошибки " + m.wrong_answer + " нет guiding_question");
  }

  const h = t.hints || {};
  for (const k of ["remind", "scheme", "similar_task_id", "split"]) if (!(k in h)) err("в подсказках нет «" + k + "»");
  if (h.split && (!h.split.first_question || !h.split.second_question)) err("в hints.split нужны first_question и second_question");
  if (h.similar_task_id !== undefined) {
    const sim = byId[h.similar_task_id];
    if (!sim) err("похожая задача " + h.similar_task_id + " не найдена в банке");
    else if (sim.id === t.id) err("похожая задача ссылается на саму себя");
    else if (sim.topic !== t.topic) err("похожая задача из другой темы");
  }
  /* всё, что увидит ребёнок до ответа, не должно содержать готовых результатов */
  const secret = new Set([...results, final].filter(x => !t.numbers.includes(x)));
  const visible = [h.remind, h.scheme, ...(h.split ? [h.split.first_question, h.split.second_question] : []), t.find, ...t.steps.map(s => s.text)];
  const leaked = new Set();
  for (const x of visible) for (const n of numbersIn(x)) if (secret.has(n)) leaked.add(n);
  if (leaked.size) err("в подсказках, вопросах шагов или в find встречается готовый результат: [" + [...leaked] + "]");
  return errs;
}

function checkBank(data) {
  const errors = [];
  if (!data || !Array.isArray(data.tasks) || !data.tasks.length) return ["в банке нет задач"];
  const ids = data.tasks.map(t => t && t.id);
  if (new Set(ids).size !== ids.length) errors.push("есть повторяющиеся id");
  const byId = Object.fromEntries(data.tasks.filter(t => t && t.id).map(t => [t.id, t]));
  for (const t of data.tasks) errors.push(...checkTask(t, byId));
  return errors;
}

/* ---------- отметка учителя ---------- */
const withoutReview = t => { const { review, ...rest } = t; return rest; };
const hashOf = t => crypto.createHash("sha1").update(JSON.stringify(withoutReview(t))).digest("hex").slice(0, 12);
/* "ok" — проверена и не менялась; "stale" — проверяли, но потом изменили; "no" — не проверена */
function reviewState(t) {
  const r = t.review || {};
  if (r.checked_by_teacher !== true) return "no";
  return r.hash === hashOf(t) ? "ok" : "stale";
}

/* ---------- превращение задачи банка в шаги тренажёра ---------- */
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
const cleanEnd = s => String(s).trim().replace(/[.!]+$/, "");
const mathText = s => String(s).replace(/ - /g, " − ");
const showExpr = (expr, env) => expr.replace(/[A-Za-z_]\w*/g, n => String(env[n])).replace(/\*/g, "·").replace(/\//g, ":").replace(/-/g, "−");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function skillFor(t, j) {
  const sub = t.subtopic;
  if (sub.startsWith("во сколько раз")) return "во сколько раз больше или меньше";
  if (sub.startsWith("составная")) return j === 0 ? (/больше/.test(sub) ? "в несколько раз больше" : "в несколько раз меньше") : "сложение и вычитание";
  return sub.includes("больше") ? "в несколько раз больше" : "в несколько раз меньше";
}

/* Лесенка подсказок: 1 вспомнить, 2 схема (и похожий пример, его добавляет сервер), 3 разбить на шаги */
function calcLadder(t, j) {
  const h = t.hints, sp = h.split;
  if (t.steps.length === 1) return [h.remind, h.scheme, sp.first_question + " " + sp.second_question];
  if (j === 0) return [h.remind, h.scheme, sp.first_question];
  return [sp.second_question, h.scheme, "Загляни в записи тетради: там есть результат прошлого шага. " + sp.second_question];
}

function checkLadder(shown) {
  const m = /^(\d+) ([·:+−]) (\d+)$/.exec(shown);
  if (!m) return ["Посчитай ещё раз и проверь себя по таблице умножения."];
  const [, a, op, b] = m;
  if (op === ":") return ["Вспомни таблицу умножения: " + b + " · ? = " + a + ".", "Помоги себе рисунком: выложи " + a + " предметов и разбей их на группы по " + b + ". Сколько групп получилось?"];
  if (op === "·") return ["Вспомни таблицу умножения на " + b + " или на " + a + ".", "Умножение — это сложение одинаковых слагаемых. Запиши его сложением и посчитай."];
  return ["Считай по разрядам: сначала десятки, потом единицы.", "Запиши числа столбиком друг под другом и посчитай."];
}

function convertTask(t, all, idx, simTask) {
  const env = {};
  t.steps.forEach((s, k) => { env["s" + (k + 1)] = s.result; });
  env.answer = t.answer.value;
  const steps = [];

  /* 1. «Что нужно найти?»: верный вариант и два чужих вопроса из банка */
  const myFind = cleanEnd(t.find), others = [];
  for (let off = 1; off < all.length && others.length < 2; off++) {
    const f = cleanEnd(all[(idx + off) % all.length].find);
    if (f !== myFind && !others.includes(f)) others.push(f);
  }
  if (others.length) {
    const pos = idx % (others.length + 1), options = others.slice();
    options.splice(pos, 0, myFind);
    const rule = "Посмотри на последнее предложение задачи: там стоит вопрос. Он и говорит, что нужно найти.";
    steps.push({ type: "choice", skill: "понимание условия", q: "Прочитай задачу. Что в ней нужно найти?", options, correct: pos,
      rule, ladder: [rule], ok: "В задаче нужно узнать: " + lowerFirst(myFind) + "." });
  }

  /* 2. Шаги решения */
  const mistakes = {};
  for (const m of t.common_mistakes) mistakes[String(m.wrong_answer)] = m.guiding_question;
  t.steps.forEach((s, j) => {
    const line = showExpr(s.expr, env) + " = " + s.result;
    const last = j === t.steps.length - 1;
    steps.push({ type: "number", skill: s.skill || skillFor(t, j), q: s.text, answer: s.result,
      ladder: calcLadder(t, j), mistakes, maxAttempts: 4,
      ok: line + " " + s.unit + "." + (last ? " Ответ: " + t.answer.text : ""),
      note: line + " (" + s.unit + ")" });
  });

  /* 3. Проверка ответа. Вопрос содержит ответ задачи, поэтому браузер получает его только после верного предыдущего шага */
  const shown = showExpr(t.check.expr, env);
  steps.push({ type: "number", skill: "проверка ответа", lazyQ: true, q: "Проверим ответ. Сколько будет " + shown + "?",
    answer: t.check.equals, ladder: checkLadder(shown), maxAttempts: 3,
    ok: mathText(t.check.text), note: "Проверка: " + shown + " = " + t.check.equals });

  /* «Похожий пример» целиком решён в банке, поэтому его можно показать */
  const similar = simTask ? esc(simTask.condition + " Решение: " +
    simTask.steps.map(s => showExpr(s.expr, Object.fromEntries(simTask.steps.map((x, k) => ["s" + (k + 1), x.result]))) + " = " + s.result + " (" + s.unit + ")").join("; ") +
    ". Ответ: " + simTask.answer.text) : null;

  const num = (/(\d+)$/.exec(t.id) || [])[1];
  return { id: t.id, no: "Л" + (num ? Number(num) : idx + 1), title: "Задача", section: "Задачи Листика",
    long: t.condition.length > 60, condition: t.condition, similar, steps };
}

/* ---------- загрузка для сервера ---------- */
function load(opts = {}) {
  const data = JSON.parse(fs.readFileSync(BANK_FILE, "utf8"));
  const info = { total: Array.isArray(data.tasks) ? data.tasks.length : 0, reviewed: 0, shown: 0, stale: [], hiddenSimilar: [], errors: checkBank(data) };
  if (info.errors.length) return { tasks: [], info };
  const state = Object.fromEntries(data.tasks.map(t => [t.id, reviewState(t)]));
  info.reviewed = Object.values(state).filter(x => x === "ok").length;
  info.stale = data.tasks.filter(t => state[t.id] === "stale").map(t => t.id);
  const byId = Object.fromEntries(data.tasks.map(t => [t.id, t]));
  const out = [];
  data.tasks.forEach((t, idx) => {
    if (!opts.showUnreviewed) {
      if (state[t.id] !== "ok") return;
      if (state[t.hints.similar_task_id] !== "ok") { info.hiddenSimilar.push(t.id); return; } // ребёнок увидит решение похожей задачи
    }
    out.push(convertTask(t, data.tasks, idx, byId[t.hints.similar_task_id]));
  });
  info.shown = out.length;
  return { tasks: out, info };
}

/* ---------- команды ---------- */
function reviewSheet(data) {
  const L = [];
  L.push("ЛИСТ ДЛЯ УЧИТЕЛЯ. Банк задач Листика, 3 класс");
  L.push("Прочитайте каждую задачу и ответьте: понятно ли условие третикласснику? По программе ли? Подходят ли числа и подсказки?");
  for (const t of data.tasks) {
    const st = reviewState(t);
    L.push("", "=".repeat(64));
    L.push("[" + t.id + "] уровень " + t.level + ", " + t.subtopic + "   (" + (st === "ok" ? "проверена: " + t.review.by : st === "stale" ? "изменена после проверки" : "не проверена") + ")");
    L.push("Условие: " + t.condition);
    const env = {};
    t.steps.forEach((s, k) => { env["s" + (k + 1)] = s.result; L.push("  " + (k + 1) + ") " + s.text + "   " + showExpr(s.expr, env) + " = " + s.result + " (" + s.unit + ")"); });
    L.push("Ответ: " + t.answer.text);
    L.push("Подсказка 1 (вспомнить): " + t.hints.remind);
    L.push("Подсказка 2 (схема): " + t.hints.scheme);
    L.push("Подсказка 3 (по шагам): " + t.hints.split.first_question + " / " + t.hints.split.second_question);
    L.push("Похожая задача: " + t.hints.similar_task_id);
    L.push("Типичные ошибки:");
    for (const m of t.common_mistakes) L.push("  - ответ " + m.wrong_answer + " (" + m.cause + ") -> «" + m.guiding_question + "»");
  }
  return L.join("\n") + "\n";
}

function approve(ids, by) {
  let raw = fs.readFileSync(BANK_FILE, "utf8");
  const data = JSON.parse(raw);
  const errors = checkBank(data);
  if (errors.length) throw new Error("В банке есть ошибки, сначала исправьте их:\n  - " + errors.join("\n  - "));
  const list = ids.length === 1 && ids[0] === "all" ? data.tasks.map(t => t.id) : ids;
  const today = new Date().toISOString().slice(0, 10);
  for (const id of list) {
    const t = data.tasks.find(x => x.id === id);
    if (!t) throw new Error("нет задачи " + id);
    const start = raw.indexOf('"id": "' + id + '"');
    const re = /"review":\s*\{[^}]*\}/g;
    re.lastIndex = start;
    const m = re.exec(raw);
    if (start < 0 || !m) throw new Error("не нашёл блок review у задачи " + id);
    const block = '"review": {"checked_by_teacher": true, "by": ' + JSON.stringify(by) + ', "date": "' + today + '", "hash": "' + hashOf(t) + '", "notes": ' + JSON.stringify((t.review && t.review.notes) || "") + "}";
    raw = raw.slice(0, m.index) + block + raw.slice(m.index + m[0].length);
  }
  const after = JSON.parse(raw); // файл должен остаться корректным, а сами задачи не измениться
  for (const t of data.tasks) if (hashOf(after.tasks.find(x => x.id === t.id)) !== hashOf(t)) throw new Error("при записи изменилась задача " + t.id + ", файл не тронут");
  fs.copyFileSync(BANK_FILE, BANK_FILE + ".bak");
  fs.writeFileSync(BANK_FILE + ".tmp", raw);
  fs.renameSync(BANK_FILE + ".tmp", BANK_FILE);
  return list;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const cmd = ["review", "approve"].includes(args[0]) ? args[0] : "check";
  const data = JSON.parse(fs.readFileSync(BANK_FILE, "utf8"));
  try {
    if (cmd === "review") {
      const text = reviewSheet(data), out = opt("--out");
      if (out) { fs.writeFileSync(out, text, "utf8"); console.log("Лист для учителя записан в файл: " + out); } else console.log(text);
    } else if (cmd === "approve") {
      const by = opt("--by");
      const ids = args.slice(1).filter((a, i, arr) => a !== "--by" && arr[i - 1] !== "--by");
      if (!by || !ids.length) { console.log('Формат: node bank.js approve kr-001 kr-002 --by "Имя учителя"   (или approve all)'); process.exit(1); }
      const done = approve(ids, by);
      console.log("Отмечено как проверенные (" + by + "): " + done.join(", ") + ". Перезапустите сервер, чтобы изменения вступили в силу.");
    } else {
      const errors = checkBank(data);
      const states = data.tasks.map(reviewState);
      console.log("Задач в банке: " + data.tasks.length);
      console.log("Проверено учителем: " + states.filter(s => s === "ok").length + " из " + data.tasks.length +
        (states.includes("stale") ? " (изменены после проверки: " + data.tasks.filter((t, i) => states[i] === "stale").map(t => t.id).join(", ") + ")" : ""));
      if (errors.length) { console.log("\nНАЙДЕНО ОШИБОК: " + errors.length); errors.forEach(e => console.log("  - " + e)); process.exit(1); }
      console.log("Арифметика и структура: ошибок нет");
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { load, checkBank, checkTask, calc, reviewState, hashOf, reviewSheet, approve };
