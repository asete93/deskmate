// 예약 작업 스케줄러 — 30초마다 도래한 스케줄을 팀장/팀원에게 요청으로 전송.
// repeat: once(1회, run_at) | daily(매일 at_time) | weekly(weekday+at_time)

export function computeNextRun(s, from = Date.now()) {
  if (s.repeat === 'once') return s.run_at && s.run_at > from ? s.run_at : (s.run_at || null);
  const [hh, mm] = String(s.at_time || '09:00').split(':').map(Number);
  const d = new Date(from);
  d.setHours(hh, mm, 0, 0);
  if (s.repeat === 'daily') {
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (s.repeat === 'weekly') {
    const wd = Number(s.weekday ?? 1);
    let diff = (wd - d.getDay() + 7) % 7;
    if (diff === 0 && d.getTime() <= from) diff = 7;
    d.setDate(d.getDate() + diff);
    return d.getTime();
  }
  return null;
}

export function startScheduler({ db, bus, manager }) {
  const tick = () => {
    const nowTs = Date.now();
    for (const s of db.dueSchedules(nowTs)) {
      try {
        // 대상 유효성 (해고된 팀원이면 팀장으로)
        let target = s.target || 'main';
        if (target.startsWith('sub:') && !db.getAgent(Number(target.split(':')[1]))) target = 'main';
        manager.sendChat(target, `[예약 작업: ${s.title}] ${s.text}`);
        bus.event('User', 'user', `예약 작업 실행 — ${s.title}`);
      } catch (e) {
        console.error(`[scheduler] "${s.title}" 실행 실패:`, e.message);
      }
      const next = s.repeat === 'once' ? null : computeNextRun(s, nowTs);
      db.updateSchedule(s.id, { last_run_ts: nowTs, next_run_ts: next, ...(next == null ? { enabled: false } : {}) });
      bus.broadcast('schedules', db.listSchedules());
    }
  };
  setInterval(tick, 30_000);
  tick(); // 부팅 시 밀린 건 즉시 처리
}
