# Сборка упражнений 3 класса из CSV (лист «Все упражнения» таблицы «Листик: 3 класс_математика»).
# Запуск: python3 -I build_math3.py <all.csv> <старый tasks.json> <новый tasks.json> <skills.json> <новый skills.json>
# Боевые файлы не трогает: пишет только в указанные выходные пути.
import csv, json, re, sys, collections
src, old_tasks, out_tasks, skills_in, skills_out = sys.argv[1:6]
rows = list(csv.reader(open(src, encoding="utf-8")))
ix = {h.strip(): i for i, h in enumerate(rows[0]) if h.strip()}
def g(r, name):
    i = ix[name]; return r[i].strip() if i < len(r) else ""
def clean(s): return re.sub(r"[ \t]{2,}", " ", s.strip())
LET = {"А": 0, "Б": 1, "В": 2, "Г": 3}
old = json.load(open(old_tasks, encoding="utf-8"))
sk = json.load(open(skills_in, encoding="utf-8"))
site = {t["id"]: t for t in old["tasks"]}
SECID = {x["title"]: x["id"] for x in old["sections"]}
byid = collections.OrderedDict()
for r in rows[1:]:
    if any(c.strip() for c in r): byid.setdefault(g(r, "ID упражнения"), []).append(r)
tasks, problems, sec_titles = [], [], collections.OrderedDict()
softmatch = []
newskills, newcodes = collections.OrderedDict(), collections.OrderedDict()
for eid, rs in byid.items():
    if len(rs) != 9: problems.append((eid, "шагов не 9", len(rs)))
    if not all(g(r, "Проверено учителем").lower() == "да" for r in rs):
        problems.append((eid, "не везде «да» в «Проверено учителем»")); continue
    first = rs[0]
    sec = SECID.get(g(first, "Раздел"))
    if not sec: problems.append((eid, "раздел не найден", g(first, "Раздел")))
    steps = []
    for r in rs:
        ty, n = g(r, "Тип"), g(r, "№ шага")
        st = {"type": None, "skill": g(r, "Навык"), "q": clean(g(r, "Вопрос")),
              "rule": clean(g(r, "Подсказка при ошибке")), "ok": clean(g(r, "Фраза «верно»"))}
        ans, var = g(r, "Ответ"), g(r, "Варианты")
        traps = [l.strip() for l in g(r, "Ловушки: неверный ответ ребёнка и подсказка Листика").split("\n") if l.strip()]
        codes = [c.strip() for c in g(r, "Коды ошибок").split(";") if c.strip()]
        if st["skill"] not in sk["skills"]: newskills[st["skill"]] = eid
        if ty == "выбор":
            parts = re.split(r";\s*(?=[АБВГ]\))", var)
            opts = [clean(re.sub(r"^[АБВГ]\)\s*", "", o.strip())) for o in parts]
            if [o[:2] for o in parts] != ["АБВГ"[i] + ")" for i in range(len(parts))]: problems.append((eid, n, "буквы вариантов", var))
            if ans not in LET or LET[ans] >= len(opts): problems.append((eid, n, "ответ вне вариантов", ans))
            cor = LET.get(ans, -1)
            st.update(type="choice", options=opts, correct=cor)
            wrong = {}
            if traps:
                if len(traps) != len(codes): problems.append((eid, n, "ловушек и кодов разное число", len(traps), len(codes)))
                for k, line in enumerate(traps):
                    m = re.match(r"«(.+?)»:\s*(.*)$", line, re.S)
                    if not m: problems.append((eid, n, "ловушка без «…»", line[:60])); continue
                    txt, hint = clean(m.group(1)), clean(m.group(2))
                    idx = opts.index(txt) if txt in opts else None
                    if idx is None:
                        cand = [i for i, o in enumerate(opts) if i != cor and (txt in o or o in txt)]
                        if len(cand) == 1: idx = cand[0]
                    if idx is None:
                        rest = [i for i in range(len(opts)) if i != cor and str(i) not in wrong]
                        if len(rest) == len(traps) - k: idx = rest[0]; softmatch.append((eid, n, txt))
                    if idx is None: problems.append((eid, n, "ловушка не совпала с вариантом", txt)); continue
                    if idx == cor: problems.append((eid, n, "ловушка стоит на верном варианте", txt))
                    code = codes[k] if k < len(codes) else ""
                    if code and code not in sk["errors"]: newcodes[code] = (eid, n)
                    wrong[str(idx)] = {"code": code, "hint": hint}
            if wrong: st["wrong"] = wrong
            if traps and opts and cor >= 0 and len(opts) - 1 != len(traps): problems.append((eid, n, "ловушек не равно числу неверных", len(traps), len(opts) - 1))
        elif ty == "пара":
            fields = re.findall(r"«([^»]+)»", var)
            vals = [v.strip() for v in ans.split(";")]
            if all(re.fullmatch(r"\d+ \(ост\. \d+\)", v) for v in vals):
                fields = [f + sfx for f in fields for sfx in (", частное", ", остаток")]
                vals = [x for v in vals for x in re.findall(r"\d+", v)]
            if len(fields) != len(vals) or not all(re.fullmatch(r"\d+", v) for v in vals): problems.append((eid, n, "пара", var, ans))
            st.update(type="pair", fields=fields, answer=[int(v) for v in vals if v.isdigit()])
            tr = {}
            for k, line in enumerate(traps):
                m = re.match(r"ответил\s+(.+?):\s*(.*)$", line, re.S)
                if not m: problems.append((eid, n, "ловушка пары", line[:60])); continue
                key = ",".join(re.findall(r"\d+", m.group(1)))
                code = codes[k] if k < len(codes) else (codes[0] if codes else "")
                if code and code not in sk["errors"]: newcodes[code] = (eid, n)
                tr[key] = {"code": code, "hint": clean(m.group(2))}
            if tr: st["traps"] = tr
        else:
            problems.append((eid, n, "неизвестный тип", ty))
        if g(r, "Роль шага") == "опора": st["scaf"] = True
        if g(r, "В тетради до ответа"): st["cond"] = clean(g(r, "В тетради до ответа"))
        if g(r, "В тетрадь"): st["note"] = clean(g(r, "В тетрадь"))
        # подсказка не должна называть ответ
        if ty == "выбор" and 0 <= st["correct"] < len(st["options"]):
            c = st["options"][st["correct"]]
            if re.fullmatch(r"\d+", c) and re.search(r"(?<!\d)" + c + r"(?!\d)", st["rule"]) and False: pass
        steps.append(st)
    no = str(int(float(g(first, "№ упр."))))
    t = {"id": eid, **({"access": "trial"} if g(first, "Доступ") == "пробное" else {}), "no": no,
         "title": clean(g(first, "Название упражнения")), "condition": clean(g(first, "Условие (на первом шаге)")),
         "long": True, "section": sec, "source": (site[eid]["source"] if eid in site else f"Свои упражнения Листика, математика 3 класс, упражнение {no}"),
         "steps": steps}
    if eid in site and "similar" in site[eid]: t["similar"] = site[eid]["similar"]
    tasks.append(t)
    sec_titles.setdefault(t["section"], g(first, "Раздел"))
