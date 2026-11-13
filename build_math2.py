import csv, json, re, sys, collections
src, out = sys.argv[1], sys.argv[2]
TRIAL = {"g2r1-1"}
rows = list(csv.reader(open(src, encoding="utf-8")))
hdr = rows[0]
ix = {h.strip(): i for i, h in enumerate(hdr) if h.strip()}
def g(r, name):
    i = ix[name]; return r[i].strip() if i < len(r) else ""
def clean(s): return re.sub(r"[ \t]{2,}", " ", s.strip())
LET = {"А": 0, "Б": 1, "В": 2, "Г": 3}
byid = collections.OrderedDict()
for r in rows[1:]:
    if not any(c.strip() for c in r): continue
    byid.setdefault(g(r, "ID упражнения"), []).append(r)
tasks, skipped, problems = [], [], []
for eid, rs in byid.items():
    checked = [g(r, "Проверено учителем").lower() == "да" for r in rs]
    if not all(checked):
        skipped.append((eid, sum(checked), len(rs))); continue
    first = rs[0]
    m = re.match(r"g2r(\d+)-(\d+)$", eid)
    sec, no = "g2r" + m.group(1), m.group(2)
    steps = []
    for r in rs:
        ty, n = g(r, "Тип"), g(r, "№ шага")
        st = {"type": None, "skill": g(r, "Навык"), "q": clean(g(r, "Вопрос")),
              "rule": clean(g(r, "Подсказка при ошибке")), "ok": clean(g(r, "Фраза «верно»"))}
        ans = g(r, "Ответ"); var = g(r, "Варианты")
        if ty == "выбор":
            opts = [re.sub(r"^[АБВГ]\)\s*", "", o.strip()) for o in var.split(";")]
            if ans not in LET or LET[ans] >= len(opts): problems.append((eid, n, "ответ вне вариантов", ans, var))
            st.update(type="choice", options=[clean(o) for o in opts], correct=LET.get(ans, -1))
        elif ty == "число":
            if not re.fullmatch(r"\d+", ans): problems.append((eid, n, "ответ не целое число", ans))
            st.update(type="number", answer=int(ans) if ans.isdigit() else None)
        elif ty == "пара":
            fields = re.findall(r"«([^»]+)»", var)
            vals = [v.strip() for v in ans.split(";")]
            if len(fields) != len(vals) or not all(re.fullmatch(r"\d+", v) for v in vals): problems.append((eid, n, "пара", var, ans))
            st.update(type="pair", fields=fields, answer=[int(v) for v in vals if v.isdigit()])
        else:
            problems.append((eid, n, "неизвестный тип", ty))
        # подсказка не должна называть ответ
        for tok in ([ans] if ty == "число" else ([x for x in ans.split(";")] if ty == "пара" else [])):
            if re.search(r"(?<!\d)" + re.escape(tok.strip()) + r"(?!\d)", st["rule"]) and ty != "пара":
                problems.append((eid, n, "подсказка содержит ответ?", st["rule"], tok))
        steps.append(st)
    tasks.append({"id": eid, **({"access": "trial"} if eid in TRIAL else {}), "no": no,
                  "title": clean(g(first, "Название упражнения")), "condition": clean(g(first, "Условие (на первом шаге)")),
                  "similar": clean(g(first, "Похожий пример (после 2 ошибок)")), "long": True,
                  "steps": steps, "section": sec,
                  "source": f"Свои упражнения Листика, математика 2 класс, раздел {m.group(1)}, упражнение {no}"})
_titles = {}
for _t in tasks:
    _titles[_t["section"]] = clean(g(byid[_t["id"]][0], "Раздел"))
secs = [{"id": k, "title": _titles[k], "hint": ""} for k in sorted(_titles, key=lambda x: int(x[3:]))]
data = {"language": "ru", "version": "2026-11-13.2", "subject": "math", "grade": 2, "subject_title": "Математика",
        "textbook": {"title": "Свои упражнения Листика, математика 2 класс", "authors": "", "publisher": "",
                     "lessons": "13 разделов по темам оглавления учебника; пока загружены только проверенные учителем упражнения"},
        "sections": secs, "tasks": tasks}
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("упражнений:", len(tasks), "шагов:", sum(len(t["steps"]) for t in tasks))
print("types:", collections.Counter(s["type"] for t in tasks for s in t["steps"]))
print("позиции верных ответов (choice):", collections.Counter(s["correct"] for t in tasks for s in t["steps"] if s["type"] == "choice"))
print("пропущено (id, 'да' шагов, всего):", [s for s in skipped if s[1] > 0], "| полностью непроверенных упражнений:", sum(1 for s in skipped if s[1] == 0))
print("проблемы:", problems)
