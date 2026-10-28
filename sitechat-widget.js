/* Окошко чата-помощника «Спросить Листика». Подключается только на страницах до занятий: главная, О Листике, тарифы, выбор. */
(function () {
  if (window.__listikChat) return; window.__listikChat = 1;
  var WA = "https://wa.me/77759714163", KEY = "listik_sitechat_v1", MAXSEND = 10;
  var msgs = [];
  try { msgs = JSON.parse(sessionStorage.getItem(KEY) || "[]").filter(function (m) { return m && typeof m.text === "string" && (m.role === "user" || m.role === "assistant"); }).slice(-30); } catch (e) { msgs = []; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch (e) {} }

  fetch("/api/chat/available", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) { if (d && d.ok) init(); }).catch(function () {});

  function init() {
    var css = document.createElement("style");
    css.textContent =
      "#lkc-btn{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;min-height:52px;padding:0 20px;border:0;border-radius:999px;background:#1F7A45;color:#fff;font:800 16px/1 Nunito,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(30,42,34,.28)}" +
      "#lkc-btn:hover{background:#15683A}#lkc-btn:focus-visible,#lkc-x:focus-visible,#lkc-send:focus-visible,.lkc-chip:focus-visible,#lkc-in:focus-visible{outline:3px solid #2B4BC4;outline-offset:2px}" +
      "#lkc-p{position:fixed;right:18px;bottom:82px;z-index:2147483001;width:370px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);display:none;flex-direction:column;background:#FBFAF4;border:1px solid #E3E8DC;border-radius:20px;box-shadow:0 12px 40px rgba(30,42,34,.3);overflow:hidden;font:500 16px/1.45 Nunito,system-ui,sans-serif;color:#1E2A22}" +
      "#lkc-p.open{display:flex}" +
      "#lkc-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 12px 18px;background:#1F7A45;color:#fff}#lkc-h b{font-weight:800;font-size:17px}#lkc-h span{display:block;font-weight:500;font-size:13px;opacity:.9}" +
      "#lkc-x{width:44px;height:44px;border:0;border-radius:50%;background:transparent;color:#fff;font-size:26px;line-height:1;cursor:pointer}#lkc-x:hover{background:rgba(255,255,255,.18)}" +
      "#lkc-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}" +
      ".lkc-m{max-width:86%;padding:10px 14px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}" +
      ".lkc-m.a{align-self:flex-start;background:#fff;border:1px solid #E3E8DC;border-bottom-left-radius:4px}.lkc-m.u{align-self:flex-end;background:#E3F1E7;border-bottom-right-radius:4px}" +
      ".lkc-m a{color:#15683A;font-weight:700}" +
      "#lkc-chips{display:flex;flex-wrap:wrap;gap:8px}.lkc-chip{min-height:40px;padding:0 14px;border:1.5px solid #1F7A45;border-radius:999px;background:#fff;color:#15683A;font:700 14px Nunito,system-ui,sans-serif;cursor:pointer}.lkc-chip:hover{background:#E3F1E7}" +
      "#lkc-f{display:flex;gap:8px;padding:10px;border-top:1px solid #E3E8DC;background:#fff}" +
      "#lkc-in{flex:1;min-width:0;min-height:46px;padding:0 14px;border:1.5px solid #CBD5C6;border-radius:999px;font:500 16px Nunito,system-ui,sans-serif;color:#1E2A22;background:#fff}" +
      "#lkc-send{min-width:46px;min-height:46px;border:0;border-radius:999px;background:#F2C14E;color:#1E2A22;font:800 18px Nunito,system-ui,sans-serif;cursor:pointer}#lkc-send:disabled{opacity:.5;cursor:default}" +
      "#lkc-note{padding:0 14px 8px;background:#fff;font-size:12px;color:#4E5D52}" +
      "@media(max-width:520px){#lkc-p{right:8px;left:8px;width:auto;bottom:78px;height:calc(100vh - 100px);max-width:none}#lkc-btn{right:12px;bottom:12px}}";
    document.head.appendChild(css);

    var btn = el("button", { id: "lkc-btn", type: "button", "aria-expanded": "false", "aria-controls": "lkc-p" }, "💬 Есть вопрос!");
    var panel = el("div", { id: "lkc-p", role: "dialog", "aria-label": "Чат-помощник" });
    var head = el("div", { id: "lkc-h" });
    var ht = el("div"); ht.appendChild(el("b", {}, "Помощник")); ht.appendChild(el("span", {}, "Отвечает на вопросы о сайте и тарифах"));
    var close = el("button", { id: "lkc-x", type: "button", "aria-label": "Закрыть чат" }, "×");
    head.appendChild(ht); head.appendChild(close);
    var log = el("div", { id: "lkc-log", "aria-live": "polite" });
    var form = el("form", { id: "lkc-f" });
    var input = el("input", { id: "lkc-in", type: "text", maxlength: "500", placeholder: "Напишите вопрос", "aria-label": "Ваш вопрос", autocomplete: "off" });
    var send = el("button", { id: "lkc-send", type: "submit", "aria-label": "Отправить" }, "➤");
    form.appendChild(input); form.appendChild(send);
    var note = el("div", { id: "lkc-note" }, "Это программа, не человек. Личные данные в чат не пишите. Задачи решает Листик на занятии.");
    panel.appendChild(head); panel.appendChild(log); panel.appendChild(form); panel.appendChild(note);
    document.body.appendChild(panel); document.body.appendChild(btn);

    var busy = false, chipsEl = null;
    function el(tag, attrs, text) { var e = document.createElement(tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; return e; }
    function fill(node, text) {            // текст безопасно (без HTML), ссылки превращаются в кликабельные
      var re = /(https?:\/\/[^\s)]+)/g, last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
        var url = m[1].replace(/[.,;!?]+$/, "");
        if (/^https:\/\/wa\.me\//.test(url)) { var a = el("a", { href: url, target: "_blank", rel: "noopener" }, "WhatsApp"); node.appendChild(a); }
        else node.appendChild(document.createTextNode(url));
        last = m.index + url.length; re.lastIndex = last;
      }
      if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
    }
    function add(role, text) { var d = el("div", { "class": "lkc-m " + (role === "user" ? "u" : "a") }); fill(d, text); log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
    function render() {
      log.textContent = "";
      add("assistant", "Здравствуйте! Я помощник. Расскажу, как проходят занятия, что в пробном и основном тарифе, и подскажу, с чего начать.");
      msgs.forEach(function (m) { add(m.role, m.text); });
      if (!msgs.length) {
        chipsEl = el("div", { id: "lkc-chips" });
        ["Как проходит занятие?", "Что в бесплатной пробе?", "Сколько стоит?", "Для какого класса?"].forEach(function (q) {
          var c = el("button", { type: "button", "class": "lkc-chip" }, q); c.addEventListener("click", function () { ask(q); }); chipsEl.appendChild(c);
        });
        log.appendChild(chipsEl);
      }
    }
    function setBusy(v) { busy = v; send.disabled = v; input.disabled = v; }
    function ask(text) {
      text = String(text || "").trim().slice(0, 500);
      if (!text || busy) return;
      if (chipsEl && chipsEl.parentNode) chipsEl.parentNode.removeChild(chipsEl);
      msgs.push({ role: "user", text: text }); save(); add("user", text); input.value = "";
      setBusy(true);
      var wait = add("assistant", "Думаю…");
      fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ messages: msgs.slice(-MAXSEND).map(function (m) { return { role: m.role, text: m.text }; }) })
      }).then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
        .then(function (x) {
          var reply = x.d && x.d.reply;
          if (!reply) reply = x.status === 429 ? "Вы задали много вопросов подряд. Подождите немного или напишите нам в WhatsApp: " + WA
            : "Сейчас не получается ответить. Напишите нам в WhatsApp: " + WA;
          wait.textContent = ""; fill(wait, reply);
          if (x.d && x.d.reply) { msgs.push({ role: "assistant", text: reply }); save(); }
          else msgs.pop(), save();
        })
        .catch(function () { wait.textContent = ""; fill(wait, "Нет связи. Проверьте интернет или напишите нам в WhatsApp: " + WA); msgs.pop(); save(); })
        .then(function () { setBusy(false); log.scrollTop = log.scrollHeight; input.focus(); });
    }
    function toggle(open) {
      var o = open === undefined ? !panel.classList.contains("open") : open;
      panel.classList.toggle("open", o); btn.setAttribute("aria-expanded", o ? "true" : "false");
      btn.style.display = (o && window.innerWidth <= 520) ? "none" : "";
      if (o) { if (!log.childNodes.length) render(); setTimeout(function () { input.focus(); }, 50); } else btn.focus();
    }
    btn.addEventListener("click", function () { toggle(true); });
    close.addEventListener("click", function () { toggle(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.classList.contains("open")) toggle(false); });
    form.addEventListener("submit", function (e) { e.preventDefault(); ask(input.value); });
  }
})();
