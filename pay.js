"use strict";
/* Оплата подписки через интернет-эквайринг.

   Как это работает:
   1. Родитель (режим родителя) нажимает «Оплатить»: POST /api/pay/create. Сервер создаёт заказ (сумма берётся ТОЛЬКО здесь,
      из браузера её принять нельзя) и отдаёт адрес платёжной страницы.
   2. Банк присылает уведомление: POST /api/pay/callback. Только оно подтверждает оплату. Подпись проверяется.
   3. Сервер продлевает подписку: +PAY_DAYS дней от конца действующей (или от сегодняшнего дня) и шлёт квитанцию.
   4. Страница /pay/result спрашивает GET /api/pay/status и ждёт, пока оплата подтвердится. Адресу возврата от банка не верим.

   Режимы (переменная PAY_MODE):
     не задана  — оплата выключена, кнопки на сайте не показываются (работает старая схема через WhatsApp);
     stub       — «заглушка банка» для проверки без денег. На Render включается только с PAY_ALLOW_STUB=1;
     live       — настоящий банк. ПОКА НЕ ПОДКЛЮЧЁН: ждём схему PayLink (см. LIVE ниже), без неё режим остаётся выключенным.

   Настройки (в хостинге, не в коде): PAY_MODE, PAY_PRICE (по умолчанию 9900), PAY_DAYS (30), PAY_SECRET (ключ подписи). */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

