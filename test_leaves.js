/* Сценарный тест листиков: запускает отдельный сервер с пустым хранилищем и проходит упражнения.
   Запуск: node test_leaves.js   (ничего не трогает в storage/ и на Render) */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const TASKS = JSON.parse(fs.readFileSync(path.join(__dirname, "data/private/tasks.json"), "utf8")).tasks;
const PORT = 3911, BASE = "http://localhost:" + PORT;
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "listik-leaves-"));
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  ОШИБКА: " + m); } };
async function call(cookie, method, url, body) {
  const r = await fetch(BASE + url, { method, headers: Object.assign({ cookie: cookie.v || "" }, body ? { "content-type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie.v = sc.map(x => x.split(";")[0]).join("; ");
  let j = null; try { j = await r.json(); } catch (e) {}
  return { code: r.status, j };
}
const right = s => s.type === "choice" ? s.correct : s.type === "number" ? s.answer : s.answer;
const wrong = s => s.type === "choice" ? (s.correct + 1) % s.options.length : s.type === "number" ? s.answer + 1 : s.answer.map(v => v + 1);
async function register(email) {
  const c = { v: "" };
  const r = await call(c, "POST", "/api/register", { email, password: "parol12345", pin: "4827", childName: "Тест" });
  ok(r.code === 200, "регистрация " + email + ": " + r.code);
  return c;
}
/* проходит упражнение верными ответами; возвращает { gains, sum, doneSum, skipped } */
async function runTask(c, id, opt) {
  opt = opt || {};
  const t = TASKS.find(x => x.id === id);
  const st = await call(c, "POST", "/api/start", { task: id });
  ok(st.code === 200, "start " + id + ": " + st.code + " " + JSON.stringify(st.j));
  const skip = (st.j && st.j.skip) || [];
  let sum = 0, doneSum = null, last = null;
  for (let i = 0; i < t.steps.length; i++) {
    if (skip.includes(i)) continue;
    if (opt.wrongFirst && opt.wrongFirst.includes(i)) await call(c, "POST", "/api/check", { task: id, step: i, answer: wrong(t.steps[i]) });
    const r = await call(c, "POST", "/api/check", { task: id, step: i, answer: right(t.steps[i]) });
    ok(r.code === 200 && r.j.correct, "верный ответ принят " + id + ":" + i + " " + JSON.stringify(r.j));
    last = r.j.leaves; if (last) { sum += last.gain; if (last.done) doneSum = last.done.sum; }
  }
  return { sum, doneSum, skipped: skip.length, last };
}
(async () => {
  const srv = spawn(process.execPath, ["server.js"], { cwd: __dirname, env: Object.assign({}, process.env, { PORT, STORE_DIR: STORE, LEAVES_SMALL: "40", LEAVES_BIG: "100", LEAVES_SKILLS: "1" }), stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; srv.stdout.on("data", d => out += d); srv.stderr.on("data", d => out += d);
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + "/api/me"); break; } catch (e) { await new Promise(r => setTimeout(r, 200)); } }
  try {
    console.log("1. Гость не видит листики");
    ok((await call({ v: "" }, "GET", "/api/leaves")).code === 401, "гостю нужен вход");

    console.log("2. Первое упражнение чисто: по 2 за шаг и 10 за завершение");
    const c = await register("a@test.kz");
    const gsm = await call(c, "POST", "/api/leaves/goal", { id: "pizza" }), gbg = await call(c, "POST", "/api/leaves/goal", { id: "gift2" });
    ok(gsm.code === 200 && gsm.j.goalSmall && gsm.j.goalSmall.id === "pizza", "простой подарок «пицца» выбран");
    ok(gbg.code === 200 && gbg.j.goal && gbg.j.goal.id === "gift2" && gbg.j.goalSmall.id === "pizza", "большой «подарок 2» выбран, простой остался");
    ok((await call(c, "POST", "/api/leaves/goal", { id: "cinema" })).code === 400, "кино больше не в каталоге");
    let v = (await call(c, "GET", "/api/leaves")).j;
    ok(v.total === 0 && v.today.exercises === 0, "в начале 0");
    const r1 = await runTask(c, "r1-1");
    const n1 = 9 - r1.skipped;
    ok(r1.sum === n1 * 2 + 10, "сумма " + r1.sum + " вместо " + (n1 * 2 + 10));
    ok(r1.doneSum === r1.sum, "итог упражнения совпадает с суммой по шагам");
    v = (await call(c, "GET", "/api/leaves")).j;
    ok(v.total === r1.sum && v.today.exercises === 1, "баланс и счётчик упражнений");

    console.log("3. Шаг с подсказкой даёт 1, а не 2");
    await call(c, "POST", "/api/start", { task: "r1-2" });
    const t2 = TASKS.find(x => x.id === "r1-2");
    await call(c, "POST", "/api/check", { task: "r1-2", step: 0, answer: wrong(t2.steps[0]) });
    const g = await call(c, "POST", "/api/check", { task: "r1-2", step: 0, answer: right(t2.steps[0]) });
    ok(g.j.leaves && g.j.leaves.gain === 1, "после одной ошибки +1, получено " + (g.j.leaves && g.j.leaves.gain));

    console.log("4. Дальше проходим остальные задачи (убывающая отдача с 6-го упражнения)");
    const exGains = [r1.sum];
    for (const id of ["r1-2", "r2-1", "r3-1"]) { const r = await runTask(c, id); exGains.push(r.sum); }
    for (const id of ["r1-1", "r1-2", "r2-1", "r3-1"]) { const r = await runTask(c, id); exGains.push(r.sum); }
    console.log("   листиков за упражнения подряд:", exGains.join(", "));
    v = (await call(c, "GET", "/api/leaves")).j;
    console.log("   упражнений сегодня:", v.today.exercises, "в день набрано:", v.today.earned);
    ok(v.today.exercises >= 5, "набралось 5+ упражнений для проверки отдачи");

    console.log("4б. Третье прохождение того же упражнения за неделю листиков не даёт");
    const exBefore = (await call(c, "GET", "/api/leaves")).j.today.exercises;
    const r3 = await runTask(c, "r1-1");
    ok(r3.sum === 0, "третий раз за неделю: " + r3.sum);
    ok((await call(c, "GET", "/api/leaves")).j.today.exercises === exBefore, "и в счётчик упражнений дня не идёт");
    v = (await call(c, "GET", "/api/leaves")).j;

    console.log("5. Журнал начислений и сохранение");
    await new Promise(r => setTimeout(r, 2200));
    const users = JSON.parse(fs.readFileSync(path.join(STORE, "users.json"), "utf8"));
    const L = users[0] && users[0].progress && users[0].progress.leaves;
    ok(L && L.total === v.total, "баланс записан в users.json: " + (L && L.total) + " против " + v.total);
    const logDir = path.join(STORE, "log"), files = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
    const lines = files.flatMap(f => fs.readFileSync(path.join(logDir, f), "utf8").split("\n").filter(Boolean).map(JSON.parse)).filter(e => e.kind === "leaves");
    ok(lines.length > 0 && lines.reduce((n, e) => n + e.n, 0) === v.total, "сумма журнала " + lines.reduce((n, e) => n + e.n, 0) + " равна балансу " + v.total);

    console.log("6. Награды: малый значок и большая");
    console.log("   награды:", JSON.stringify(v.rewards.map(r => r.kind + ":" + r.status)), "цикл:", JSON.stringify(v.cycle));
    ok(v.rewards.some(r => r.kind === "small" && r.title === "Пицца" && r.status === "pending"), "простой подарок «Пицца» выдан (порог 40), ждёт выдачи");
    ok(v.rewards.some(r => r.kind === "big" && r.title === "Подарок 2" && r.status === "pending"), "большой «Подарок 2» выдан, ждёт промокода");
    ok(v.catalog.small.map(x => x.id).join() === "pizza,icecream,toy" && v.catalog.big.length === 4, "каталог: 3 простых и 4 больших");

    console.log("7. Ответы наугад не дают листиков");
    const d = await register("b@test.kz");
    await call(d, "POST", "/api/start", { task: "r2-1" });
    const t3 = TASKS.find(x => x.id === "r2-1");
    for (const i of [0, 0, 1, 1, 2]) await call(d, "POST", "/api/check", { task: "r2-1", step: i, answer: wrong(t3.steps[i]) });
    const gg = await call(d, "POST", "/api/check", { task: "r2-1", step: 2, answer: right(t3.steps[2]) });
    ok(gg.j.leaves && gg.j.leaves.gain === 0, "после 5 ошибок из 6 листиков нет: " + (gg.j.leaves && gg.j.leaves.gain));

    console.log("8. Цель и своя награда");
    ok((await call(c, "POST", "/api/leaves/goal", { id: "nonsense" })).code === 400, "чужая цель не принимается");
    const gp = await call(c, "POST", "/api/leaves/goal", { id: "icecream" });
    ok(gp.code === 200 && gp.j.goalSmall && gp.j.goalSmall.id === "icecream", "простой подарок меняется на «мороженое»");
    ok((await call(c, "POST", "/api/leaves/custom", { title: "Турция" })).code !== 200, "своей награды у родителя нет, адрес не работает (даже без PIN и с PIN подарки только из списка владельца)");
    ok((await call(c, "POST", "/api/leaves/goal", { id: "custom" })).code === 400, "цель «custom» не принимается");
    ok((await call(c, "POST", "/api/parent/enter", { pin: "4827" })).code === 200, "вход родителя");
    const pv = (await call(c, "GET", "/api/leaves")).j;
    ok(Array.isArray(pv.week) && pv.week.length > 0 && pv.custom === undefined, "родитель видит разбивку недели");
    await call(c, "POST", "/api/parent/leave", {});
    const ch = (await call(c, "GET", "/api/leaves")).j;
    ok(ch.week === undefined, "ребёнок не видит разбивку недели родителя");
  } catch (e) { fails++; console.log("СБОЙ ТЕСТА:", e); }
  srv.kill();
  console.log("\nПроверок: " + checks + ", ошибок: " + fails);
  if (fails) console.log("--- вывод сервера ---\n" + out.slice(-1500));
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(STORE, { recursive: true, force: true }); } catch (e) {}
  process.exit(fails ? 1 : 0);
})();
