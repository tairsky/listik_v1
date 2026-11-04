/* Переключатель языка сайта «Листик»: русский (/) и казахский (/kk/).
   Подключается в <head> всех страниц. Делает три вещи:
   1) рисует стиль кнопки ҚАЗ / РУС в шапке (кнопка лежит в HTML как <a class="lang-sw" data-lang="kk|ru">);
   2) по клику запоминает выбор (localStorage.listik_lang) и ведёт на ту же страницу на другом языке,
      сохраняя ?параметры и #якорь (например #cabinet, #verify=…);
   3) на русской странице, если раньше выбрали казахский, перенаправляет на казахскую версию. */
(function () {
  var KEY = "listik_lang";
  var PAGES = ["index", "about", "pricing", "start", "listik"];
  var p = location.pathname;
  var isKk = p === "/kk" || p.indexOf("/kk/") === 0;
  var rest = isKk ? p.replace(/^\/kk/, "") || "/" : p;
  var m = /^\/([\w-]+)\.html$/.exec(rest);
  var known = rest === "/" || (m && PAGES.indexOf(m[1]) >= 0);

  function target(toKk) {
    var path = toKk ? (rest === "/" ? "/kk/" : "/kk" + rest) : rest;
    return path + location.search + location.hash;
  }

  /* 3. автопереход на казахскую версию */
  if (!isKk && known) {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved === "kk") { location.replace(target(true)); return; }
  }

  /* 1. стиль кнопки */
  var css = ".lang-sw{display:inline-flex;align-items:center;justify-content:center;min-width:52px;min-height:36px;box-sizing:border-box;padding:0 12px;border:2px solid #1F7A45;border-radius:999px;background:transparent;color:#1F7A45!important;font:800 14px/1 Nunito,system-ui,sans-serif;letter-spacing:.04em;text-decoration:none!important;cursor:pointer;transition:background .15s ease,color .15s ease}" +
    ".lang-sw:hover{background:#1F7A45;color:#fff!important}" +
    ".sh-nav a.lang-sw{padding:0 12px;border:2px solid #1F7A45;line-height:1;font-size:14px;font-weight:800}" +
    ".sh-nav a.lang-sw:hover{color:#fff!important}" +
    ".lang-sw:focus-visible{outline:3px solid #2B4EFF;outline-offset:2px}";
  var st = document.createElement("style"); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  /* 2. клик по кнопке */
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a.lang-sw") : null;
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    var toKk = a.getAttribute("data-lang") === "kk";
    try { localStorage.setItem(KEY, toKk ? "kk" : "ru"); } catch (er) {}
    e.preventDefault();
    location.href = target(toKk);
  });
})();