module.exports = function createPay(ctx) {
  const { STORE_DIR, getUsers, saveUsers, hasPlan, isParent, MAIL, siteUrl, send, tooMany, hit, MIN, SUBJECT } = ctx;
  const PRICE = Math.round(Number(process.env.PAY_PRICE) || 9900);
  const DAYS = Math.round(Number(process.env.PAY_DAYS) || 30);
  const REQ = String(process.env.PAY_MODE || "").toLowerCase();
  const STUB_OK = REQ === "stub" && !(process.env.RENDER && process.env.PAY_ALLOW_STUB !== "1");
  /* LIVE: сюда подключается PayLink, когда будет их документация. Нужны две функции:
       create(order, resultUrl) -> адрес платёжной страницы (строка);
       verify(req, raw)         -> { order, status: "paid"|"failed", amount, ref } или null, если подпись не сошлась.
     Пока null: режим live не включается. */
  const LIVE = null;
  const MODE = STUB_OK ? "stub" : (REQ === "live" && LIVE ? "live" : "");
  const SECRET = process.env.PAY_SECRET || crypto.randomBytes(32).toString("hex");   // без PAY_SECRET подписать уведомление снаружи невозможно

  /* ---------- заказы ---------- */
  const FILE = path.join(STORE_DIR, "payments.json");
  let ORDERS = [];
  if (fs.existsSync(FILE)) ORDERS = JSON.parse(fs.readFileSync(FILE, "utf8"));   // если файл испорчен, лучше упасть, чем затереть заказы
  function saveOrders() {
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(ORDERS, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }
  const iso = () => new Date().toISOString();
  const findOrder = id => ORDERS.find(o => o.id === id);
  const cleanReturn = p => (typeof p === "string" && /^\/(?!\/)[\w\-./?=&%]{0,200}$/.test(p)) ? p : "/listik.html";
  const resultUrl = (req, o) => siteUrl(req) + (o.lang === "kk" ? "/kk" : "") + "/pay/result?order=" + encodeURIComponent(o.id);

  /* продление подписки: от конца действующей, иначе от сегодняшнего дня */
  function extendPlan(user, days) {
    const cur = hasPlan({ user }) ? Date.parse(user.plan.until) : Date.now();
    user.plan = { until: new Date(cur + days * 86400000).toISOString() };
    return user.plan.until;
  }

  /* ---------- подтверждение оплаты (единственное место, где подписка продлевается) ---------- */
  function settle(id, status, amount, ref) {
    const o = findOrder(id);
    if (!o) return { code: 404 };
    if (o.status === "paid") return { code: 200, order: o, already: true };          // повторное уведомление: ничего не делаем
    if (status === "paid") {
      if (Number(amount) !== o.amount) {
        o.problem = "сумма " + amount + " вместо " + o.amount; o.problemAt = iso(); saveOrders();
        console.error("[оплата] заказ " + o.id + ": " + o.problem + ", подписка не продлена");
        return { code: 409 };
      }
      const user = getUsers().find(u => u.id === o.uid);
      if (!user) { o.problem = "кабинет не найден"; o.problemAt = iso(); saveOrders(); return { code: 410 }; }
      if (!(user.lastPayment && user.lastPayment.order === o.id)) {                  // защита от двойного зачисления после сбоя
        const until = extendPlan(user, o.days);
        user.lastPayment = { order: o.id, at: iso(), amount: o.amount, until };
        saveUsers();
      }
      o.status = "paid"; o.paidAt = iso(); o.ref = String(ref || "").slice(0, 80); o.until = user.plan.until; delete o.problem;
      saveOrders();
      MAIL.paymentReceipt(user.email, user.child && user.child.name, o.amount, o.until, o.id)
        .catch(e => console.error("[письмо] квитанция не ушла:", e.message));
      return { code: 200, order: o };
    }
    if (o.status === "pending") { o.status = "failed"; o.failedAt = iso(); saveOrders(); }
    return { code: 200, order: o };
  }

  /* ---------- подпись уведомления (для заглушки и по умолчанию: HMAC-SHA256 по телу запроса) ---------- */
  const sign = raw => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  function verifyDefault(req, raw) {
    const sig = String(req.headers["x-signature"] || "");
    const want = sign(raw);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    let d; try { d = JSON.parse(raw); } catch (e) { return null; }
    return { order: String(d.order || ""), status: d.status === "paid" ? "paid" : "failed", amount: d.amount, ref: d.ref };
  }

  /* ---------- запросы ---------- */
  const query = req => new URL(req.url, "http://x").searchParams;

  /* POST /api/pay/callback: вызывает банк, без входа в кабинет и без проверки источника запроса (она — в подписи) */
  function callback(req, res) {
    if (!MODE) return send(res, 404, { error: "not_found" });
    let raw = "", big = false;
    req.on("data", c => { raw += c; if (raw.length > 16384) { big = true; req.destroy(); } });
    req.on("end", () => {
      if (big) return;
      const d = LIVE && MODE === "live" ? LIVE.verify(req, raw) : verifyDefault(req, raw);
      if (!d) { console.error("[оплата] уведомление отклонено: подпись не сошлась"); return send(res, 403, { error: "signature" }); }
      const r = settle(d.order, d.status, d.amount, d.ref);
      console.log("[оплата] заказ " + d.order + ": " + d.status + " -> " + r.code);
      send(res, r.code, { ok: r.code === 200 });
    });
    req.on("error", () => {});
  }

  /* GET /api/pay/config: сайт спрашивает, показывать ли кнопки оплаты */
  const config = (res) => send(res, 200, { enabled: !!MODE, price: PRICE, days: DAYS });

  /* POST /api/pay/create (только режим родителя) */
  function create(req, res, a, b) {
    if (!MODE) return send(res, 503, { error: "pay_disabled", message: "Онлайн-оплата пока не подключена. Напишите нам в WhatsApp." });
    if (!a) return send(res, 401, { error: "login" });
    if (!isParent(a)) return send(res, 403, { error: "parent_required" });
    if (SUBJECT && a.user.child && a.user.child.grade && a.user.child.grade !== SUBJECT.grade)   // упражнений для этого класса пока нет: не берём деньги
      return send(res, 403, { error: "grade", message: "Для класса вашего ребёнка упражнений пока нет, оплата недоступна." });
    if (tooMany("pay:" + a.user.id, 10, 60 * MIN)) return send(res, 429, { error: "too_many" });
    hit("pay:" + a.user.id);
    const o = { id: "L" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex"), uid: a.user.id, email: a.user.email,
      amount: PRICE, days: DAYS, status: "pending", lang: b.lang === "kk" ? "kk" : "ru", returnTo: cleanReturn(b.returnTo), createdAt: iso() };
    ORDERS.push(o); saveOrders();
    const url = MODE === "stub" ? "/api/pay/stub?order=" + o.id : LIVE.create(o, resultUrl(req, o));
    send(res, 200, { ok: true, url, order: o.id });
  }

  /* GET /api/pay/status?order=...: страница результата ждёт подтверждения от банка */
  function status(req, res, a) {
    if (!a) return send(res, 401, { error: "login" });
    const o = findOrder(query(req).get("order") || "");
    if (!o || o.uid !== a.user.id) return send(res, 404, { error: "not_found" });
    send(res, 200, { status: o.status, until: o.until || null, returnTo: o.returnTo, amount: o.amount, lang: o.lang });
  }

  /* ---------- заглушка банка (только PAY_MODE=stub) ---------- */
  function stubPage(req, res, a) {
    const o = MODE === "stub" && a && findOrder(query(req).get("order") || "");
    if (!o || o.uid !== a.user.id || o.status !== "pending") { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Не найдено"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Тестовая оплата</title>' +
      '<style>body{font-family:Arial,sans-serif;max-width:460px;margin:40px auto;padding:0 20px;color:#1E2A22}button{font-size:18px;padding:14px 22px;border-radius:12px;border:0;margin:6px 6px 0 0;cursor:pointer}.ok{background:#1F7A45;color:#fff}.no{background:#eee}.t{background:#fff3cd;padding:10px 14px;border-radius:10px}</style></head><body>' +
      '<p class="t"><b>ЗАГЛУШКА БАНКА.</b> Деньги не списываются. Страница нужна только для проверки.</p><h1>Оплата: ' + o.amount + ' ₸</h1><p>Подписка на ' + o.days + ' дней.</p>' +
      '<button class="ok" id="ok">Оплата прошла</button><button class="no" id="no">Отказаться</button><p id="m"></p>' +
      '<script>function go(r){fetch("/api/pay/stub-confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({order:' + JSON.stringify(o.id) + ',result:r})})' +
      '.then(function(x){return x.json()}).then(function(d){if(d.redirect)location.href=d.redirect;else document.getElementById("m").textContent="Ошибка"})}' +
      'document.getElementById("ok").onclick=function(){go("paid")};document.getElementById("no").onclick=function(){go("failed")};</script></body></html>');
  }
  function stubConfirm(req, res, a, b) {
    if (MODE !== "stub") return send(res, 404, { error: "not_found" });
    const o = a && findOrder(String(b.order || ""));
    if (!o || o.uid !== a.user.id) return send(res, 404, { error: "not_found" });
    const r = settle(o.id, b.result === "paid" ? "paid" : "failed", o.amount, "stub");
    send(res, r.code, { ok: r.code === 200, redirect: resultUrl(req, o).replace(/^https?:\/\/[^/]+/, "") });
  }

  return { callback, config, create, status, stubPage, stubConfirm, settle, extendPlan, sign, get mode() { return MODE; }, get orders() { return ORDERS; } };
};
