// 알림 채널 발송. Discord/Slack = 웹훅 실발송, Email/카카오톡 = 스텁(로그).
// 채널 형태: {id, type: discord|slack|email|kakao, target, active}
export function createNotifier(db) {
  async function send(kind, text) {
    const channels = db.getSetting('notif_channels', []).filter(c => c.active);
    const body = `[Claude Control] ${kind}: ${text}`;
    await Promise.allSettled(channels.map(async (ch) => {
      try {
        if (ch.type === 'discord') {
          await fetch(ch.target, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: body }),
          });
        } else if (ch.type === 'slack') {
          await fetch(ch.target, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: body }),
          });
        } else {
          // email: SMTP 연동 지점 / kakao: 비즈니스 채널 API 필요 — 스텁
          console.log(`[notify:${ch.type}:stub] → ${ch.target}: ${body}`);
        }
      } catch (e) {
        console.error(`[notify:${ch.type}] 발송 실패:`, e.message);
      }
    }));
  }

  return {
    approvalRequested: (t) => send('승인 요청', t),
    answerNeeded: (t) => send('답변 대기', t),
    workDone: (t) => send('작업 완료', t),
  };
}
