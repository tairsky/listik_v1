/* Отправка писем. Используется сервис Resend (https://resend.com): письма уходят по HTTPS, отдельных библиотек не нужно.
   Нужны две переменные (в .env или в настройках хостинга):
     RESEND_API_KEY=re_...                      ключ из кабинета Resend
     MAIL_FROM=Листик <hello@ваш-домен.kz>     адрес отправителя; домен должен быть подтверждён в Resend
   Если ключа нет, письма никуда не уходят, а дописываются в storage/outbox.log (удобно для проверки на своём компьютере). */
const fs = require("fs");
const path = require("path");

const KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.MAIL_FROM || "Листик <onboarding@resend.dev>";
const OUTBOX = path.join(process.env.STORE_DIR || path.join(__dirname, "storage"), "outbox.log");
const WA = "https://wa.me/77759714163";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function sendMail({ to, subject, text, html }) {
  if (!KEY) {
    fs.appendFileSync(OUTBOX, "=== " + new Date().toISOString() + " | кому: " + to + " | тема: " + subject + "\n" + text + "\n\n", { mode: 0o600 });
    console.log("[письмо] RESEND_API_KEY не задан: письмо для " + to.replace(/^(.).*(@.*)$/, "$1***$2") + " записано в storage/outbox.log");
    return { queued: false };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error("Resend ответил " + r.status + ": " + (await r.text()).slice(0, 200));
  return { queued: true };
}

const wrap = (title, bodyHtml, btnText, btnUrl) =>
  '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1E2A22;line-height:1.55">' +
  '<div style="font-size:28px;font-weight:800;color:#006429;margin-bottom:12px">Листик</div>' +
  '<h1 style="font-size:22px;margin:0 0 12px">' + title + '</h1>' + bodyHtml +
  (btnUrl ? '<p style="margin:24px 0"><a href="' + esc(btnUrl) + '" style="display:inline-block;background:#1F7A45;color:#fff;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:999px">' + btnText + '</a></p>' : "") +
  '<p style="font-size:13px;color:#667;margin-top:28px">Если у вас есть вопросы, напишите нам в <a href="' + WA + '">WhatsApp</a>.</p></div>';

/* письмо после регистрации */
function welcome(email, childName, site) {
  const url = site + "/listik.html#login";
  const text = "Здравствуйте!\n\nКабинет родителя в Листике создан. Ребёнок: " + childName + ".\nАдрес для входа: " + email + "\n\n" +
    "Как начать:\n1. Войдите в кабинет: " + url + "\n2. Выберите раздел и задачу, по которой занимается ребёнок.\n3. Листик объяснит её по шагам. На трудном шаге взрослый может открыть подсказку по PIN-коду.\n\n" +
    "Пароль и PIN-код мы не высылаем и не храним в открытом виде. Если вы не создавали кабинет, просто проигнорируйте это письмо.\n\nЕсли есть вопросы: " + WA;
  const html = wrap("Кабинет создан",
    "<p>Здравствуйте! Кабинет родителя создан для ребёнка: <b>" + esc(childName) + "</b>.<br>Адрес для входа: <b>" + esc(email) + "</b></p>" +
    "<p><b>Как начать</b></p><ol style='padding-left:20px'><li>Войдите в кабинет.</li><li>Выберите раздел и задачу, по которой занимается ребёнок.</li><li>Листик объяснит её по шагам. На трудном шаге взрослый может открыть подсказку по PIN-коду.</li></ol>" +
    "<p style='font-size:14px;color:#445'>Пароль и PIN-код мы не высылаем и не храним в открытом виде. Если вы не создавали кабинет, просто проигнорируйте это письмо.</p>",
    "Войти в Листик", url);
  return sendMail({ to: email, subject: "Добро пожаловать в Листик: кабинет создан", text, html });
}

/* письмо со ссылкой для нового пароля */
function passwordReset(email, url) {
  const text = "Здравствуйте!\n\nВы попросили восстановить пароль к кабинету Листика. Откройте ссылку и задайте новый пароль (она действует 1 час):\n" + url +
    "\n\nЕсли вы ничего не просили, проигнорируйте это письмо: пароль останется прежним.\n\nЕсли есть вопросы: " + WA;
  const html = wrap("Новый пароль",
    "<p>Вы попросили восстановить пароль к кабинету Листика. Нажмите на кнопку и задайте новый пароль. Ссылка действует 1 час.</p>" +
    "<p style='font-size:14px;color:#445'>Если вы ничего не просили, проигнорируйте это письмо: пароль останется прежним.</p>",
    "Задать новый пароль", url);
  return sendMail({ to: email, subject: "Листик: восстановление пароля", text, html });
}

module.exports = { sendMail, welcome, passwordReset, configured: !!KEY };
