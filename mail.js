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
    body: JSON.stringify({ from: FROM, to: [to], subject, text: to === BILLING ? text : text + FOOT_TEXT, html }),
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error("Resend ответил " + r.status + ": " + (await r.text()).slice(0, 200));
  return { queued: true };
}

const SITE = (process.env.SITE_URL || "https://listik.kz").replace(/\/+$/, "");
const TG = "https://t.me/tairsky";
/* реквизиты и контакты: те же, что в подвале сайта */
const FOOT_TEXT = "\n\n--\nЛистик, ИИ-репетитор для школьников\nИП «Феникс», ИИН 460104400918\nг. Алматы, ул. Утеген батыра 17б\ninfo@listik.kz, +7 (775) 971-41-63\nWhatsApp: " + WA + "\nTelegram: " + TG + "\nСайт: " + SITE + "\nЭто служебное письмо сервиса «Листик».";

/* общий вид письма: таблицы и встроенные стили, чтобы одинаково открывалось в Gmail, Mail.ru, Яндексе и Outlook */
const wrap = (title, bodyHtml, btnText, btnUrl) =>
  '<div style="margin:0;padding:24px 12px;background:#F3EFE0;font-family:Arial,Helvetica,sans-serif;color:#1E2A22;line-height:1.55">' +
  '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:560px;margin:0 auto">' +
  /* шапка: логотип и название */
  '<tr><td style="padding:4px 4px 16px">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="vertical-align:middle"><a href="' + SITE + '" style="text-decoration:none"><img src="' + SITE + '/img/email-logo.png" width="48" height="44" alt="Листик" style="display:block;border:0;width:48px;height:44px"></a></td>' +
    '<td style="vertical-align:middle;padding-left:10px;font-size:28px;font-weight:800;color:#006429;letter-spacing:-0.01em"><a href="' + SITE + '" style="color:#006429;text-decoration:none">Листик</a></td>' +
    '</tr></table></td></tr>' +
  /* карточка с содержанием */
  '<tr><td style="background:#FFFFFF;border:1px solid #E3E0CF;border-top:4px solid #1F7A45;border-radius:16px;padding:28px 28px 24px;font-size:16px;color:#1E2A22">' +
    '<h1 style="font-size:24px;line-height:1.25;margin:0 0 14px;color:#1E2A22">' + title + '</h1>' + bodyHtml +
    (btnUrl ? '<p style="margin:26px 0 6px"><a href="' + esc(btnUrl) + '" style="display:inline-block;background:#1F7A45;color:#FFFFFF;font-weight:700;font-size:17px;text-decoration:none;padding:14px 30px;border-radius:999px">' + btnText + '</a></p>' : "") +
  '</td></tr>' +
  /* подвал: контакты и реквизиты */
  '<tr><td style="padding:20px 8px 0;font-size:13px;line-height:1.6;color:#6B7A70;text-align:center">' +
    '<p style="margin:0 0 8px">Есть вопросы? Напишите нам: <a href="' + WA + '" style="color:#1F7A45;font-weight:700">WhatsApp</a> · <a href="' + TG + '" style="color:#1F7A45;font-weight:700">Telegram</a> · <a href="mailto:info@listik.kz" style="color:#1F7A45;font-weight:700">info@listik.kz</a></p>' +
    '<p style="margin:0 0 8px;border-top:1px solid #DDD8C3;padding-top:12px">Листик, ИИ-репетитор для школьников<br>ИП «Феникс», ИИН 460104400918<br>г. Алматы, ул. Утеген батыра 17б<br>+7 (775) 971-41-63</p>' +
    '<p style="margin:0"><a href="' + SITE + '/privacy.html" style="color:#6B7A70">Политика конфиденциальности</a> · <a href="' + SITE + '/terms.html" style="color:#6B7A70">Пользовательское соглашение</a></p>' +
    '<p style="margin:8px 0 0;font-size:12px;color:#8A968D">Это служебное письмо сервиса «Листик».</p>' +
  '</td></tr></table></div>';

/* письмо после регистрации */
function welcome(email, childName, site) {
  const url = site + "/listik.html#login";
  const text = "Здравствуйте!\n\nКабинет родителя в Листике создан." + (childName ? " Ребёнок: " + childName + "." : "") + "\nАдрес для входа: " + email + "\n\n" +
    "Как начать:\n1. Войдите в кабинет: " + url + "\n2. Выберите раздел и задачу, по которой занимается ребёнок.\n3. Листик объяснит её по шагам. Кабинет сохраняет прогресс ребёнка.\n\n" +
    "Пароль и PIN-код мы не высылаем и не храним в открытом виде. Если вы не создавали кабинет, просто проигнорируйте это письмо.\n\nЕсли есть вопросы: " + WA;
  const html = wrap("Кабинет создан",
    "<p>Здравствуйте! Кабинет родителя создан." + (childName ? " Ребёнок: <b>" + esc(childName) + "</b>." : "") + "<br>Адрес для входа: <b>" + esc(email) + "</b></p>" +
    "<p><b>Как начать</b></p><ol style='padding-left:20px'><li>Войдите в кабинет.</li><li>Выберите раздел и задачу, по которой занимается ребёнок.</li><li>Листик объяснит её по шагам.</li></ol>" +
    "<p style='font-size:14px;color:#445'>Пароль и PIN-код мы не высылаем и не храним в открытом виде. Если вы не создавали кабинет, просто проигнорируйте это письмо.</p>",
    "Войти в Листик", url);
  return sendMail({ to: email, subject: "Добро пожаловать в Листик: кабинет создан", text, html });
}

