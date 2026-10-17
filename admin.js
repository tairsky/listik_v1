/* Служебные команды для владельца. Запускать при ОСТАНОВЛЕННОМ сервере
   (иначе сервер перезапишет изменения).

   node admin.js list                            список кабинетов
   node admin.js password <почта> <пароль>       задать новый пароль
   node admin.js pin <почта> <PIN из 4 цифр>     задать новый PIN
   node admin.js delete <почта>                  удалить кабинет вместе с прогрессом */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = process.env.STORE_DIR || path.join(__dirname, "storage");
const FILE = path.join(DIR, "users.json");
const KEY = path.join(DIR, "secret.key");
if (!fs.existsSync(FILE)) { console.log("Файл " + FILE + " не найден: кабинетов ещё нет (или вы запустили команду не из той папки)."); process.exit(1); }
const users = JSON.parse(fs.readFileSync(FILE, "utf8"));
const pepper = () => Buffer.from(fs.readFileSync(KEY, "utf8").trim(), "hex");
const hash = (secret, kind) => {
  const salt = crypto.randomBytes(16);
  const input = kind === "pin" ? crypto.createHmac("sha256", pepper()).update(secret).digest() : Buffer.from(secret, "utf8");
  return { salt: salt.toString("hex"), hash: crypto.scryptSync(input, salt, 32).toString("hex") };
};
const save = () => { fs.writeFileSync(FILE + ".tmp", JSON.stringify(users, null, 2), { mode: 0o600 }); fs.renameSync(FILE + ".tmp", FILE); };
const [cmd, emailArg, value] = process.argv.slice(2);
const email = (emailArg || "").trim().toLowerCase();
const user = users.find(u => u.email === email);

if (cmd === "list") {
  console.log("Кабинетов: " + users.length);
  users.forEach(u => console.log("- " + u.email + " | ребёнок: " + u.child.name + " | создан: " + u.createdAt.slice(0, 10) + " | занятий: " + ((u.progress && u.progress.lessons.length) || 0)));
} else if (cmd === "password" && user && value) {
  if (value.length < 8) { console.log("Пароль должен быть не короче 8 символов."); process.exit(1); }
  user.pass = hash(value, "pass"); save(); console.log("Пароль для " + email + " изменён.");
} else if (cmd === "pin" && user && /^\d{4}$/.test(value || "")) {
  user.pin = hash(value, "pin"); save(); console.log("PIN для " + email + " изменён.");
} else if (cmd === "delete" && user) {
  users.splice(users.indexOf(user), 1); save(); console.log("Кабинет " + email + " удалён.");
} else {
  console.log(emailArg && !user ? "Кабинет с почтой " + email + " не найден. Посмотрите список: node admin.js list" : "Неверная команда. Смотрите подсказку в начале файла admin.js.");
  process.exit(1);
}
