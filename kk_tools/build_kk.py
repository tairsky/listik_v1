#!/usr/bin/env python3
"""Сборка казахской версии сайта: русские страницы -> kk/*.html.
Запуск из папки listik:   python3 kk_tools/build_kk.py
Что делает:
  1. читает переводы (kk_tools/tr_*.tsv: «номер<TAB>текст по-казахски»), собирает словарь kk_dict.json (рус -> каз);
  2. в каждой странице заменяет русские фразы (текст страниц и строки в скриптах) на казахские;
  3. переписывает внутренние ссылки на /kk/..., ставит кнопку РУС, lang="kk";
  4. пишет kk/*.html, kk/site.css, kk/sitechat-widget.js;
  5. печатает, какие русские фразы остались без перевода (часть нарочно: упражнения, команды голосу).
Если вы поменяли русский текст страницы, фраза перестанет находиться в словаре: добавьте перевод в kk_dict.json
(ключ — русская фраза, значение — казахская) и запустите сборку ещё раз."""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
os.chdir(ROOT)
sys.path.insert(0, HERE)
from extract import spans

PAGES = ["index.html", "about.html", "pricing.html", "start.html", "listik.html"]
EXTRA = ["sitechat-widget.js"]

# --- 1. словарь ---
def load_tsv(path):
    d = {}
    for line in open(path, encoding="utf8").read().split("\n"):
        if not line.strip(): continue
        i, t = line.split("\t", 1)
        d[int(i)] = t
    return d
todo = json.load(open(os.path.join(HERE, "todo.json"), encoding="utf8"))
ltodo = json.load(open(os.path.join(HERE, "listik_todo.json"), encoding="utf8"))
DICT = {}
conflicts = []
def add(ru, kk, src):
    if ru in DICT and DICT[ru] != kk: conflicts.append((src, ru[:50], DICT[ru][:50], kk[:50]))
    DICT[ru] = kk
for f, tsv in [("index.html", "tr_index.tsv"), ("about.html", "tr_about.tsv"), ("pricing.html", "tr_pricing.tsv"),
               ("start.html", "tr_start.tsv"), ("sitechat-widget.js", "tr_widget.tsv")]:
    for i, kk in load_tsv(os.path.join(HERE, tsv)).items(): add(todo[f][i], kk, tsv)
for n in (1, 2, 3):
    for i, kk in load_tsv(os.path.join(HERE, "tr_listik_%d.tsv" % n)).items(): add(ltodo[i], kk, "listik_%d" % n)
# ручные дополнения (kk_dict_extra.json): рус -> каз, перекрывают всё
extra = os.path.join(HERE, "kk_dict_extra.json")
if os.path.exists(extra):
    for k, v in json.load(open(extra, encoding="utf8")).items(): DICT[k] = v
json.dump(DICT, open(os.path.join(HERE, "kk_dict.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)

# --- 2. проверка перевода: теги и кавычки должны совпасть, иначе сломается страница ---
TAG = re.compile(r"<[^>]+>|\$\{[^}]*\}")
def _t(t): return re.sub(r'="[^"]*"', '=""', t)
def sig(s): return ([_t(t) for t in TAG.findall(s)], [s.count(c) for c in '"\'`\\'])
bad = [(ru, kk) for ru, kk in DICT.items() if sig(ru) != sig(kk)]

# --- 3. замена по позициям ---
left = {}
def translate(name, s):
    out = s
    for a, b in sorted(spans(s), reverse=True):
        t = s[a:b]
        if t in DICT: out = out[:a] + DICT[t] + out[b:]
        else: left.setdefault(name, []).append(t)
    return out

WA_KK = {"Здравствуйте! Хочу оформить тариф «Репетитор: 1 месяц».": "Сәлеметсіз бе! «Репетитор: 1 ай» тарифін рәсімдегім келеді."}
LINK = re.compile(r"""(["'(])/(about|pricing|start|listik|index)\.html""")
def links(s):
    s = LINK.sub(lambda m: m.group(1) + "/kk/" + m.group(2) + ".html", s)
    s = s.replace('href="/"', 'href="/kk/"')
    s = s.replace('url("fonts/', 'url("/fonts/').replace('"data/public/', '"/data/public/')
    s = s.replace('"/site.css"', '"/kk/site.css"').replace('"/sitechat-widget.js"', '"/kk/sitechat-widget.js"')
    return s

os.makedirs("kk", exist_ok=True)
SW_KK = re.compile(r'<a class="lang-sw"[^>]*data-lang="kk"[^>]*>[^<]*</a>')
for f in PAGES:
    s = open(f, encoding="utf8").read()
    s = translate(f, s)
    s = links(s)
    if f == "listik.html":
        # тексты ошибок, которые присылает сервер по-русски, переводим при получении
        msgs = json.load(open(os.path.join(HERE, "server_messages.json"), encoding="utf8"))
        old = "  const data = await res.json().catch(() => ({}));\n  return { status: res.status, data };"
        assert s.count(old) == 1, "api(): не нашёл место для перевода сообщений сервера"
        s = s.replace(old, "  const data = await res.json().catch(() => ({}));\n  const KKMSG = " + json.dumps(msgs, ensure_ascii=False) + ";\n  if (data && typeof data.message === \"string\" && KKMSG[data.message]) data.message = KKMSG[data.message];\n  return { status: res.status, data };")
    s = s.replace('<html lang="ru">', '<html lang="kk">', 1)
    from urllib.parse import quote, unquote
    def wa(m):
        txt = unquote(m.group(1))
        return "wa.me/77759714163?text=" + quote(WA_KK.get(txt, txt), safe="") if txt in WA_KK else m.group(0)
    s = re.sub(r"wa\.me/77759714163\?text=([^\"'&\s]+)", wa, s)
    ru_href = "/" if f == "index.html" else "/" + f
    s, n = SW_KK.subn('<a class="lang-sw" href="%s" hreflang="ru" lang="ru" data-lang="ru" aria-label="Русский" title="Русский">РУС</a>' % ru_href, s)
    assert n == 1, f + ": кнопка языка не найдена"
    open(os.path.join("kk", f), "w", encoding="utf8").write(s)

s = open("site.css", encoding="utf8").read()
open("kk/site.css", "w", encoding="utf8").write(links(s).replace("/listik.html#", "/kk/listik.html#"))

w = translate("sitechat-widget.js", open("sitechat-widget.js", encoding="utf8").read())
assert "JSON.stringify({ messages:" in w
w = w.replace("JSON.stringify({ messages:", 'JSON.stringify({ lang: "kk", messages:', 1)
w = w.replace("listik_sitechat_v1", "listik_sitechat_v1_kk", 1)
open("kk/sitechat-widget.js", "w", encoding="utf8").write(w)

# --- 4. отчёт ---
print("Словарь: %d фраз (kk_tools/kk_dict.json)" % len(DICT))
if conflicts: print("\nКОНФЛИКТЫ (одна рус. фраза переведена по-разному):"); [print("  ", c) for c in conflicts]
if bad:
    print("\nОШИБКА В ПЕРЕВОДЕ (не совпадают теги/кавычки):")
    for ru, kk in bad: print("  RU:", ru[:90].replace("\n", " ")); print("  KK:", kk[:90].replace("\n", " "))
print("\nБез перевода осталось (по странице):")
for f, l in left.items():
    seen = []
    for t in l:
        if t not in seen: seen.append(t)
    print(" %s: %d" % (f, len(seen)))
    if "-v" in sys.argv:
        for t in seen: print("    -", t[:110].replace("\n", " "))
sys.exit(1 if bad else 0)
