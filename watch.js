/* Листик: сигналы «подозрительно быстро» (защита листиков от накрутки).
   Пороги: гипотезы автора, учитель их не проверял. Модуль ничего не блокирует: он только ставит пометку «проверить».
   Состояние W лежит в user.progress.watch (сохраняется вместе с кабинетом). Время передаёт сервер (local: day, week, hour по Казахстану). */
const CFG = {
  win: 15,            // сколько последних шагов смотрим
  fastMs: 4000,       // сигнал «скорость»: медиана времени на шаг меньше этого...
  fastClean: 13,      // ...и верно с первой попытки не меньше стольких шагов из win
  rhythmCv: 0.15,     // сигнал «ритм»: разброс времени (std/среднее) меньше этого...
  rhythmMedMs: 8000,  // ...при медиане меньше этого (медленный ровный ребёнок не в счёт)
  quickPerStep: 3,    // сигнал «упражнение слишком быстро»: секунд на шаг меньше этого (при шагов >= quickMinSteps)
  quickMinSteps: 4,
  capLeaves: 150,     // сигнал «потолок»: за день набрано не меньше стольких листиков...
  capDays: 3,         // ...столько дней подряд
  nightHour: 22, nightEx: 6,   // сигнал «объём»: 6 упражнений после 22:00 за день...
  weekEx: 26,                  // ...или 26 упражнений за неделю
  alertAt: 2,         // пометка «проверить»: столько разных сигналов за keepDays
  keepDays: 7
};
const DAY = 86400000;
const dayNum = s => Math.floor(Date.parse(s + "T00:00:00Z") / DAY);

function stateOf(P) {
  const W = P.watch || (P.watch = { ms: [], sig: {}, capDays: [], night: {}, exWeek: {}, flag: null });
  return W;
}
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function fire(W, name, local) { W.sig[name] = local.day; }

/* верный ответ на шаг: ms = секунды*1000 с прошлого ответа, clean = верно с первой попытки без подсказки */
function onStep(W, local, ms, clean) {
  if (!(ms > 0)) return;
  W.ms.push({ ms: Math.round(ms), c: clean ? 1 : 0 }); if (W.ms.length > CFG.win) W.ms.splice(0, W.ms.length - CFG.win);
  if (W.ms.length < CFG.win) return;
  const v = W.ms.map(x => x.ms), med = median(v);
  if (med < CFG.fastMs && W.ms.filter(x => x.c).length >= CFG.fastClean) fire(W, "fast", local);
  const mean = v.reduce((s, x) => s + x, 0) / v.length, sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) * (x - mean), 0) / v.length);
  if (med < CFG.rhythmMedMs && mean > 0 && sd / mean < CFG.rhythmCv) fire(W, "rhythm", local);
}

/* упражнение закончено: sec = секунд от начала, steps = сколько шагов ребёнок решал сам */
function onExercise(W, local, sec, steps) {
  if (steps >= CFG.quickMinSteps && sec < steps * CFG.quickPerStep) fire(W, "quick", local);
  W.exWeek[local.week] = (W.exWeek[local.week] || 0) + 1;
  for (const k of Object.keys(W.exWeek)) if (k !== local.week) delete W.exWeek[k];
  if (local.hour >= CFG.nightHour) W.night[local.day] = (W.night[local.day] || 0) + 1;
  for (const k of Object.keys(W.night)) if (dayNum(k) < dayNum(local.day) - 14) delete W.night[k];
  if ((W.night[local.day] || 0) >= CFG.nightEx || W.exWeek[local.week] >= CFG.weekEx) fire(W, "volume", local);
}

/* после начисления листиков: earned = набрано за сегодня */
function onEarned(W, local, earned) {
  if (earned >= CFG.capLeaves && !W.capDays.includes(local.day)) { W.capDays.push(local.day); if (W.capDays.length > 10) W.capDays.shift(); }
  const d = W.capDays.map(dayNum).sort((a, b) => a - b), n = CFG.capDays;
  if (d.length >= n && d[d.length - 1] === dayNum(local.day)) {
    let ok = true; for (let i = 1; i <= n - 1; i++) if (d[d.length - 1 - i] !== d[d.length - i] - 1) ok = false;
    if (ok) fire(W, "cap", local);
  }
}

/* итог: если за keepDays сработало не меньше alertAt разных сигналов и кабинет ещё не помечен, ставит пометку и возвращает её */
function check(W, local) {
  if (W.muteUntil && W.muteUntil > new Date().toISOString()) return null;   // владелец решил: это быстрый ребёнок, 30 дней не помечаем
  const now = dayNum(local.day), act = Object.keys(W.sig).filter(k => now - dayNum(W.sig[k]) < CFG.keepDays);
  for (const k of Object.keys(W.sig)) if (!act.includes(k)) delete W.sig[k];
  if (act.length >= CFG.alertAt && !(W.flag && !W.flag.reviewed)) {
    W.flag = { at: new Date().toISOString(), signals: act.sort(), reviewed: false };
    return W.flag;
  }
  return null;
}
module.exports = { CFG, stateOf, onStep, onExercise, onEarned, check };