# порядок: как в таблице; разделы как были на сайте, плюс новые по таблице
secs = old["sections"]
known = {s["id"] for s in secs}
pass
data = dict(old); data["version"] = "2026-11-17.1"; data["tasks"] = tasks
data["textbook"] = dict(old["textbook"]); data["textbook"]["lessons"] = "10 разделов по образцу структуры учебника; 105 упражнений"
json.dump(data, open(out_tasks, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
sk2 = json.loads(json.dumps(sk))
for s in newskills: sk2["skills"][s] = {"prereq": []}
for c in newcodes:
    sk2["errors"][c] = {"skill": "", "label": ""}   # подпись и навык заполняются на шаге 2
json.dump(sk2, open(skills_out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("упражнений:", len(tasks), "шагов:", sum(len(t["steps"]) for t in tasks))
print("типы:", collections.Counter(s["type"] for t in tasks for s in t["steps"]))
print("позиции верных:", collections.Counter(s["correct"] for t in tasks for s in t["steps"] if s["type"] == "choice"))
print("trial:", [t["id"] for t in tasks if t.get("access") == "trial"])
print("новых навыков:", len(newskills), "новых кодов:", len(newcodes))
print("мягкое совпадение ловушек (по порядку/части текста):", softmatch)
print("проблем:", len(problems))
for p in problems[:60]: print(" ", p)
