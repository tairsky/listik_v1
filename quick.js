/* Листик: быстрые вопросы для знакомства (диагностика) и разминки.
   Каждый вопрос строится заново из случайных чисел, ответы считает код. Вопросы по форме совпадают с шагами
   упражнений (type choice / number), поэтому проверяются тем же кодом, что и обычные шаги.
   Только для вошедших в кабинет: сервер не выдаёт эти вопросы гостям. */
"use strict";
const crypto = require("crypto");

const ri = (a, b) => crypto.randomInt(a, b + 1);
const pick = a => a[ri(0, a.length - 1)];
const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = ri(0, i); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const digs = n => [n % 10, Math.floor(n / 10) % 10, Math.floor(n / 100) % 10];

const trap = (step, key, code, hint) => { (step.traps = step.traps || {})[String(key)] = { code, hint }; };
const wrong = (step, idx, code, hint) => { (step.wrong = step.wrong || {})[String(idx)] = { code, hint }; };

/* сколько переносов (сложение) и займов (вычитание) в столбике */
function carries(a, b) { let c = 0, n = 0; const x = digs(a), y = digs(b); for (let i = 0; i < 3; i++) { const s = x[i] + y[i] + c; c = s >= 10 ? 1 : 0; n += c; } return n; }
function borrows(a, b) {
  const d = digs(a), y = digs(b); let n = 0;
  for (let i = 0; i < 3; i++) { if (d[i] < y[i]) { n++; d[i] += 10; d[i + 1] -= 1; } }
  return n;
}
function chainZero(a) { const d = digs(a); return d[1] === 0; }   // ноль в десятках: займ идёт через сотню, такие числа не берём

function addWrong(a, b) {
  const x = digs(a), y = digs(b), out = new Set();
  for (const mask of [[0], [1], [0, 1], [0, 1, 2]]) {
    let c = 0, val = 0;
    for (let i = 0; i < 3; i++) { const s = x[i] + y[i] + c; val += (s % 10) * 10 ** i; c = s >= 10 ? 1 : 0; if (mask.includes(i)) c = 0; }
    out.add(val + c * 1000);
  }
  out.delete(a + b);
  return [...out];
}
function subWrong(a, b) {
  const x = digs(a), y = digs(b);
  const swap = [0, 1, 2].reduce((n, i) => n + Math.abs(x[i] - y[i]) * 10 ** i, 0);
  const red = [0, 1, 2].reduce((n, i) => n + ((x[i] < y[i] ? x[i] + 10 : x[i]) - y[i]) * 10 ** i, 0);
  return { swap, red };
}

const OK_NUM = n => "Да, " + n + ".";

/* ---------- разряды ---------- */
function genPlace() {
  let n; do { n = ri(120, 989); } while (new Set(digs(n)).size < 3 || digs(n).includes(0));
  const [u, t, h] = digs(n), kind = pick(["десятков", "сотен", "единиц"]);
  const ans = kind === "десятков" ? t : kind === "сотен" ? h : u;
  const s = { type: "number", skill: "разряды", q: `Какая цифра стоит в разряде ${kind} в числе ${n}?`, answer: ans,
    rule: "Единицы стоят справа, левее десятки, ещё левее сотни. Найди нужный разряд и посмотри, какая там цифра.", ok: OK_NUM(ans) };
  [u, t, h].filter(d => d !== ans).forEach(d => trap(s, d, "place_mixup", "Это цифра из другого разряда. Единицы стоят справа, потом десятки, потом сотни. Какая цифра стоит на нужном месте?"));
  return s;
}

/* ---------- сравнение чисел ---------- */
function genCompare() {
  const digitsMode = ri(0, 2) === 0;
  let small, big;
  if (digitsMode) { small = ri(900, 999); big = ri(1000, 1099); }
  else { const h = ri(1, 9), t1 = ri(0, 7), t2 = ri(t1 + 1, 9); small = h * 100 + t1 * 10 + ri(5, 9); big = h * 100 + t2 * 10 + ri(0, 4); }
  const first = ri(0, 1) === 0, opts = first ? [big, small] : [small, big], correct = first ? 0 : 1;
  const s = { type: "choice", skill: "сравнение чисел", q: `Какое число больше: ${opts[0]} или ${opts[1]}?`, options: opts.map(String), correct,
    rule: digitsMode ? "Посчитай цифры в каждом числе. У кого цифр больше, то число больше." : "Сравнивай со старшего разряда. Если сотни одинаковые, посмотри на десятки.",
    ok: OK_NUM(big) };
  wrong(s, 1 - correct, digitsMode ? "cmp_digit_count" : "cmp_by_units",
    digitsMode ? "Сравни не первые цифры, а сколько цифр в числе. Сколько цифр в каждом из чисел?" : "Не смотри только на последнюю цифру. Сотни одинаковые: посмотри на десятки.");
  return s;
}

