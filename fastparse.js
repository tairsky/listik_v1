"use strict";
/* Быстрый разбор ответа ребёнка БЕЗ модели.
   parseFast(heard, spec) -> { args } (ответ понятен, можно сразу проверять), { intent: "repeat" } (просит повторить) или null.
   null значит «не уверен»: тогда решает модель, как раньше. Лучше промолчать и отдать модели, чем засчитать ребёнку не тот ответ.
   spec: { type: "number" } | { type: "choice", options: [текст…] } | { type: "pair", n: 2 } | { type: "explain" } */

const UNITS = { ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19 };
const TENS = { двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90 };
const HUND = { сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900 };
const THOUS = /^тысяч/;

const norm = s => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s-]/g, " ").replace(/(\d)\s+(?=\d{3}\b)/g, "$1").replace(/\s+/g, " ").trim();
/* ё в таблицах выше нет (ё нормализуем в е): «шестьсот», «пятьсот» без ё — совпадает */
const tokens = s => (norm(s) ? norm(s).split(" ") : []);

/* числа из речи: цифрами («42») и словами («сорок два»). Возвращает [{value, from, to}] по номерам слов */
function findNumbers(toks) {
  const res = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (/^\d+$/.test(t)) { res.push({ value: Number(t), from: i, to: i + 1 }); i++; continue; }
    // слова: собираем число из подряд идущих числительных
    let j = i, total = 0, cur = 0, lastClass = 9, any = false;
    while (j < toks.length) {
      const w = toks[j];
      let cls = 0, v = 0;
      if (w in HUND) { cls = 3; v = HUND[w]; }
      else if (w in TENS) { cls = 2; v = TENS[w]; }
      else if (w in UNITS) { cls = 1; v = UNITS[w]; }
      else if (THOUS.test(w) && any) {            // «три тысячи», «тысяча»: умножаем собранное
        total += (cur || 1) * 1000; cur = 0; lastClass = 4; j++; continue;
      } else if (THOUS.test(w)) { total += 1000; lastClass = 4; any = true; j++; continue; }
      else break;
      if (cls >= lastClass && lastClass !== 4) break;   // «пять три» — это два числа, а не восемь
      if (lastClass === 4) lastClass = 9;
      if (v === 0 && any) break;
      cur += v; lastClass = cls; any = true; j++;
    }
    if (any && j > i) { res.push({ value: total + cur, from: i, to: j }); i = j; } else i++;
  }
  return res;
}

const FILLER = new Set(["ответ", "это", "будет", "получится", "получается", "получилось", "равно", "равна", "ну", "вот", "так", "значит", "я", "думаю", "итого",
  "да", "тут", "тогда", "то", "же", "будут", "всего", "и", "а"]);
const STOP = new Set(["в", "во", "на", "и", "с", "со", "у", "к", "по", "что", "это", "я", "ну", "вот", "так", "же", "то", "ответ", "вариант", "номер", "думаю", "будет", "тут", "там", "а", "о", "об"]);
const DOUBT = /не знаю|не увер|наверн|может|кажется|не понял|не помню|или/;
const REPEAT = /повтор|еще раз|не расслыш|не услыш|что-что|не понял вопрос|не поняла вопрос/;
const stem = w => w.slice(0, 4);

function parseNumbers(toks, n) {
  const nums = findNumbers(toks);
  if (nums.length !== n) return null;
  // каждое слово речи должно быть либо числом, либо «пустым» словом: иначе ребёнок сказал что-то ещё
  const used = new Set(); nums.forEach(x => { for (let k = x.from; k < x.to; k++) used.add(k); });
  for (let k = 0; k < toks.length; k++) if (!used.has(k) && !FILLER.has(toks[k])) return null;
  if (nums.some(x => !Number.isSafeInteger(x.value) || x.value > 999999)) return null;
  return nums.map(x => x.value);
}

const ORD = [/^перв/, /^втор/, /^трет/, /^четверт/, /^пят(ый|ое|ая|ом)$/];
const LETTER = { а: 0, б: 1, в: 2, г: 3, д: 4 };

function parseChoice(toks, options) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 5) return null;
  const nums = findNumbers(toks);
  const optToks = options.map(o => tokens(o));
  const optNums = optToks.map(t => findNumbers(t).map(x => x.value));
  // 1) число, совпадающее с числом в одном из вариантов («шестьсот восемьдесят один» -> вариант «681»)
  if (nums.length) {
    const hit = options.map((o, i) => optNums[i].some(v => nums.some(x => x.value === v)) ? i : -1).filter(i => i >= 0);
    if (hit.length === 1 && nums.length === 1) {
      const used = new Set(); for (let k = nums[0].from; k < nums[0].to; k++) used.add(k);
      if (toks.every((w, k) => used.has(k) || FILLER.has(w))) return hit[0];
    }
  }
  // 2) буква варианта или порядковое числительное: «Б», «второй», «вариант два»
  const idx = new Set();
  toks.forEach((w, k) => {
    if (w.length === 1 && w in LETTER && toks.length <= 3 && LETTER[w] < options.length) idx.add(LETTER[w]);
    ORD.forEach((re, i) => { if (re.test(w) && i < options.length) idx.add(i); });
  });
  if (idx.size === 1 && toks.length <= 4) {
    const rest = toks.filter(w => !(w.length === 1 && w in LETTER) && !ORD.some(re => re.test(w)) && !STOP.has(w) && !FILLER.has(w));
    if (rest.length === 0) return [...idx][0];
  }
  // 3) слова варианта: «нет», «во втором»… считаем совпавшие корни; победитель должен быть один,
  //    и все содержательные слова ребёнка должны находиться в победившем варианте
  const heardStems = toks.filter(w => !STOP.has(w)).map(stem);
  if (!heardStems.length || toks.length > 6) return null;
  const sets = optToks.map(t => new Set(t.filter(w => !STOP.has(w)).map(stem)));
  const score = sets.map(s => heardStems.filter(h => s.has(h)).length);
  const best = Math.max(...score);
  if (best < 1) return null;
  const win = score.indexOf(best);
  if (score.filter(x => x === best).length !== 1) return null;
  const others = Math.max(...score.filter((_, i) => i !== win));
  if (best === others) return null;
  if (!heardStems.every(h => sets[win].has(h) || FILLER.has(h))) return null;
  return win;
}

function parseFast(heard, spec) {
  const toks = tokens(heard);
  if (!toks.length || toks.length > 9 || !spec || typeof spec !== "object") return null;
  const text = norm(heard);
  if (REPEAT.test(text) && !findNumbers(toks).length) return { intent: "repeat" };
  if (DOUBT.test(text) || toks.includes("не")) return null;       // «может, пять», «не пять»: не угадываем
  if (spec.type === "number") {
    const v = parseNumbers(toks, 1);
    return v ? { args: { number: v[0] } } : null;
  }
  if (spec.type === "pair") {
    const n = Number(spec.n);
    if (!Number.isInteger(n) || n < 2 || n > 4) return null;
    const v = parseNumbers(toks, n);
    return v ? { args: { values: v } } : null;
  }
  if (spec.type === "choice") {
    const i = parseChoice(toks, spec.options);
    return i === null || i === undefined ? null : { args: { choice: "АБВГД"[i] } };
  }
  return null;                                                     // explain и всё прочее: решает модель
}

module.exports = { parseFast, findNumbers, tokens };
