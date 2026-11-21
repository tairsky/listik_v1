#!/usr/bin/env node
"use strict";
/* Озвучивает заранее все реплики из задач и общие фразы в папку clips/ (по одному mp3 на текст).
   Уже готовые файлы пропускаются: правка одной фразы озвучивает только её.
   Запуск:  node build-audio.js            (озвучить всё, чего нет)
            node build-audio.js --dry      (только посчитать, ничего не тратить)
            node build-audio.js --only r1-1  (только задача r1-1: для пробы)
            node build-audio.js --file rus-3.json  (только упражнения из одного файла)
   Нужен OPENAI_API_KEY в .env. Потом сделайте git add clips && commit && push: файлы поедут на сайт вместе с кодом. */
const fs = require("fs"), path = require("path");
const C = require("./clips.js");
const args = process.argv.slice(2), dry = args.includes("--dry");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const onlyFile = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;   // например --file rus-3.json: озвучить только упражнения из этого файла

/* упражнения всех классов: tasks.json (3 класс), math-2.json (2 класс) и rus-3.json (русский, 3 класс) и en-3.json (английский, 3 класс); нет файла, значит этого класса нет */
const tasks = ["tasks.json", "math-2.json", "rus-3.json", "en-3.json"].filter(f => !onlyFile || f === onlyFile).flatMap(f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data/private", f), "utf8")).tasks || []; } catch (e) { return []; } }).filter(t => !only || t.id === only);
C.registerTasks(tasks);
const todo = [...C.registry.entries()].filter(([id]) => !C.have(id));
const chars = todo.reduce((n, [, t]) => n + t.length, 0);
console.log(`Озвучка: ${C.config.model}, голос ${C.config.voice}`);
console.log(`Всего реплик: ${C.registry.size}, уже готово: ${C.registry.size - todo.length}, осталось озвучить: ${todo.length} (${chars} знаков)`);
if (dry || !todo.length) process.exit(0);
const keyErr = C.keyError(); if (keyErr) { console.error(keyErr); process.exit(1); }

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
  const workers = +process.env.TTS_WORKERS || (C.config.provider === "gemini" ? 1 : 4);   // у Gemini лимит запросов ниже: по одному
  await Promise.all(Array.from({ length: workers }, worker));   // по 4 запроса одновременно: не упираемся в лимиты
  console.log(`Готово: ${done}, с ошибками: ${fail}. Папка: ${C.DIR}`);
  process.exit(fail ? 1 : 0);
})();
