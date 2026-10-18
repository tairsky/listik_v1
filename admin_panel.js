/* Админ-панель владельца «Листика»: API для страницы /admin.
   Подключается из server.js. Вход по отдельному паролю ADMIN_PASSWORD из файла .env (не короче 8 символов).
   Если пароль не задан, панель выключена. Все запросы идут методом POST и проходят общие проверки сервера
   (тот же сайт, JSON). Сессия админа живёт 8 часов и хранится только в памяти сервера. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

module.exports = function (C) {
  const LOG_FILE = path.join(C.STORE_DIR, "admin-log.json");
  let LOG = [];
  try { LOG = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch (e) { LOG = []; }
  const sessions = new Map();                       // токен -> время окончания
  const TTL = 8 * 3600 * 1000, DAY = 86400000;
  const adminPw = () => String(process.env.ADMIN_PASSWORD || "");
  const sha = s => crypto.createHash("sha256").update(String(s)).digest();
  const sameSecret = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
  const iso = () => new Date().toISOString();
  const dayOf = ms => new Date(ms + 5 * 3600 * 1000).toISOString().slice(0, 10);   // сутки по Казахстану

  setInterval(() => { const now = Date.now(); for (const [k, exp] of sessions) if (exp < now) sessions.delete(k); }, 60000).unref();

  function writeLog(action, target, detail) {
    LOG.push({ at: iso(), action, target: target || "", detail: detail || "" });
    if (LOG.length > 500) LOG.splice(0, LOG.length - 500);
    try { const tmp = LOG_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(LOG), { mode: 0o600 }); fs.renameSync(tmp, LOG_FILE); } catch (e) {}
  }
  const isAdmin = req => { const t = C.parseCookies(req).la; const exp = t && sessions.get(t); return !!exp && exp > Date.now(); };
  function setCookie(res, token, maxAgeSec) {
    res.setHeader("Set-Cookie", "la=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + maxAgeSec + (C.COOKIE_SECURE ? "; Secure" : ""));
  }
  const killSessions = uid => { for (const [k, s] of C.auth) if (s.uid === uid) C.auth.delete(k); };

  /* ---------- сведения об ученике ---------- */
  const todayRec = u => { const r = C.usage()["u:" + u.id]; return r && r.day === C.dayStamp() ? r : null; };
  function limitsOf(u) {            // секунды на сегодня: личный или общий лимит плюс добавка на сегодня
    const r = todayRec(u), S = C.SETTINGS, o = u.limits || {};
    const study = Number.isFinite(o.study) ? o.study : S.studyDayMin, voice = Number.isFinite(o.voice) ? o.voice : S.voiceDayMin;
    return { study: Math.max(0, study * 60 + ((r && r.bonusStudy) || 0)), voice: Math.max(0, voice * 60 + ((r && r.bonusVoice) || 0)) };
  }
  function lastDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(dayOf(Date.now() - i * DAY)); return out; }
  function row(u) {
    const P = u.progress || {}, tasks = P.tasks || {}, skills = P.skills || {};
    const done = Object.values(tasks).filter(t => t.completions > 0).length;
    let steps = 0, first = 0;
    for (const s of Object.values(skills)) { steps += s.steps; first += s.firstTry; }
    const r = todayRec(u), L = limitsOf(u), log = u.usageLog || {};
    const week = lastDays(7);
    const planActive = !!(u.plan && Date.parse(u.plan.until) > Date.now());
    return {
      id: u.id, email: u.email, child: (u.child && u.child.name) || "", createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null,
      lastLessonAt: P.lastLessonAt || null, lessons: (P.lessons || []).length, tasksDone: done, tasksTotal: C.TASKS.length,
      firstTryPct: steps ? Math.round(100 * first / steps) : null,
      planUntil: u.plan ? u.plan.until : null, planActive, blocked: !!u.blocked,
      limits: { study: u.limits && Number.isFinite(u.limits.study) ? u.limits.study : null, voice: u.limits && Number.isFinite(u.limits.voice) ? u.limits.voice : null },
      today: { study: Math.round(r ? r.study : 0), voice: Math.round(r ? r.voice : 0), studyMax: L.study, voiceMax: L.voice,
        bonusStudy: (r && r.bonusStudy) || 0, bonusVoice: (r && r.bonusVoice) || 0 },
      weekStudy: Math.round(week.reduce((n, d) => n + ((log[d] && log[d].study) || 0), 0)),
      weekDays: week.filter(d => log[d] && log[d].study > 0).length
    };
  }

  /* ---------- разделы предмета ---------- */
  function sectionList() {
    const list = C.SECTIONS().map(s => ({ id: s.id, title: s.title }));
    if (C.TASKS.some(t => !t.section || !list.some(s => s.id === t.section))) list.push({ id: "_other", title: "Без раздела" });
    return list;
  }
  const secOf = t => (t.section && C.SECTIONS().some(s => s.id === t.section)) ? t.section : "_other";
  function sectionsOf(u, days) {     // по одному ученику: задачи и минуты (days: сколько последних дней считать минуты)
    const P = u.progress || {}, tasks = P.tasks || {}, log = u.usageLog || {}, dl = lastDays(days || 90);
    const total = dl.reduce((n, d) => n + ((log[d] && log[d].study) || 0), 0);
    return sectionList().map(s => {
      const ts = C.TASKS.filter(t => secOf(t) === s.id);
      const done = ts.filter(t => tasks[t.id] && tasks[t.id].completions > 0).length;
      const started = ts.filter(t => tasks[t.id] && (tasks[t.id].completions > 0 || tasks[t.id].inProgress)).length;
      const sec = dl.reduce((n, d) => n + ((log[d] && log[d].sec && log[d].sec[s.id]) || 0), 0);
      return { id: s.id, title: s.title, tasksTotal: ts.length, tasksDone: done, tasksStarted: started, minutes: Math.round(sec / 60), share: total ? Math.round(100 * sec / total) : null };
    });
  }
  function sectionStats(users, days) {   // по всем ученикам
    const dl = lastDays(days), from = dl[0];
    return sectionList().map(s => {
      const ts = C.TASKS.filter(t => secOf(t) === s.id), ids = new Set(ts.map(t => t.id));
      let completions = 0, completionsWin = 0, students = 0, sec = 0;
      users.forEach(u => {
        const P = u.progress || {};
        let any = false;
        for (const [id, x] of Object.entries(P.tasks || {})) if (ids.has(id)) { completions += x.completions || 0; if (x.completions || x.inProgress) any = true; }
        (P.lessons || []).forEach(l => { if (ids.has(l.task) && dayOf(Date.parse(l.at)) >= from) completionsWin++; });
        if (any) students++;
        const log = u.usageLog || {};
        dl.forEach(d => { sec += (log[d] && log[d].sec && log[d].sec[s.id]) || 0; });
      });
      return { id: s.id, title: s.title, tasks: ts.length, completions, completionsWin, students, minutes: Math.round(sec / 60) };
    });
  }

  function overview() {
    const users = C.users(), S = C.SETTINGS, now = Date.now(), today = C.dayStamp();
    const days = lastDays(14), regs = {}, active = {}, study = {};
    days.forEach(d => { regs[d] = 0; active[d] = 0; study[d] = 0; });
    users.forEach(u => {
      if (u.createdAt) { const d = dayOf(Date.parse(u.createdAt)); if (d in regs) regs[d]++; }
      const log = u.usageLog || {};
      days.forEach(d => { if (log[d] && log[d].study > 0) { active[d]++; study[d] += log[d].study; } });
    });
    let guestsToday = 0, studyToday = 0, voiceToday = 0;
    for (const [k, r] of Object.entries(C.usage())) {
      if (r.day !== today) continue;
      studyToday += r.study; voiceToday += r.voice;
      if (k.startsWith("ip:") && r.study > 0) guestsToday++;
    }
    const taskCount = {}, skill = {};
    users.forEach(u => {
      const P = u.progress; if (!P) return;
      for (const [id, t] of Object.entries(P.tasks || {})) taskCount[id] = (taskCount[id] || 0) + (t.completions || 0);
      for (const [name, s] of Object.entries(P.skills || {})) { const x = skill[name] || (skill[name] = { steps: 0, firstTry: 0 }); x.steps += s.steps; x.firstTry += s.firstTry; }
    });
    const titleOf = id => { const t = C.TASKS.find(x => x.id === id); return t ? "№" + t.no + " " + t.title : id; };
    const rows = users.map(row);
    return {
      totals: {
        users: users.length, blocked: users.filter(u => u.blocked).length, paid: rows.filter(r => r.planActive).length,
        new7: users.filter(u => u.createdAt && now - Date.parse(u.createdAt) < 7 * DAY).length,
        new30: users.filter(u => u.createdAt && now - Date.parse(u.createdAt) < 30 * DAY).length,
        activeToday: rows.filter(r => r.today.study > 0).length, active7: rows.filter(r => r.weekDays > 0).length,
        guestsToday, studyToday: Math.round(studyToday), voiceToday: Math.round(voiceToday),
        lessons: rows.reduce((n, r) => n + r.lessons, 0)
      },
      series: days.map(d => ({ day: d, regs: regs[d], active: active[d], studyMin: Math.round(study[d] / 60) })),
      expiring: rows.filter(r => r.planActive && Date.parse(r.planUntil) - now < 7 * DAY)
        .sort((a, b) => Date.parse(a.planUntil) - Date.parse(b.planUntil)).map(r => ({ id: r.id, email: r.email, child: r.child, planUntil: r.planUntil })),
      topTasks: Object.entries(taskCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ title: titleOf(id), completions: n })),
      hardSkills: Object.entries(skill).filter(([, s]) => s.steps >= 10).map(([name, s]) => ({ name, steps: s.steps, pct: Math.round(100 * s.firstTry / s.steps) }))
        .sort((a, b) => a.pct - b.pct).slice(0, 5),
      subject: C.SUBJECT, sections: sectionStats(users, 30),
      settings: { studyDayMin: S.studyDayMin, voiceDayMin: S.voiceDayMin, registrationOpen: !!S.registrationOpen, voiceEnabled: !!S.voiceEnabled },
      envDefaults: C.envDefaults
    };
  }

  function detail(u) {
    const view = C.cabinetView(u), log = u.usageLog || {};
    return Object.assign(row(u), {
      subject: C.SUBJECT, sections: sectionsOf(u, 90),
      tasks: view.tasks, skills: view.skills, recentLessons: ((u.progress && u.progress.lessons) || []).slice(-10).reverse().map(l => {
        const t = C.TASKS.find(x => x.id === l.task) || {};
        return { at: l.at, no: t.no || l.task, title: t.title || "", firstTry: l.firstTry, total: l.total };
      }),
      days: lastDays(14).map(d => ({ day: d, study: Math.round((log[d] && log[d].study) || 0), voice: Math.round((log[d] && log[d].voice) || 0) }))
    });
  }

  /* ---------- данные для вкладки «Графики» ---------- */
  function charts(daysN) {
    const n = [14, 30, 90].includes(daysN) ? daysN : 30, days = lastDays(n), users = C.users(), from = days[0];
    const idx = {}; days.forEach((d, i) => { idx[d] = i; });
    const regs = days.map(() => 0), active = days.map(() => 0), study = days.map(() => 0), voice = days.map(() => 0), done = days.map(() => 0);
    const wk = [0, 0, 0, 0, 0, 0, 0], wkDays = [0, 0, 0, 0, 0, 0, 0];   // по дням недели (пн = 0), минуты занятий
    let before = 0;
    users.forEach(u => {
      if (u.createdAt) { const d = dayOf(Date.parse(u.createdAt)); if (d in idx) regs[idx[d]]++; else if (d < from) before++; }
      const log = u.usageLog || {};
      days.forEach((d, i) => { const e = log[d]; if (e) { if (e.study > 0) active[i]++; study[i] += e.study || 0; voice[i] += e.voice || 0; } });
      ((u.progress && u.progress.lessons) || []).forEach(l => { const d = dayOf(Date.parse(l.at)); if (d in idx) done[idx[d]]++; });
    });
    days.forEach((d, i) => { const w = (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7; wk[w] += study[i]; wkDays[w]++; });
    let acc = before; const growth = regs.map(r => (acc += r));
    const skill = {};
    users.forEach(u => { for (const [name, s] of Object.entries((u.progress && u.progress.skills) || {})) { const x = skill[name] || (skill[name] = { steps: 0, firstTry: 0 }); x.steps += s.steps; x.firstTry += s.firstTry; } });
    const rows = users.map(row);
    return {
      days, subject: C.SUBJECT,
      series: { regs, growth, active, studyMin: study.map(s => Math.round(s / 60)), voiceMin: voice.map(s => Math.round(s / 60)), done },
      weekday: wk.map((s, i) => ({ studyMin: Math.round(s / 60), avgMin: wkDays[i] ? Math.round(s / 60 / wkDays[i]) : 0 })),
      sections: sectionStats(users, n),
      skills: Object.entries(skill).filter(([, s]) => s.steps >= 5).map(([name, s]) => ({ name, steps: s.steps, pct: Math.round(100 * s.firstTry / s.steps) })).sort((a, b) => a.pct - b.pct),
      plans: { paid: rows.filter(r => r.planActive && !r.blocked).length, expired: rows.filter(r => !r.planActive && r.planUntil && !r.blocked).length,
        trial: rows.filter(r => !r.planActive && !r.planUntil && !r.blocked).length, blocked: rows.filter(r => r.blocked).length }
    };
  }

  /* ---------- создание кабинета вручную ---------- */
  const PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const genPassword = () => Array.from(crypto.randomBytes(10), b => PW_ALPHABET[b % PW_ALPHABET.length]).join("");
  function genPin() { let p; do { p = String(crypto.randomInt(0, 10000)).padStart(4, "0"); } while (/^(\d)\1{3}$/.test(p) || ["0123", "1234", "2345", "3456", "4567", "5678", "6789", "3210", "4321", "5432", "6543", "7654", "8765", "9876", "2580", "1212", "1122"].includes(p)); return p; }
  async function createUser(b) {
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!C.EMAIL_RE.test(email)) return { error: "Проверьте адрес почты." };
    const name = typeof b.childName === "string" ? b.childName.replace(/\s+/g, " ").trim().slice(0, 30) : "";
    if (!name) return { error: "Введите имя ребёнка." };
    if (C.users().some(u => u.email === email)) return { error: "Кабинет с такой почтой уже есть." };
    const password = b.password ? String(b.password) : genPassword();
    if (password.length < 8 || password.length > 100) return { error: "Пароль не короче 8 символов." };
    const pin = b.pin ? String(b.pin) : genPin();
    if (!/^\d{4}$/.test(pin)) return { error: "PIN: 4 цифры." };
    const days = b.planDays === null || b.planDays === undefined || b.planDays === "" ? 0 : b.planDays;
    if (!intIn(days, 0, 3650)) return { error: "Подписка: от 0 до 3650 дней." };
    const user = { id: crypto.randomBytes(8).toString("hex"), email, pass: await C.hashSecret(password, "pass"), pin: await C.hashSecret(pin, "pin"),
      child: { name, grade: C.SUBJECT.grade || 3 }, createdAt: iso(), progress: null, createdByAdmin: true };
    if (days > 0) user.plan = { until: new Date(Date.now() + days * DAY).toISOString() };
    C.users().push(user); C.saveUsers();
    return { user, password, pin, days };
  }

  /* ---------- действия ---------- */
  const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  async function act(u, b) {
    const key = "u:" + u.id;
    switch (b.type) {
      case "limits": {
        const ok = v => v === null || intIn(v, 0, 600);
        if (!ok(b.study) || !ok(b.voice)) return { error: "Лимит должен быть целым числом минут от 0 до 600 (или пустым: тогда действует общий)." };
        const lim = {}; if (b.study !== null) lim.study = b.study; if (b.voice !== null) lim.voice = b.voice;
        if (Object.keys(lim).length) u.limits = lim; else delete u.limits;
        C.saveUsers();
        return { log: ["Лимиты", "занятия: " + (b.study === null ? "общий" : b.study + " мин") + ", голос: " + (b.voice === null ? "общий" : b.voice + " мин")] };
      }
      case "bonus": {
        if (!intIn(b.study, -300, 300) || !intIn(b.voice, -300, 300)) return { error: "Добавка: целое число минут от -300 до 300." };
        const r = C.usageOf(key);
        r.bonusStudy = Math.max(-600 * 60, Math.min(600 * 60, (r.bonusStudy || 0) + b.study * 60));
        r.bonusVoice = Math.max(-600 * 60, Math.min(600 * 60, (r.bonusVoice || 0) + b.voice * 60));
        C.flushUsage();
        return { log: ["Время на сегодня", "занятия " + (b.study >= 0 ? "+" : "") + b.study + " мин, голос " + (b.voice >= 0 ? "+" : "") + b.voice + " мин"] };
      }
      case "resetToday": {
        const r = C.usageOf(key); r.study = 0; r.voice = 0; C.flushUsage();
        return { log: ["Обнулено время за сегодня", ""] };
      }
      case "planExtend": {
        if (!intIn(b.days, 1, 3650)) return { error: "Срок: от 1 до 3650 дней." };
        const cur = u.plan && Date.parse(u.plan.until) > Date.now() ? Date.parse(u.plan.until) : Date.now();
        u.plan = { until: new Date(cur + b.days * DAY).toISOString() }; C.saveUsers();
        return { log: ["Подписка продлена на " + b.days + " дн.", "до " + u.plan.until.slice(0, 10)] };
      }
      case "planSet": {
        if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || isNaN(Date.parse(b.date))) return { error: "Дата в формате ГГГГ-ММ-ДД." };
        u.plan = { until: new Date(b.date + "T23:59:59+05:00").toISOString() }; C.saveUsers();
        return { log: ["Подписка до даты", b.date] };
      }
      case "planCancel": delete u.plan; C.saveUsers(); return { log: ["Подписка отключена", ""] };
      case "rename": {
        const n = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, 30) : "";
        if (!n) return { error: "Введите имя." };
        u.child = Object.assign({}, u.child, { name: n }); C.saveUsers(); return { log: ["Имя ребёнка изменено", n] };
      }
      case "password": {
        if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 100) return { error: "Пароль не короче 8 символов." };
        u.pass = await C.hashSecret(b.password, "pass"); C.saveUsers(); killSessions(u.id);
        return { log: ["Задан новый пароль", "все входы закрыты"] };
      }
      case "pin": {
        if (typeof b.pin !== "string" || !/^\d{4}$/.test(b.pin)) return { error: "PIN: 4 цифры." };
        u.pin = await C.hashSecret(b.pin, "pin"); C.saveUsers(); C.buckets.delete("pin:" + u.id);
        return { log: ["Задан новый PIN", ""] };
      }
      case "block": {
        u.blocked = b.blocked === true; if (!u.blocked) delete u.blocked; else killSessions(u.id);
        C.saveUsers(); return { log: [u.blocked ? "Кабинет заблокирован" : "Кабинет разблокирован", ""] };
      }
      case "resetProgress": {
        if (b.confirm !== u.email) return { error: "Для подтверждения введите почту кабинета." };
        u.progress = null; C.saveUsers(); return { log: ["Прогресс сброшен", ""] };
      }
      case "delete": {
        if (b.confirm !== u.email) return { error: "Для подтверждения введите почту кабинета." };
        const arr = C.users(); arr.splice(arr.indexOf(u), 1); killSessions(u.id); delete C.usage()[key];
        C.saveUsers(); C.flushUsage();
        return { log: ["Кабинет удалён", ""], deleted: true };
      }
      default: return { error: "Неизвестное действие." };
    }
  }

  /* ---------- маршруты ---------- */
  return async function handle(req, res, url, ip, b) {
    const route = url.slice("/api/admin/".length), send = C.send;
    const pw = adminPw();
    if (route === "status") return send(res, 200, { configured: pw.length >= 8, loggedIn: pw.length >= 8 && isAdmin(req) });
    if (pw.length < 8) return send(res, 503, { error: "not_configured" });

    if (route === "login") {
      const k = "adm:" + ip;
      if (C.tooMany(k, 6, 15 * 60000)) return send(res, 429, { error: "too_many", message: "Слишком много попыток. Подождите 15 минут." });
      if (typeof b.password !== "string" || !sameSecret(b.password, pw)) {
        C.hit(k); writeLog("Неудачный вход в админ-панель", "", ip);
        return send(res, 401, { error: "login", message: "Неверный пароль." });
      }
      C.buckets.delete(k);
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, Date.now() + TTL); setCookie(res, token, TTL / 1000);
      writeLog("Вход в админ-панель", "", ip);
      return send(res, 200, { ok: true });
    }
    if (!isAdmin(req)) return send(res, 401, { error: "login" });
    if (route === "logout") { const t = C.parseCookies(req).la; if (t) sessions.delete(t); setCookie(res, "", 0); return send(res, 200, { ok: true }); }
    if (route === "overview") return send(res, 200, overview());
    if (route === "users") return send(res, 200, { users: C.users().map(row), tasksTotal: C.TASKS.length });
    if (route === "charts") return send(res, 200, charts(b.days));
    if (route === "create") {
      const r = await createUser(b);
      if (r.error) return send(res, 400, { error: "bad", message: r.error });
      writeLog("Кабинет создан вручную", r.user.email, "ребёнок: " + r.user.child.name + (r.days ? ", подписка " + r.days + " дн." : ""));
      return send(res, 200, { ok: true, id: r.user.id, email: r.user.email, password: r.password, pin: r.pin });
    }
    if (route === "log") return send(res, 200, { log: LOG.slice(-150).reverse() });
    if (route === "user") {
      const u = C.users().find(x => x.id === b.id);
      return u ? send(res, 200, detail(u)) : send(res, 404, { error: "not_found" });
    }
    if (route === "action") {
      const u = C.users().find(x => x.id === b.id);
      if (!u) return send(res, 404, { error: "not_found", message: "Кабинет не найден." });
      const r = await act(u, b);
      if (r.error) return send(res, 400, { error: "bad", message: r.error });
      writeLog(r.log[0], u.email, r.log[1]);
      return send(res, 200, { ok: true, user: r.deleted ? null : detail(u) });
    }
    if (route === "settings") {
      const S = C.SETTINGS;
      if (!intIn(b.studyDayMin, 1, 600) || !intIn(b.voiceDayMin, 0, 600)) return send(res, 400, { error: "bad", message: "Минуты: целое число (занятия от 1 до 600, голос от 0 до 600)." });
      const before = JSON.stringify([S.studyDayMin, S.voiceDayMin, S.registrationOpen, S.voiceEnabled]);
      S.studyDayMin = b.studyDayMin; S.voiceDayMin = b.voiceDayMin; S.registrationOpen = b.registrationOpen !== false; S.voiceEnabled = b.voiceEnabled !== false;
      C.saveSettings();
      writeLog("Общие настройки", "", before + " → " + JSON.stringify([S.studyDayMin, S.voiceDayMin, S.registrationOpen, S.voiceEnabled]));
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not_found" });
  };
};
