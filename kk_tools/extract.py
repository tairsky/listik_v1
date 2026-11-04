import re, sys, json
CY = re.compile(r'[А-Яа-яЁё]')
def spans(s):
    out=[]
    # убрать комментарии из рассмотрения
    dead=[]
    for m in re.finditer(r'<!--.*?-->|/\*.*?\*/', s, re.S): dead.append((m.start(),m.end()))
    for m in re.finditer(r'(?m)^[ \t]*//.*$', s): dead.append((m.start(),m.end()))
    for m in re.finditer(r'(?<=[;,{}) ])[ \t]+//[ \t].*$', s, re.M): dead.append((m.start(),m.end()))
    def isdead(a,b): return any(x<=a and b<=y for x,y in dead)
    blocks=[(m.start(),m.end()) for m in re.finditer(r'<(script|style)\b[^>]*>.*?</\1>', s, re.S|re.I)]
    def inblock(a,b): return any(x<=a and b<=y for x,y in blocks)
    # текстовые узлы HTML
    for m in re.finditer(r'>([^<>]+)<', s):
        t=m.group(1)
        if CY.search(t) and not isdead(m.start(1),m.end(1)) and not inblock(m.start(1),m.end(1)): out.append((m.start(1),m.end(1)))
    # строки в кавычках
    for m in re.finditer(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`((?:[^`\\]|\\.)*)`', s, re.S):
        g=[i for i in (1,2,3) if m.group(i) is not None][0]
        t=m.group(g)
        if CY.search(t) and not isdead(m.start(g),m.end(g)): out.append((m.start(g),m.end(g)))
    # оставить только максимальные
    out=sorted(set(out), key=lambda x:(x[0],-(x[1]-x[0])))
    keep=[]
    for a,b in out:
        if any(x<=a and b<=y and (x,y)!=(a,b) for x,y in out): continue
        keep.append((a,b))
    return keep
if __name__=='__main__':
    res={}
    for f in sys.argv[1:]:
        s=open(f,encoding='utf8').read()
        seen=[]; 
        for a,b in spans(s):
            t=s[a:b]
            if t not in seen: seen.append(t)
        res[f]=seen
    json.dump(res,open('kk_tools/todo.json','w'),ensure_ascii=False,indent=1)
    for f,l in res.items(): print(f,len(l))