/* письмо со ссылкой для подтверждения почты: до перехода по ней войти в кабинет нельзя */
function verifyEmail(email, childName, url) {
  const text = "Здравствуйте!\n\nВы создали кабинет родителя в Листике" + (childName ? " (ребёнок: " + childName + ")" : "") + ". Чтобы включить его, подтвердите почту: откройте ссылку (она действует 48 часов):\n" + url +
    "\n\nЕсли вы не регистрировались, просто проигнорируйте это письмо: без подтверждения кабинет не откроется.\n\nЕсли есть вопросы: " + WA;
  const html = wrap("Подтвердите почту",
    "<p>Вы создали кабинет родителя в Листике" + (childName ? " (ребёнок: <b>" + esc(childName) + "</b>)" : "") + ". Нажмите на кнопку, чтобы подтвердить почту и открыть кабинет. Ссылка действует 48 часов.</p>" +
    "<p style='font-size:14px;color:#445'>Если вы не регистрировались, проигнорируйте это письмо: без подтверждения кабинет не откроется.</p>",
    "Подтвердить почту", url);
  return sendMail({ to: email, subject: "Листик: подтвердите почту", text, html });
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

/* отказ от продления подписки (или возврат продления): письмо родителю и уведомление в billing@ */
const BILLING = process.env.BILLING_EMAIL || "billing@listik.kz";
function renewalChange(email, childName, until, undo) {
  const d = until ? new Date(until).toLocaleDateString("ru-RU") : "—";
  const subject = undo ? "Листик: продление снова включено" : "Листик: вы отказались от продления";
  const text = undo
    ? "Здравствуйте!\n\nПродление подписки Листика снова включено. Оплаченный период действует до " + d + ".\n\nЕсли есть вопросы: " + WA
    : "Здравствуйте!\n\nМы получили ваш отказ от продления подписки Листика. Подписка действует до " + d + " и дальше продлеваться не будет.\n\nЕсли вы нажали по ошибке, вернуть продление можно в кабинете родителя, в блоке «Подписка».\n\nЕсли есть вопросы: " + WA;
  const html = wrap(undo ? "Продление снова включено" : "Вы отказались от продления",
    "<p>" + esc(text.split("\n\n")[1]) + "</p>" + (undo ? "" : "<p style='font-size:14px;color:#445'>" + esc(text.split("\n\n")[2]) + "</p>"));
  const note = (undo ? "Продление снова включено" : "Отказ от продления") + "\nПочта: " + email + "\nИмя ребёнка: " + (childName || "—") + "\nПодписка действует до: " + d;
  return Promise.all([
    sendMail({ to: email, subject, text, html }),
    sendMail({ to: BILLING, subject: (undo ? "Продление включено: " : "Отказ от продления: ") + email, text: note, html: "<pre style='font-family:inherit'>" + esc(note) + "</pre>" })
  ]);
}

/* квитанция об оплате подписки */
function paymentReceipt(email, childName, amount, until, orderId) {
  const d = new Date(until).toLocaleDateString("ru-RU");
  const text = "Здравствуйте!\n\nОплата получена: " + amount + " ₸. Подписка Листика для ребёнка " + (childName || "—") + " действует до " + d + ".\n\nНомер платежа: " + orderId +
    "\n\nЕсли что-то не так, напишите на " + BILLING + ". Возврат: условия в разделе 7 Пользовательского соглашения.";
  const html = wrap("Оплата получена",
    "<p>Спасибо! Оплата <b>" + esc(amount) + " ₸</b> получена. Подписка для ребёнка <b>" + esc(childName || "—") + "</b> действует до <b>" + esc(d) + "</b>.</p>" +
    "<p style='font-size:14px;color:#445'>Номер платежа: " + esc(orderId) + ". Если что-то не так, напишите на " + esc(BILLING) + ".</p>", "Открыть Листик", (process.env.SITE_URL || "") + "/listik.html");
  return sendMail({ to: email, subject: "Листик: оплата получена", text, html });
}

module.exports = { sendMail, welcome, verifyEmail, passwordReset, renewalChange, paymentReceipt, configured: !!KEY };
