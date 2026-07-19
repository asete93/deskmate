// 알림 채널 발송. Discord/Slack = 웹훅 실발송, Email/카카오톡 = 스텁(로그).
// 채널 형태: {id, type: discord|slack|email|kakao, target, active}
export function createNotifier(db) {
  // 모바일 앱 백그라운드 푸시 — 앱이 등록한 Expo 푸시 토큰으로 발송
  async function sendPush(kind, text) {
    const tokens = db.getSetting('push_tokens', []);
    if (!tokens.length) return;
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(tokens.map(to => ({ to, title: `Deskmate · ${kind}`, body: text, sound: 'default' }))),
      });
      const j = await res.json().catch(() => null);
      // 삭제된 기기의 토큰은 정리
      const dead = new Set();
      (j?.data || []).forEach((r, i) => { if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') dead.add(tokens[i]); });
      if (dead.size) db.setSetting('push_tokens', tokens.filter(t => !dead.has(t)));
    } catch (e) {
      console.error('[notify:push] 발송 실패:', e.message);
    }
  }

  async function send(kind, text) {
    const channels = db.getSetting('notif_channels', []).filter(c => c.active);
    const body = `[Deskmate] ${kind}: ${text}`;
    await sendPush(kind, text);
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
    // 채팅 응답(완료 보고 등)은 모바일 푸시만 — 웹훅 채널까지 보내면 스팸이 된다
    chatReply: (t) => sendPush('새 메시지', t),
  };
}