/* ---------- сложение и вычитание столбиком ---------- */
function genAdd(c) {
  let a, b;
  do { a = ri(120, 899); b = ri(120, 899); } while (a + b > 999 || carries(a, b) !== c);
  const s = { type: "number", skill: "сложение столбиком", q: `Посчитай столбиком: ${a} + ${b}. Сколько получилось?`, answer: a + b,
    rule: "Складывай справа налево. Если в разряде получилось 10 или больше, лишний десяток (сотню) запомни и прибавь в следующем разряде.", ok: OK_NUM(a + b) };
  addWrong(a, b).forEach(v => trap(s, v, "add_forgot_carry", "Проверь переносы: если в разряде получилось 10 или больше, лишний десяток (сотню) нужно запомнить и прибавить в следующем разряде. Где ты этого не сделал?"));
  if (a !== b) trap(s, Math.abs(a - b), "wrong_op", "Проверь знак. Здесь числа нужно сложить.");
  if (s.traps) delete s.traps[String(a + b)];
  return s;
}
function genSub(c) {
  let a, b;
  do { a = ri(300, 999); b = ri(120, a - 20); } while (a - b < 10 || borrows(a, b) !== c || chainZero(a));
  const s = { type: "number", skill: "вычитание столбиком", q: `Посчитай столбиком: ${a} − ${b}. Сколько получилось?`, answer: a - b,
    rule: "Вычитай справа налево. Если из верхней цифры нельзя вычесть нижнюю, возьми один десяток (сотню) у соседнего разряда слева, а там станет на 1 меньше.", ok: OK_NUM(a - b) };
  const w = subWrong(a, b);
  if (w.swap !== a - b) trap(s, w.swap, "sub_swap", "Вычитать нужно всегда нижнее число из верхнего. Если из верхней цифры нельзя вычесть нижнюю, что можно сделать с соседним разрядом слева?");
  if (w.red !== a - b && w.red !== w.swap) trap(s, w.red, "sub_forgot_reduce", "Когда ты взял десяток (сотню) у соседнего разряда, там стало на 1 меньше. Ты это учёл?");
  if (a + b !== a - b) trap(s, a + b, "wrong_op", "Проверь знак. Здесь из одного числа нужно вычесть другое.");
  return s;
}

/* ---------- условие задачи: какое действие ---------- */
const WORDS = [
  (a, b) => ({ more: `В первом вагоне едет ${a} пассажиров, а во втором на ${b} больше. Какое действие поможет узнать, сколько пассажиров во втором вагоне?`,
               less: `В первом вагоне едет ${a} пассажиров, а во втором на ${b} меньше. Какое действие поможет узнать, сколько пассажиров во втором вагоне?` }),
  (a, b) => ({ more: `На базаре утром продали ${a} дынь, а после обеда на ${b} больше. Какое действие поможет узнать, сколько дынь продали после обеда?`,
               less: `На базаре утром продали ${a} дынь, а после обеда на ${b} меньше. Какое действие поможет узнать, сколько дынь продали после обеда?` }),
  (a, b) => ({ more: `У Айдара ${a} тенге, а у его брата на ${b} тенге больше. Какое действие поможет узнать, сколько тенге у брата?`,
               less: `У Айдара ${a} тенге, а у его брата на ${b} тенге меньше. Какое действие поможет узнать, сколько тенге у брата?` }),
  (a, b) => ({ more: `В школьной команде по футболу ${a} мальчиков, а девочек на ${b} больше. Какое действие поможет узнать, сколько девочек в команде?`,
               less: `В школьной команде по футболу ${a} мальчиков, а девочек на ${b} меньше. Какое действие поможет узнать, сколько девочек в команде?` })
];
function genWord() {
  const a = ri(30, 90), b = ri(5, 25), dir = pick(["more", "less"]), q = pick(WORDS)(a, b)[dir];
  const plus = `${a} + ${b}`, minus = `${a} − ${b}`, first = ri(0, 1) === 0;
  const opts = first ? [plus, minus] : [minus, plus], right = dir === "more" ? plus : minus;
  const s = { type: "choice", skill: "условие задачи", q, options: opts, correct: opts.indexOf(right),
    rule: "Слова «на … больше» значат, что стало больше, и числа складывают. Слова «на … меньше» значат, что стало меньше, и из числа вычитают.", ok: "Да, " + right + "." };
  wrong(s, 1 - s.correct, "word_wrong_op", dir === "more"
    ? "Слова «на … больше» говорят: стало больше. Когда становится больше, что мы делаем с числами?"
    : "Слова «на … меньше» говорят: стало меньше. Когда становится меньше, что мы делаем с числами?");
  return s;
}

