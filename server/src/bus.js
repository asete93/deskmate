// WS 허브 + 타임라인 기록. 모든 상태 변화는 여기로 모아 브로드캐스트한다.
export function createBus(db) {
  const clients = new Set();

  function broadcast(type, payload) {
    const data = JSON.stringify({ type, payload });
    for (const ws of clients) {
      if (ws.readyState === 1) { try { ws.send(data); } catch { /* dead socket */ } }
    }
  }

  return {
    addClient(ws) { clients.add(ws); ws.on('close', () => clients.delete(ws)); },
    broadcast,
    // 타임라인 이벤트: DB 기록 + push
    event(actor, actorType, text) {
      const id = db.insertEvent(actor, actorType, text);
      broadcast('event', { id, ts: Date.now(), actor, actor_type: actorType, text });
    },
    message(msg) { broadcast('message', msg); },
    agents() { broadcast('agents', db.listAgents()); },
    tickets() { broadcast('tickets', db.listTickets()); },
    approvals() { broadcast('approvals', db.listApprovals()); },
    requests() { broadcast('requests', db.listRequests()); },
    threads() { broadcast('threads', db.listThreads()); },
    settings() {
      broadcast('settings', {
        goal: db.getSetting('goal', ''),
        goal_history: db.getSetting('goal_history', []),
        lang: db.getSetting('lang', 'ko'),
        mode: db.getSetting('mode', 'plan'),
        progress: db.getSetting('progress', 0),
        notif_channels: db.getSetting('notif_channels', []),
        nav_order: db.getSetting('nav_order', null),
        show_git_menu: db.getSetting('show_git_menu', true),
        terminal_enabled: db.getSetting('terminal_enabled', false),
        files_enabled: db.getSetting('files_enabled', true),
      });
    },
    toast(text) { broadcast('toast', { text }); },
  };
}
