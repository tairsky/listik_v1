/* Аналитика и рекламные пиксели «Листика».
   Подключается на всех страницах: <script src="/analytics.js" defer></script>
   1) Впишите свои ID в блок IDS ниже. Пустой ID = этот инструмент выключен.
   2) Ничего не загружается, пока посетитель не нажал «Принять» в баннере.
   3) Имена детей, почта и содержимое занятий в аналитику НЕ отправляются. */
(function () {
  var IDS = {
    gtm: "GTM-KWWRLXDB", // Google Tag Manager (GA4, пиксели и теги настраиваются внутри GTM)
    ga4: "",        // Google Analytics 4, например "G-XXXXXXXXXX"
    meta: "",       // Meta (Facebook/Instagram) Pixel, например "1234567890123456"
    tiktok: "",     // TikTok Pixel, например "C1234567890ABCDEF"
    yandex: ""      // Яндекс.Метрика, например "12345678"
  };
  var KEY = "listik_consent";
  var KK = location.pathname === "/kk" || location.pathname.indexOf("/kk/") === 0;
  var T = KK ? {
    text: "Біз сайттың жұмысын талдау және жарнама үшін cookie және аналитика құралдарын қолданамыз.",
    more: "Толығырақ", ok: "Қабылдау", no: "Тек қажеттілері"
  } : {
    text: "Мы используем cookie и инструменты аналитики, чтобы понимать, как работает сайт, и показывать рекламу тем, кому она может быть полезна.",
    more: "Подробнее", ok: "Принять", no: "Только необходимые"
  };
  var loaded = false;

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function anyId() { return IDS.gtm || IDS.ga4 || IDS.meta || IDS.tiktok || IDS.yandex; }
  function script(src) { var s = document.createElement("script"); s.async = true; s.src = src; document.head.appendChild(s); return s; }

  /* События: lkTrack("sign_up"), lkTrack("cta_click", {place: "hero"}). До согласия ничего не отправляется. */
  var MAP = { // наше событие -> события площадок
    sign_up: { ga4: "sign_up", meta: "CompleteRegistration", tiktok: "CompleteRegistration" },
    cta_click: { ga4: "select_content", meta: "Lead", tiktok: "ClickButton" },
    exercise_start: { ga4: "exercise_start", meta: "ViewContent", tiktok: "ViewContent" },
    purchase_intent: { ga4: "begin_checkout", meta: "InitiateCheckout", tiktok: "InitiateCheckout" }
  };
  window.lkTrack = function (name, params) {
    if (!loaded) return;
    var m = MAP[name] || {}; params = params || {};
    try { if (IDS.gtm) { var o = { event: name }; for (var k in params) o[k] = params[k]; (window.dataLayer = window.dataLayer || []).push(o); } } catch (e) {}
    try { if (IDS.ga4 && window.gtag) window.gtag("event", m.ga4 || name, params); } catch (e) {}
    try { if (IDS.meta && window.fbq) window.fbq("track", m.meta || "CustomEvent", params); } catch (e) {}
    try { if (IDS.tiktok && window.ttq) window.ttq.track(m.tiktok || name, params); } catch (e) {}
    try { if (IDS.yandex && window.ym) window.ym(+IDS.yandex, "reachGoal", name, params); } catch (e) {}
  };

  function load() {
    if (loaded || !anyId()) return;
    loaded = true;
    if (IDS.gtm) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
      script("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(IDS.gtm));
    }
    if (IDS.ga4) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", IDS.ga4, { anonymize_ip: true });
      script("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(IDS.ga4));
    }
    if (IDS.meta) {
      (function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", IDS.meta); window.fbq("track", "PageView");
    }
    if (IDS.tiktok) {
      (function (w, d, t) {
        w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || [];
        ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
        ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
        for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
        ttq.load = function (e) { ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._t = ttq._t || {}; ttq._t[e] = +new Date();
          var s = d.createElement("script"); s.async = !0; s.src = "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=" + e + "&lib=" + t;
          var x = d.getElementsByTagName("script")[0]; x.parentNode.insertBefore(s, x); };
        ttq.load(IDS.tiktok); ttq.page();
      })(window, document, "ttq");
    }
    if (IDS.yandex) {
      (function (m, e, t, r, i, k, a) {
        m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); }; m[i].l = 1 * new Date();
        k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
      })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
      window.ym(+IDS.yandex, "init", { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
    }
  }

  function banner() {
    var css = document.createElement("style");
    css.textContent = "#lk-consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:640px;margin:0 auto;background:#fff;color:#1E2A22;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.28);padding:16px 18px;font:15px/1.45 Nunito,Manrope,system-ui,sans-serif}" +
      "#lk-consent p{margin:0 0 12px}#lk-consent a{color:#1F7A45;font-weight:700}" +
      "#lk-consent .r{display:flex;gap:8px;flex-wrap:wrap}#lk-consent button{min-height:44px;border-radius:999px;border:2px solid #1F7A45;padding:8px 20px;font:inherit;font-weight:800;cursor:pointer;background:#fff;color:#1F7A45}" +
      "#lk-consent button.ok{background:#1F7A45;color:#fff}";
    document.head.appendChild(css);
    var d = document.createElement("div");
    d.id = "lk-consent"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Cookie");
    d.innerHTML = "<p>" + T.text + " <a href=\"/privacy.html#cookie\">" + T.more + "</a></p><div class=\"r\"><button class=\"ok\" type=\"button\">" + T.ok + "</button><button class=\"no\" type=\"button\">" + T.no + "</button></div>";
    d.querySelector(".ok").onclick = function () { set("all"); d.remove(); load(); };
    d.querySelector(".no").onclick = function () { set("necessary"); d.remove(); };
    document.body.appendChild(d);
  }

  /* Ссылка «Настройки cookie» для футера: <a href="#" data-cookie-settings> */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-cookie-settings]");
    if (a) { e.preventDefault(); try { localStorage.removeItem(KEY); } catch (x) {} location.reload(); }
    var c = e.target.closest && e.target.closest('a[href$="#register"]');
    if (c) window.lkTrack("cta_click", { place: c.className || "link" });
  });

  function init() {
    if (!anyId()) return;               // нечего подключать, баннер не нужен
    var v = get();
    if (v === "all") load();
    else if (v !== "necessary") banner();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