/* ---------- умножение: равные группы ---------- */
function genMult() {
  const n = ri(2, 5), m = ri(2, 9), thing = pick([["корзинах", "яблок"], ["коробках", "карандашей"], ["пакетах", "конфет"], ["сумках", "мячей"]]);
  const s = { type: "number", skill: "умножение как равные группы", q: `В ${n} ${thing[0]} лежит по ${m} ${thing[1]}. Сколько всего ${thing[1]}?`, answer: n * m,
    rule: `Групп ${n}, и в каждой по ${m}. Сложи ${m} столько раз, сколько групп, или посчитай по ${m}.`, ok: OK_NUM(n * m) };
  trap(s, n + m, "mult_add_instead", `${n} раза по ${m} это не ${n} + ${m}. Нужно сложить ${m} несколько раз: сколько групп, столько и раз.`);
  trap(s, m, "mult_one_group", `Групп несколько, а не одна. Сколько их и сколько всего получается?`);
  delete s.traps[String(n * m)];
  return s;
}

/* ---------- неравенства ---------- */
function genIneq() {
  const less = ri(0, 1) === 0, K = ri(5, 15), v = ri(1, 3), d = ri(1, 3);
  const good = less ? K - v : K + v, boundary = K, opposite = less ? K + d : K - d;
  const opts = shuffle([good, boundary, opposite]);
  const s = { type: "choice", skill: "неравенства", q: `Какое число подходит к неравенству x ${less ? "меньше" : "больше"} ${K}?`, options: opts.map(String), correct: opts.indexOf(good),
    rule: `Нужны числа ${less ? "меньше" : "больше"} ${K}. Само число ${K} не подходит: оно не ${less ? "меньше" : "больше"} самого себя.`, ok: OK_NUM(good) };
  wrong(s, opts.indexOf(boundary), "ineq_boundary", `Число ${K} не подходит: оно не ${less ? "меньше" : "больше"} самого себя. Какое число подходит?`);
  wrong(s, opts.indexOf(opposite), "ineq_direction", `Проверь слово в неравенстве: нужны числа ${less ? "меньше" : "больше"} ${K}. Это число ${less ? "больше" : "меньше"} ${K}.`);
  return s;
}

/* ---------- выражения с буквами ---------- */
function genExpr() {
  const who = pick([["Асе", "купила"], ["Мадине", "купила"], ["Айдару", "купил"], ["Ержану", "купил"]]), L = shuffle(["a", "b", "c", "m", "n", "k"]).slice(0, 2);
  const thing = pick(["хлеб", "тетрадь", "ручку", "воду"]);
  const exprs = [`${L[0]} − ${L[1]}`, `${L[0]} + ${L[1]}`, `${L[0]} · ${L[1]}`], order = shuffle(exprs);
  const s = { type: "choice", skill: "выражения с буквами", q: `${who[0]} дали ${L[0]} тенге. ${who[1] === "купила" ? "Она" : "Он"} ${who[1]} ${thing} за ${L[1]} тенге. Какое выражение показывает, сколько денег осталось?`,
    options: order, correct: order.indexOf(exprs[0]), rule: "Деньги потратили, значит, их стало меньше. Когда становится меньше, числа вычитают.", ok: "Да, " + exprs[0] + "." };
  wrong(s, order.indexOf(exprs[1]), "expr_sign", "За покупку деньги платят, их становится меньше или больше? Тогда складываем или вычитаем?");
  wrong(s, order.indexOf(exprs[2]), "expr_op", "Умножение нужно, когда одинаковых групп несколько. Здесь деньги ушли. Какое действие показывает, что стало меньше?");
  return s;
}

const GEN = {
  "разряды": () => genPlace(),
  "сравнение чисел": () => genCompare(),
  "сложение столбиком": c => genAdd(c || 1),
  "вычитание столбиком": c => genSub(c || 1),
  "условие задачи": () => genWord(),
  "умножение как равные группы": () => genMult(),
  "неравенства": () => genIneq(),
  "выражения с буквами": () => genExpr()
};

/* знакомство: 8 вопросов; сложение и вычитание по два (с одним и с двумя переносами/займами) */
const DIAG_PLAN = [["разряды"], ["сравнение чисел"], ["сложение столбиком", 1], ["сложение столбиком", 2], ["вычитание столбиком", 1], ["вычитание столбиком", 2], ["условие задачи"], ["умножение как равные группы"]];
function buildDiag() { return DIAG_PLAN.map(([sk, c]) => GEN[sk](c)); }
function buildWarm(skills) { return skills.filter(s => GEN[s]).slice(0, 3).map(sk => GEN[sk](sk === "сложение столбиком" || sk === "вычитание столбиком" ? ri(1, 2) : undefined)); }

module.exports = { GEN, DIAG_PLAN, buildDiag, buildWarm, carries, borrows };
