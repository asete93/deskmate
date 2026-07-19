import fs from 'node:fs';
import path from 'node:path';
import { createMockDriver } from './mockDriver.js';
import { createSdkDriver } from './sdkDriver.js';
import { seedWorkspace } from '../seedWorkspace.js';
import { buildTeamLeadPrompt, buildMemberPrompt } from './platformPrompt.js';

// 에이전트 오케스트레이션 매니저.
// 드라이버(mock/sdk)는 "말하고 질문하는" 부분만 담당하고,
// 상태 변화(DB·타임라인·WS·알림)는 전부 여기서 일어난다 — 앱 DB가 단일 진실 소스.
export function createManager({ db, bus, notify, workDir, uploadsDir, driverKind }) {
  const claudeMdPath = path.join(workDir, 'CLAUDE.md');
  const resolvers = new Map(); // interactionId → resolve(answer)  (sdk 드라이버 promise 홀드)

  const ctx = {
    db, bus, notify, workDir, uploadsDir, claudeMdPath,

    actorTypeOf(name) {
      if (name === 'User') return 'user';
      if (name === 'Main' || name === '팀장') return 'main';
      return 'sub';
    },

    postMessage(m) {
      const id = db.insertMessage(m);
      const msg = db.getMessage(id);
      bus.message(msg);
      // 대표 수신 응답은 모바일 푸시로도 — 완료 보고가 REQ 없이 채팅으로만 오는 경우 커버
      if (msg.to_actor === 'User' && !['User', 'System'].includes(msg.from_actor) && ['text', 'report'].includes(msg.kind)) {
        const who = msg.from_actor === 'Main' ? (db.listAgents().find(a => a.kind === 'main')?.name || '팀장') : msg.from_actor;
        const body = (msg.content?.text || msg.content?.title || '').replace(/\s+/g, ' ').slice(0, 90);
        notify.chatReply?.(`${who} — ${body}`);
      }
      return msg;
    },

    // 인터랙션 게이트: DB 영속 + WS push + 알림. resolver는 답변 시 호출(선택).
    createInteraction(agent, channel, type, payload, { requestId } = {}) {
      const msgId = db.insertMessage({
        channel, request_id: requestId ?? null,
        from_actor: agent.kind === 'main' ? 'Main' : agent.name, to_actor: 'User',
        kind: type, content: payload,
      });
      const intId = db.insertInteraction({ message_id: msgId, agent_id: agent.id, type, payload });
      const msg = db.getMessage(msgId);
      msg.interaction_id = intId;
      bus.message(msg);
      bus.broadcast('interaction', { id: intId, status: 'pending' });
      db.updateAgent(agent.id, { status: 'waiting', work_channel: channel });
      bus.agents();
      const typeLabel = { choice: '선택', diff: '수정 승인', artifact: '산출물 검토', form: '입력' }[type] || '응답';
      bus.toast(`${agent.kind === 'main' ? '팀장' : agent.name}이(가) ${typeLabel}을 기다립니다 — 채팅에서 카드를 확인하세요.`);
      notify.answerNeeded(payload.text || type);
      return new Promise((resolve) => resolvers.set(intId, resolve));
    },

    // 결재 카테고리: add=팀원 고용, remove=팀원 해고, decision=결정 필요, etc=기타
    approvalLabel(action) {
      return { add: '팀원 고용', remove: '팀원 해고', decision: '결정 필요', etc: '기타' }[action] || action;
    },
    createApproval(action, target, reason) {
      const id = db.insertApproval({ action, target, reason });
      bus.approvals();
      const label = ctx.approvalLabel(action);
      bus.event('Main', 'main', `결재 요청 — [${label}] ${target.name}`);
      bus.toast(`팀장이 결재를 요청했습니다 — [${label}] ${target.name}`);
      notify.approvalRequested(`[${label}] ${target.name} — ${reason.slice(0, 80)}`);
      return id;
    },

    // workChannel: 이 작업이 발원한 공간('main'/'team'/'req'/'sub:N') — 팀 채팅 인디케이터 필터용
    setAgentStatus(id, status, task, workChannel) {
      db.updateAgent(id, {
        status,
        ...(task !== undefined ? { current_task: task } : {}),
        ...(workChannel !== undefined ? { work_channel: workChannel } : {}),
      });
      bus.agents();
    },

    setProgress(pct, note) {
      db.setSetting('progress', Math.max(0, Math.min(100, Math.round(pct))));
      bus.settings();
      if (note) bus.event('Main', 'main', note);
    },

    upsertTicket(t, historyEntry) {
      let id = t.id;
      if (id && db.getTicket(id)) db.updateTicket(id, t, historyEntry);
      else id = db.insertTicket({ ...t, history: historyEntry ? [historyEntry] : [] });
      bus.tickets();
      return id;
    },
    completeTicketsForRequest(requestId, note) {
      const n = db.completeTicketsForRequest(requestId, note);
      if (n) bus.tickets();
      return n;
    },

    addRequestUsage(requestId, tokensIn, tokensOut) {
      db.addRequestUsage(requestId, tokensIn, tokensOut);
      bus.requests();
    },

    attachReport(requestId, report, channel = 'main') {
      db.setRequestReport(requestId, report);
      // 보고서 제출 = 해당 REQ 완료
      const r = db.getRequest(requestId);
      if (r && r.status === 'active') ctx.completeRequest(requestId, 'done');
      bus.requests();
      bus.event('Main', 'main', `REQ-${requestId} 산출 보고서 작성 완료`);
      // 채팅에 보고서 링크 카드 게시 — 요청이 진행된 공간(1:1/팀 채팅)에만
      ctx.postMessage({
        channel, request_id: requestId,
        from_actor: 'Main', to_actor: 'User',
        kind: 'report', content: { request_id: requestId, title: report.title || '산출 보고서', subtitle: report.subtitle || '' },
      });
    },

    // 구독 사용량(rate limit) 갱신 — 세션 스트림의 rate_limit_event에서 수신
    rateLimits: {},
    updateRateLimit(info) {
      if (!info) return;
      const key = info.rateLimitType || 'five_hour';
      ctx.rateLimits[key] = { ...info, updated_ts: Date.now() };
      bus.broadcast('rate_limit', ctx.rateLimits);
    },

    // 시스템 공지 (입사·퇴사 등) — 기본 방에 게시
    announce(text) {
      ctx.postMessage({ channel: 'main', from_actor: 'System', to_actor: 'All', kind: 'system', content: { text } });
    },

    completeRequest(requestId, status = 'done') {
      if (!requestId) return;
      db.updateRequest(requestId, status);
      ctx.completeTicketsForRequest(requestId, `REQ-${requestId} ${status === 'done' ? '완료' : status} — 자동 종결`);
      bus.requests();
      if (status === 'done') {
        const r = db.getRequest(requestId);
        notify.workDone(r?.title || `REQ-${requestId}`);
      }
    },

    // 팀장이 "새 작업 요청"으로 분류할 때만 REQ 생성 (모든 질문이 REQ가 되지 않도록).
    // REQ는 방 스코프 — 같은 방의 이전 열린 REQ만 자동 완료 (다른 방 진행 건은 유지).
    lastUserMsgByChannel: {},
    openRequest(title, channel = 'main') {
      for (const r of db.listRequests()) if (r.status === 'active' && (r.channel || 'main') === channel) db.updateRequest(r.id, 'done');
      const id = db.insertRequest(String(title || '').slice(0, 60) || '새 요청', 'active', channel);
      const trigger = ctx.lastUserMsgByChannel[channel];
      if (trigger) {
        db.updateMessageRequest(trigger, id);
        bus.message(db.getMessage(trigger));
      }
      bus.requests();
      bus.event('Main', 'main', `REQ-${id} 분류 — "${String(title).slice(0, 40)}"`);
      return id;
    },
  };

  const driver = driverKind === 'sdk' ? createSdkDriver(ctx) : createMockDriver(ctx);

  // ---------- 부팅 ----------
  function init() {
    // 신규 인스턴스 시드 언어 — --lang(CC_LANG) 우선, 없으면 기존 설정(기본 ko)
    const seedLang = ['ko', 'en'].includes(process.env.CC_LANG) ? process.env.CC_LANG : db.getSetting('lang', 'ko');
    // 기본 방(삭제 불가, 내용 초기화만 가능). 구 DB는 팀장 단일 세션이던
    // agents.session_id를 기본 방으로 승계한다.
    const mainThread = db.ensureThread('main', seedLang === 'en' ? 'Main Chat' : '메인 채팅');
    const main = db.getMainAgent();
    if (main?.session_id && !mainThread.session_id) {
      db.updateThread('main', { session_id: main.session_id });
    }
    if (!db.getMainAgent()) {
      // 클린 초기 상태: Orchestrator(메인)만. 서브 에이전트는 시드하지 않는다 —
      // 사용자가 직접 추가하거나 Orchestrator가 승인 요청(request_agent_change)으로만 추가된다.
      // model 값은 supportedModels() 목록의 value — 'default'는 CLI 권장 최고성능 티어
      db.insertAgent(seedLang === 'en'
        ? { name: 'TeamLead', kind: 'main', role: 'Planning · verification · intent analysis', model: 'default', effort: 'high', status: 'idle', current_task: '' }
        : { name: '팀장', kind: 'main', role: '계획 수립 · 산출물 검증 · 의도 파악', model: 'default', effort: 'high', status: 'idle', current_task: '' });
      db.setSetting('goal', '');
      db.setSetting('mode', 'plan');
      db.setSetting('progress', 0);
    }
    // 기동 옵션 --lang — 명시되면 시스템 언어를 그 값으로 (UI·에이전트 지침 언어)
    if (['ko', 'en'].includes(process.env.CC_LANG) && db.getSetting('lang', 'ko') !== process.env.CC_LANG) {
      db.setSetting('lang', process.env.CC_LANG);
    }
    // 크래시 복구: 미답변 인터랙션은 DB에서 살아있음 → UI에 그대로 노출.
    // (sdk 모드: 답변 도착 시 resume + 답 주입 — sdkDriver.answer가 처리)
    driver.init?.(db.listAgents());
  }

  // ---------- 사용자 액션 (routes에서 호출) ----------
  // channel: 'main'(팀장 1:1 비공개) | 'sub:N'(팀원 1:1 비공개) | 'team'(통합 팀 채팅 — 공개)
  // target: team 채널 전용 — 메시지를 받을 에이전트 ('main' | 'sub:N', 기본 팀장)
  function sendChat(channel, text, attachments = [], target = null, pastes = []) {
    if (!text && (attachments.length || pastes.length)) text = text || '(자료 전달)';
    // "@이름 메시지" — 이름으로 에이전트 지목
    const at = text.match(/^@(\S+)\s+([\s\S]+)/);
    const atAgent = at ? db.listAgents().find(a => a.name === at[1]) : null;
    if (atAgent) text = at[2];
    let agent;
    if (channel.startsWith('sub:')) {
      // 팀원 1:1 (조직도 직접 문의) — @이름 지목 시 해당 채널로 전환
      if (atAgent) channel = atAgent.kind === 'main' ? 'main' : `sub:${atAgent.id}`;
      agent = channel.startsWith('sub:') ? db.getAgent(Number(channel.split(':')[1])) : db.getMainAgent();
    } else {
      // 채팅방(main/main:N/team) — 모두 공용 공간: 채널은 유지하고 수신 대상만 결정 (@이름 > target > 팀장)
      agent = atAgent
        || (target && (target === 'main' ? db.getMainAgent() : db.getAgent(Number(String(target).split(':')[1]))))
        || db.getMainAgent();
    }
    if (!agent) throw new Error('agent not found');
    const toMain = agent.kind === 'main';
    // REQ는 자동 생성하지 않는다 — 열린 REQ가 있으면 그 흐름에 귀속되고,
    // 새 작업 요청인지는 팀장이 판단해 open_request로 분류한다.
    let requestId = null;
    if (toMain) requestId = db.listRequests().find(r => r.status === 'active' && (r.channel || 'main') === channel)?.id ?? null;
    const posted = ctx.postMessage({
      channel, request_id: requestId,
      from_actor: 'User', to_actor: toMain ? 'Main' : agent.name,
      kind: 'text', content: { text, ...(attachments.length ? { attachments } : {}), ...(pastes.length ? { pastes } : {}) },
    });
    if (toMain) ctx.lastUserMsgByChannel[channel] = posted.id;
    bus.event('User', 'user', toMain ? `${agent.name}에게 요청 — "${text.slice(0, 40)}"` : `${agent.name}에게 직접 문의`);
    // 목표가 바뀐 뒤 첫 요청이면 시스템 노트로 1회 전달 (자동 실행 아님 — 사용자 요청에 얹어서만)
    let outText = text;
    if (toMain && db.getSetting('goal_dirty', false)) {
      db.setSetting('goal_dirty', false);
      outText = `[시스템 노트: 전체 목표가 다음으로 변경되었다 — "${db.getSetting('goal', '')}". 이 요청을 처리할 때 참고하라.]\n\n${text}`;
    }
    // 붙여넣은 긴 텍스트 — 채팅엔 칩으로 요약 표시되고, 에이전트에게는 원문 전체 전달
    for (let i = 0; i < pastes.length; i++) {
      outText += `\n\n[대표님이 붙여넣은 텍스트 ${i + 1} — ${pastes[i].lines}줄]\n${pastes[i].text}`;
    }
    // 첨부 파일: 워크스페이스 밖 절대경로 — Read 툴로 열람 (구조 분석/git에 안 섞임)
    if (attachments.length) {
      const list = attachments.map(a => `- ${path.join(uploadsDir, a.file)} (${a.name})`).join('\n');
      outText += `\n\n[대표님 첨부 참고자료 ${attachments.length}건 — 아래 절대경로를 Read 툴로 열람해 참고하라 (이미지 열람 가능). 워크스페이스 밖 자료이므로 프로젝트 파일로 취급하거나 복사·커밋하지 마라. 팀원에게 위임 시 브리프에 이 경로를 그대로 포함하라:\n${list}]`;
    }
    // 대표가 팀원에게 직접 보낸 메시지 표식 — 팀원은 이 표식이 있을 때만 대표에게 직접 답한다
    // (팀장 위임 브리프와 같은 세션을 공유하므로 출처를 명시해야 보고 대상이 갈리지 않음)
    if (!toMain) {
      const langNote = db.getSetting('lang', 'ko') === 'ko'
        ? '\n\n[시스템: 역할상 다른 언어가 필요한 경우가 아니면 한국어로 답하라. 이미지를 보여줄 땐 반드시 마크다운 문법 ![설명](워크스페이스 상대경로) 을 메시지에 포함하라 — 문법 없이 말로만 "띄웠다"고 하면 대표님 화면에는 아무것도 보이지 않는다]'
        : '\n\n[System: unless your role requires another language, respond in English. To show an image, you MUST include markdown ![desc](workspace-relative-path) in the message — without it the CEO sees nothing]';
      outText = `[대표님 직접 문의 — 보고·답변은 대표님에게]\n\n${outText}${langNote}`;
    }
    // 이 에이전트가 이 채널의 카드(선택/폼 등)를 기다리는 중이면 — 세션이 카드에 블록돼
    // 새 메시지가 처리되지 않고 행이 걸린다. 메시지를 카드의 자유 답변으로 주입해 즉시 진행시킨다.
    const pend = db.listPendingInteractions()
      .map(it => ({ it, m: db.getMessage(it.message_id) }))
      .find(x => x.m && x.m.channel === channel && x.it.agent_id === agent.id);
    if (pend) {
      answerInteraction(pend.it.id, {
        label: `(선택 대신 직접 답변) ${text.slice(0, 200)}`,
        labels: [`(선택 대신 직접 답변) ${text.slice(0, 200)}`],
        values: { '직접 답변': outText },
        decision: 'request', note: outText, freeText: outText,
      });
      return { requestId, channel, target: toMain ? 'main' : `sub:${agent.id}` };
    }
    // 접수 피드백은 상태 인디케이터(작업 중 도트)가 담당 — 별도 ACK 메시지는 게시하지 않음
    driver.onUserMessage(agent, channel, outText, requestId);
    return { requestId, channel, target: toMain ? 'main' : `sub:${agent.id}` };
  }

  function answerInteraction(id, answer) {
    const it = db.getInteraction(id);
    if (!it || it.status !== 'pending') throw new Error('interaction not pending');
    db.answerInteraction(id);
    db.answerMessage(it.message_id, answer);
    const agent = db.getAgent(it.agent_id);
    bus.message(db.getMessage(it.message_id));
    bus.broadcast('interaction', { id, status: 'answered' });
    bus.event('User', 'user', `질문에 응답 — ${answer.label || (answer.pins || answer.edits ? `리뷰: 핀 ${answer.pins?.length || 0} · 수정 ${answer.edits?.length || 0}` : answer.decision) || JSON.stringify(answer).slice(0, 40)}`);
    if (agent) ctx.setAgentStatus(agent.id, 'working');

    // diff 승인이면 실제 문서 반영 (Q2: 승인 게이트 → 실제 반영)
    if (it.type === 'diff' && answer.decision === 'approve' && it.payload.proposed != null) {
      applyClaudeMd(it.payload.proposed, 'Main', 'docs: CLAUDE.md 수정 (diff 승인)');
    }
    const resolve = resolvers.get(id);
    if (resolve) { resolvers.delete(id); resolve(answer); }
    driver.onInteractionAnswered?.(agent, it, answer);
  }

  function setGoal(goal) {
    const prev = db.getSetting('goal', '');
    db.setSetting('goal', goal);
    // 목표 수정 이력 (최근 30건, 최신이 뒤). 실제 변경일 때만 기록.
    if (goal !== prev) {
      const hist = db.getSetting('goal_history', []);
      hist.push({ ts: Date.now(), goal, prev });
      db.setSetting('goal_history', hist.slice(-30));
      // 세션에 즉시 주입하지 않는다 — 목표는 저장만 하고,
      // 다음 사용자 요청에 시스템 노트로 1회 전달 (goal_dirty).
      db.setSetting('goal_dirty', true);
    }
    bus.settings();
    bus.event('User', 'user', `목표 수정 — "${goal.slice(0, 60)}"`);
    bus.toast('목표가 저장되었습니다. 다음 요청부터 팀장에게 반영됩니다.');
  }

  // 언어 변경 — UI + 에이전트 지침(응답 언어 포함) 모두 전환
  const DEFAULT_NAMES = {
    leadName: { ko: '팀장', en: 'TeamLead' },
    leadRole: { ko: '계획 수립 · 산출물 검증 · 의도 파악', en: 'Planning · verification · intent analysis' },
    mainRoom: { ko: '메인 채팅', en: 'Main Chat' },
  };
  function setLang(lang) {
    if (!['ko', 'en'].includes(lang)) throw new Error('unsupported language');
    const prev = db.getSetting('lang', 'ko');
    db.setSetting('lang', lang);
    // 기본 시드명 자동 마이그레이션 — 사용자가 바꾼 커스텀 이름은 건드리지 않는다
    if (prev !== lang) {
      const main = db.getMainAgent?.() || db.listAgents().find(a => a.kind === 'main');
      if (main) {
        const patch = {};
        if (main.name === DEFAULT_NAMES.leadName[prev]) patch.name = DEFAULT_NAMES.leadName[lang];
        if (main.role === DEFAULT_NAMES.leadRole[prev]) patch.role = DEFAULT_NAMES.leadRole[lang];
        if (Object.keys(patch).length) { db.updateAgent(main.id, patch); bus.agents(); }
      }
      const th = db.getThread('main');
      if (th && th.title === DEFAULT_NAMES.mainRoom[prev]) { db.updateThread('main', { title: DEFAULT_NAMES.mainRoom[lang] }); bus.threads?.(); }
    }
    bus.settings();
    driver.onLangChanged?.();
    bus.event('User', 'user', lang === 'en' ? 'Language changed — English' : '언어 변경 — 한국어');
    bus.toast(lang === 'en' ? 'Language set to English — agents will now operate in English.' : '한국어로 전환되었습니다.');
  }

  function setMode(mode) {
    db.setSetting('mode', mode);
    bus.settings();
    const label = { plan: 'Plan Mode', auto: 'Auto Mode', ask: 'Ask Mode' }[mode] || mode;
    bus.event('User', 'user', `실행 모드 변경 — ${label}`);
    driver.onConfigChanged?.(db.getMainAgent(), { mode });
    // Auto Mode 전환: 대기 중이던 "파일 수정 승인"(diff) 게이트는 자동 승인 —
    // 이전 모드에서 물어본 권한이 전환 후에도 블록하는 문제 방지.
    // (choice/form/artifact는 정보성 질문이라 자동 응답 불가 — 유지)
    if (mode === 'auto') {
      const autoApproved = db.listPendingInteractions().filter(it => it.type === 'diff');
      for (const it of autoApproved) {
        try { answerInteraction(it.id, { decision: 'approve', label: 'Auto Mode 전환 — 자동 승인' }); } catch { /* 경합 */ }
      }
      if (autoApproved.length) bus.toast(`Auto Mode 전환 — 대기 중이던 수정 승인 ${autoApproved.length}건 자동 처리.`);
    }
  }

  function setAgentConfig(agentId, patch) {
    const agent = db.getAgent(agentId);
    if (!agent) throw new Error('agent not found');
    if (patch.name != null) {
      const name = String(patch.name).trim();
      if (!name) throw new Error('이름은 비울 수 없습니다');
      if (/\s/.test(name)) throw new Error('이름에 공백은 사용할 수 없습니다 (@이름 호출용)');
      if (db.listAgents().some(a => a.id !== agentId && a.name === name)) throw new Error('이미 사용 중인 이름입니다');
      patch.name = name;
    }
    db.updateAgent(agentId, patch);
    bus.agents();
    const what = Object.entries(patch).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(', ');
    bus.event('User', 'user', `${agent.name} 설정 변경 — ${what}`);
    driver.onConfigChanged?.(db.getAgent(agentId), patch);
  }

  // 대표 권한 직접 고용 — 결재 절차 없이 즉시 입사 (대표가 곧 결재권자)
  function hireAgent({ name, role, model, effort, prompt }) {
    name = String(name || '').trim();
    if (!name) throw new Error('이름을 입력하세요');
    if (/\s/.test(name)) throw new Error('이름에 공백은 사용할 수 없습니다 (@이름 호출용)');
    if (db.listAgents().some(a => a.name === name)) throw new Error('이미 사용 중인 이름입니다');
    const id = db.insertAgent({
      name, role: role || '', model: model || 'sonnet', effort: effort || 'medium',
      ...(prompt ? { prompt } : {}), status: 'idle',
    });
    bus.agents();
    bus.event('User', 'user', `팀원 직접 고용 — ${name} (${model || 'sonnet'} · ${effort || 'medium'})`);
    bus.toast(`${name} 입사 — 바로 업무 지시가 가능합니다.`);
    ctx.announce(`새 팀원 입사 — ${name} (${role || '역할 미지정'}) · ${model || 'sonnet'} · ${effort || 'medium'} (대표 직접 고용)`);
    return id;
  }

  function addExternalAgent({ provider, name, role, model, effort }) {
    if (provider !== 'openai') throw new Error('현재 실연동 provider는 OpenAI Codex뿐입니다');
    const id = db.insertAgent({ name, role, provider, model: model || 'gpt-5.6-sol', effort: effort || 'medium', status: 'idle' });
    bus.agents();
    bus.event('User', 'user', `외부 AI 연동 — ${name}`);
    bus.toast(`${name} 에이전트가 연동되었습니다.`);
    ctx.announce(`새 팀원 입사 — ${name} (${role || '역할 미지정'}) · 외부 AI(Codex) · ${model || 'gpt-5.6-sol'}`);
    return id;
  }

  // 새 대화 시작 — 세션 분리. 채팅 이력(DB)은 남고 대화 기억만 리셋된다.
  // 팀장은 방(channel) 단위로, 팀원은 에이전트 단위로 리셋.
  function resetAgentSession(agentId, channel) {
    const agent = db.getAgent(agentId);
    if (!agent) throw new Error('agent not found');
    const ch = agent.kind === 'main' ? (channel || 'main') : `sub:${agent.id}`;
    if (agent.kind === 'main') {
      driver.stopThread?.(ch);
      db.updateThread(ch, { session_id: null });
    } else {
      driver.stop?.(agentId);
      db.updateAgent(agentId, { session_id: null, status: 'idle', current_task: '' });
    }
    bus.agents();
    bus.threads?.();
    bus.event('User', 'user', `${agent.name} 새 대화 시작 (세션 분리)`);
    bus.toast('다음 메시지부터 새 대화입니다 — 이전 기억은 참조되지 않습니다.');
    // 대화 구분선 — 해당 방에 시스템 배지
    ctx.postMessage({
      channel: ch,
      from_actor: 'System', to_actor: 'All', kind: 'system',
      content: { text: `새 대화 시작 — 이 지점 이전의 대화는 ${agent.name}이(가) 기억하지 않습니다` },
    });
  }

  // 새 채팅방 생성 — 방마다 독립 세션(기억)
  function createThread(title) {
    const t = db.createThread(String(title || '').trim() || '새 대화방');
    bus.threads?.();
    bus.event('User', 'user', `새 채팅방 — ${t.title}`);
    return t;
  }

  // 방의 pending 인터랙션 정리 — 세션이 죽거나 메시지가 지워지면 카드가 고아가 되어
  // 답변 대기 배지·'작업 중' 상태가 영영 남는다. 취소로 종결하고 대기 에이전트를 idle로.
  function cancelPendingInteractions(channel) {
    for (const it of db.listPendingInteractions()) {
      const m = db.getMessage(it.message_id);
      if (m && m.channel !== channel) continue;
      db.answerInteraction(it.id); // status='answered'로 종결
      if (m) db.answerMessage(it.message_id, { cancelled: true, label: '취소됨 (대화 초기화)' });
      bus.broadcast('interaction', { id: it.id, status: 'answered' });
      const resolve = resolvers.get(it.id);
      if (resolve) { resolvers.delete(it.id); resolve({ cancelled: true, decision: 'reject', label: '취소됨 (대화 초기화)' }); }
      const a = db.getAgent(it.agent_id);
      if (a && a.status === 'waiting') db.updateAgent(a.id, { status: 'idle', current_task: '' });
    }
  }

  // 방 대화 초기화 — 이력 삭제 + 세션 리셋 (방 자체는 유지, 기본 방의 "삭제" 대안)
  // memory=false: 화면 정리용 — 메시지만 삭제(미답변 카드는 유지), 세션·기억·작업은 그대로
  function clearThread(channel, { memory = true } = {}) {
    let label = channel;
    if (!memory) {
      const th = channel.startsWith('sub:') ? null : db.getThread(channel);
      db.clearThreadMessagesKeepPending(channel);
      bus.broadcast('thread_cleared', { channel, keepPending: true });
      bus.event('User', 'user', `대화 내용 지우기 — ${th?.title || label} (기억 유지)`);
      bus.toast('대화 내용을 지웠습니다. 팀장의 기억과 진행 중 작업은 유지됩니다.');
      return;
    }
    cancelPendingInteractions(channel);
    if (channel.startsWith('sub:')) {
      // 팀원 1:1 초기화 — 세션 비대(토큰 낭비) 해소용
      const id = Number(channel.split(':')[1]);
      const a = db.getAgent(id);
      if (!a) throw new Error('팀원 없음');
      driver.stop?.(id);
      db.updateAgent(id, { session_id: null, status: 'idle', current_task: '' });
      label = a.name;
    } else {
      const th = db.getThread(channel);
      if (!th) throw new Error('방 없음');
      driver.stopThread?.(channel);
      db.updateThread(channel, { session_id: null });
      // 이 방에서 일하던 팀장 세션을 강제 종료했으므로 상태도 리셋 — 'working' 잔상 방지
      const main = db.listAgents().find(a => a.kind === 'main');
      if (main && (db.getAgent(main.id).work_channel === channel || channel === 'main')) {
        db.updateAgent(main.id, { status: 'idle', current_task: '' });
      }
      bus.threads?.();
      label = th.title || channel;
    }
    bus.agents();
    db.clearThreadMessages(channel);
    bus.broadcast('thread_cleared', { channel });
    bus.event('User', 'user', `대화 초기화 — ${label}`);
    bus.toast('대화 내용과 기억을 초기화했습니다.');
  }

  // 방별 팀장 스펙 오버라이드 — 미지정(null)이면 팀장 기본값 사용
  function setThreadConfig(channel, patch) {
    const th = db.getThread(channel);
    if (!th) throw new Error('방 없음');
    db.updateThread(channel, {
      ...(patch.model !== undefined ? { model: patch.model || null } : {}),
      ...(patch.effort !== undefined ? { effort: patch.effort || null } : {}),
    });
    driver.stopThread?.(channel); // 진행 중 턴 interrupt — 다음 메시지부터 새 스펙으로 재개(resume — 기억 유지)
    // 중단된 턴의 잔상 정리: '작업 중' 상태 해제 + 이 방의 대기 카드 취소
    cancelPendingInteractions(channel);
    const mainA = db.listAgents().find(a => a.kind === 'main');
    if (mainA && (mainA.work_channel === channel || channel === 'main')) {
      db.updateAgent(mainA.id, { status: 'idle', current_task: '' });
    }
    bus.agents();
    bus.threads?.();
    bus.event('User', 'user', `방 스펙 변경 — ${th.title}: ${patch.model ?? '기본'} · ${patch.effort ?? '기본'} (진행 중 작업 중단)`);
  }

  // 채팅방 이름 변경
  function renameThread(channel, title) {
    title = String(title || '').trim();
    if (!title) throw new Error('방 이름을 입력하세요');
    db.updateThread(channel, { title });
    bus.threads?.();
    bus.toast('방 이름을 변경했습니다.');
  }

  // 채팅방 삭제 — 세션 종료 + 방·대화 이력 제거 (기본 대화/팀 채팅 보호는 db에서)
  function deleteThread(channel) {
    const t = db.getThread(channel);
    driver.stopThread?.(channel);
    db.deleteThread(channel);
    bus.threads?.();
    bus.event('User', 'user', `채팅방 삭제 — ${t?.title || channel}`);
    bus.toast('채팅방을 삭제했습니다 (대화 이력 포함).');
  }

  // 진행 중 작업 중단 (턴 인터럽트 — 세션·대화 유지). channel: 팀장 방 지정(생략 시 전체)
  async function interruptAgent(agentId, channel) {
    const agent = db.getAgent(agentId);
    if (!agent) throw new Error('agent not found');
    await driver.interrupt?.(agentId, channel);
    ctx.setAgentStatus(agentId, 'idle');
    bus.event('User', 'user', `${agent.name} 작업 중단`);
    bus.toast(`${agent.name}의 진행 중 작업을 중단했습니다.`);
  }

  function removeAgent(agentId) {
    const agent = db.getAgent(agentId);
    if (!agent || agent.kind === 'main') throw new Error('cannot remove');
    driver.stop?.(agentId);
    db.deleteAgent(agentId);
    bus.agents();
    bus.event('User', 'user', `팀원 해고 — ${agent.name}`);
    bus.toast(`${agent.name} 해고됨. 진행 중 작업은 팀장이 회수·재분배합니다.`);
    ctx.announce(`팀원 퇴사 — ${agent.name} (대표 결정). 진행 중 작업은 팀장이 회수합니다.`);
    driver.onAgentRemoved?.(db.getMainAgent(), agent);
  }

  // overrides: 관리자가 승인 화면에서 조정한 model/effort (고용 건에만 적용)
  function decideApproval(id, approve, overrides = {}) {
    const ap = db.getApproval(id);
    if (!ap || ap.status !== 'pending') throw new Error('approval not pending');
    db.decideApproval(id, approve ? 'approved' : 'rejected');
    let finalSpec = null;
    if (approve) {
      if (ap.action === 'add') {
        finalSpec = {
          model: overrides.model || ap.target.model || 'sonnet',
          effort: overrides.effort || ap.target.effort || 'medium',
        };
        db.insertAgent({ name: ap.target.name, role: ap.target.role || '', model: finalSpec.model, effort: finalSpec.effort, status: 'idle' });
        ctx.announce(`새 팀원 입사 — ${ap.target.name} (${ap.target.role || '역할 미지정'}) · ${finalSpec.model} · ${finalSpec.effort} (대표 승인)`);
      } else if (ap.action === 'remove' && ap.target.agentId) {
        driver.stop?.(ap.target.agentId);
        db.deleteAgent(ap.target.agentId);
        ctx.announce(`팀원 퇴사 — ${ap.target.name} (대표 승인)`);
      }
      bus.agents();
    }
    bus.approvals();
    bus.event('User', 'user', `결재 ${approve ? '승인' : '거절'} — [${ctx.approvalLabel(ap.action)}] ${ap.target.name}${finalSpec ? ` (${finalSpec.model} · ${finalSpec.effort})` : ''}`);
    bus.toast(approve ? `승인 완료 — ${ap.target.name}` : `거절됨 — ${ap.target.name}`);
    driver.onApprovalDecided?.(db.getMainAgent(), ap, approve, finalSpec);
  }

  // 에이전트에게 실제 적용되는 시스템 프롬프트(Layer 1 + 커스텀 지침) 조회
  function getAgentPrompt(agentId) {
    const agent = db.getAgent(agentId);
    if (!agent) throw new Error('agent not found');
    const lang = db.getSetting('lang', 'ko');
    return agent.kind === 'main'
      ? buildTeamLeadPrompt(db.listAgents().filter(a => a.kind === 'sub'), lang)
      : buildMemberPrompt(agent, lang);
  }

  function readClaudeMd() {
    try { return fs.readFileSync(claudeMdPath, 'utf8'); } catch { return ''; }
  }

  function applyClaudeMd(content, actor, commitMsg) {
    fs.writeFileSync(claudeMdPath, content);
    ctx.gitApi?.commitFile('CLAUDE.md', commitMsg, actor === 'Main' ? '팀장' : actor);
    bus.event(actor, ctx.actorTypeOf(actor), 'CLAUDE.md 반영 (Git 동기화)');
    bus.broadcast('claude_md', { content });
  }

  function saveClaudeMd(content) {
    applyClaudeMd(content, 'User', 'docs: CLAUDE.md 직접 수정');
    bus.toast('CLAUDE.md 저장 — 각 방의 다음 요청부터 반영됩니다.');
    // 토큰 절약: 즉시 전 세션에 통지(방 수만큼 턴 유발)하지 않고,
    // 수정 시각만 기록 → 각 방 세션이 다음 사용자 요청에 1회 노트로 인지 (sdkDriver)
    db.setSetting('claude_md_ts', Date.now());
  }

  function state() {
    return {
      service: { name: process.env.SERVICE_NAME || 'Deskmate', port: Number(process.env.PORT || 3200) },
      driver: driverKind,
      goal: db.getSetting('goal', ''),
      goal_history: db.getSetting('goal_history', []),
      lang: db.getSetting('lang', 'ko'),
      auth: { enabled: !!db.getSetting('auth_enabled', false), has_password: !!db.getSetting('auth_hash', null) },
      mode: db.getSetting('mode', 'plan'),
      last_read: db.getSetting('last_read', {}),
      progress: db.getSetting('progress', 0),
      agents: db.listAgents(),
      tickets: db.listTickets(),
      approvals: db.listApprovals(),
      requests: db.listRequests(),
      threads: db.listThreads(),
      events: db.listEvents(),
      notif_channels: db.getSetting('notif_channels', []),
      nav_order: db.getSetting('nav_order', null),
      show_git_menu: db.getSetting('show_git_menu', false),
      terminal_enabled: db.getSetting('terminal_enabled', false),
      files_enabled: db.getSetting('files_enabled', false),
      caps: ctx.caps || { git: true, codex: false },
      disabled: ctx.disabled || { terminal: false, files: false },
      data_dir: process.env.DATA_DIR || '~/.claude-control/default',
      pending_interactions: db.listPendingInteractions().length,
      claude_md: readClaudeMd(),
    };
  }

  // 전체 기억 초기화: 데이터(대화·티켓·결재·파일)는 유지, 에이전트 세션 기억만 전부 리셋.
  // 팀장 모든 방 세션 + 팀원 전원 세션 종료, pending 카드도 전부 취소(고아 방지).
  // Claude CLI 자동 메모리(~/.claude/projects/<워크스페이스 경로 슬러그>/memory) —
  // 세션이 스스로 기록하는 영속 메모리라 DB 밖에 남는다. 기억 초기화 시 같이 지운다.
  function wipeCliMemory() {
    const slug = path.resolve(workDir).replace(/[/.]/g, '-');
    const memDir = path.join(process.env.HOME || '/root', '.claude', 'projects', slug, 'memory');
    try { fs.rmSync(memDir, { recursive: true, force: true }); } catch { /* noop */ }
  }

  function resetAllMemory() {
    wipeCliMemory();
    for (const it of db.listPendingInteractions()) {
      const m = db.getMessage(it.message_id);
      db.answerInteraction(it.id);
      if (m) db.answerMessage(it.message_id, { cancelled: true, label: '취소됨 (기억 초기화)' });
      bus.broadcast('interaction', { id: it.id, status: 'answered' });
      const resolve = resolvers.get(it.id);
      if (resolve) { resolvers.delete(it.id); resolve({ cancelled: true, decision: 'reject', label: '취소됨 (기억 초기화)' }); }
    }
    for (const th of db.listThreads()) {
      driver.stopThread?.(th.channel);
      db.updateThread(th.channel, { session_id: null });
    }
    for (const a of db.listAgents()) {
      if (a.kind !== 'main') driver.stop?.(a.id);
      db.updateAgent(a.id, { session_id: null, status: 'idle', current_task: '' });
    }
    bus.agents(); bus.threads?.();
    bus.event('User', 'user', '전체 기억 초기화 — 모든 세션 리셋 (데이터 유지)');
    bus.toast('팀장·팀원의 기억을 모두 초기화했습니다. 대화 기록·티켓은 유지됩니다.');
  }

  // 전체 데이터 초기화: 세션 종료 → DB 전체 삭제 → 워크스페이스·첨부 재생성 → 초기 시드
  function resetAll() {
    for (const a of db.listAgents(true)) { try { driver.stop?.(a.id); } catch { /* 세션 없음 */ } }
    db.wipeAll();
    wipeCliMemory();
    fs.rmSync(workDir, { recursive: true, force: true });
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    seedWorkspace(workDir);
    init();
    bus.event('User', 'user', '전체 데이터 초기화 실행');
    for (const fn of ['agents', 'tickets', 'approvals', 'requests', 'settings']) bus[fn]();
    bus.broadcast('claude_md', { content: readClaudeMd() });
  }

  return {
    ctx, init, state, sendChat, answerInteraction, setGoal, setMode, setLang, setAgentConfig,
    hireAgent, addExternalAgent, removeAgent, interruptAgent, resetAgentSession, createThread, renameThread, deleteThread, clearThread, setThreadConfig, decideApproval, getAgentPrompt, readClaudeMd, saveClaudeMd, resetAll, resetAllMemory,
    listModels: () => driver.listModels(),
    oneShotText: (prompt) => (driver.oneShotText ? driver.oneShotText(prompt) : Promise.resolve('')),
  };
}
