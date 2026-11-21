#!/usr/bin/env node
"use strict";
/* Ищет в clips/ старые записи: те, которых нет ни в одном текущем тексте (после правки текста у него новый номер, старый файл остаётся лишним).
   Деньги не тратит, в OpenAI не ходит.
   Запуск:  node clean-clips.js            (только показать, сколько лишних)
            node clean-clips.js --apply    (перенести лишние в _to_delete/clips_old/ и записать их номера в _to_delete/clips_stale.txt;
                                            выкладка vylozhit_ps.command потом удалит эти же файлы на сервере)
   Тексты берутся так же, как в build-audio.js: tasks.json (3 класс) и math-2.json (2 класс) + общие фразы. */
const fs = require("fs"), path = require("path");
const C = require("./clips.js");
const apply = process.argv.includes("--apply");

const tasks = ["tasks.json", "math-2.json"].flatMap(f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data/private", f), "utf8")).tasks || []; } catch (e) { return []; } });
if (!tasks.length) { console.error("Не прочитались упражнения, ничего не трогаю."); process.exit(1); }
C.registerTasks(tasks);

const ids = fs.readdirSync(C.DIR).filter(f => /^[0-9a-f]{16}\.mp3$/.test(f)).map(f => f.slice(0, 16));
const stale = ids.filter(id => !C.registry.has(id));
console.log(`Нужных реплик: ${C.registry.size}. Файлов в папке: ${ids.length}. Лишних (старых): ${stale.length}.`);
if (ids.length && stale.length > ids.length * 0.9) { console.error("Лишних больше 90%: похоже на сбой (изменились модель, голос или стиль?). Ничего не трогаю."); process.exit(1); }
if (!apply || !stale.length) process.exit(0);

const trash = path.join(__dirname, "_to_delete", "clips_old"), list = path.join(__dirname, "_to_delete", "clips_stale.txt");
fs.mkdirSync(trash, { recursive: true });
const old = new Set(fs.existsSync(list) ? fs.readFileSync(list, "utf8").split("\n").filter(Boolean) : []);
let size = 0;
for (const id of stale) { const f = path.join(C.DIR, id + ".mp3"); size += fs.statSync(f).size; fs.renameSync(f, path.join(trash, id + ".mp3")); old.add(id); }
fs.writeFileSync(list, [...old].join("\n") + "\n");
console.log(`Перенесено в _to_delete/clips_old/: ${stale.length} файлов (${(size / 1048576).toFixed(1)} МБ). Список для сервера: _to_delete/clips_stale.txt (${old.size} номеров).`);
