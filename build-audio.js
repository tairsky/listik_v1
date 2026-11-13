#!/usr/bin/env node
"use strict";
/* Озвучивает заранее все реплики из задач и общие фразы в папку clips/ (по одному mp3 на текст).
   Уже готовые файлы пропускаются: правка одной фразы озвучивает только её.
   Запуск:  node build-audio.js            (озвучить всё, чего нет)
            node build-audio.js --dry      (только посчитать, ничего не тратить)
            node build-audio.js --only r1-1  (только задача r1-1: для пробы)
   Нужен OPENAI_API_KEY в .env. Потом сделайте git add clips && commit && push: файлы поедут на сайт вместе с кодом. */
const fs = require("fs"), path = require("path");
const C = require("./clips.js");
const args = process.argv.slice(2), dry = args.includes("--dry");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

/* упражнения всех классов: tasks.json (3 класс) и math-2.json (2 класс); нет файла, значит этого класса нет */
const tasks = ["tasks.json", "math-2.json"].flatMap(f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data/private", f), "utf8")).tasks || []; } catch (e) { return []; } }).filter(t => !only || t.id === only);
C.registerTasks(tasks);
const todo = [...C.registry.entries()].filter(([id]) => !C.have(id));
const chars = todo.reduce((n, [, t]) => n + t.length, 0);
console.log(`Озвучка: ${C.config.model}, голос ${C.config.voice}`);
console.log(`Всего реплик: ${C.registry.size}, уже готово: ${C.registry.size - todo.length}, осталось озвучить: ${todo.length} (${chars} знаков)`);
if (dry || !todo.length) process.exit(0);
if (!C.config.key) { console.error("Нет OPENAI_API_KEY в .env"); process.exit(1); }

(async () => {
  let done = 0, fail = 0;
  const queue = todo.slice();
  const worker = async () => {
    for (let item; (item = queue.shift());) {
      const [id, text] = item;
      try { await C.ensure(id); done++; if (done % 20 === 0 || !queue.length) console.log(`  готово ${done}/${todo.length}`); }
      catch (e) { fail++; console.error(`  не вышло ${id} («${text.slice(0, 40)}…»): ${e.message}`); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);   // по 4 запроса одновременно: не упираемся в лимиты
  console.log(`Готово: ${done}, с ошибками: ${fail}. Папка: ${C.DIR}`);
  process.exit(fail ? 1 : 0);
})();
