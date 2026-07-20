// 실 Claude Agent SDK 드라이버. (검증 대상: @anthropic-ai/claude-agent-sdk 0.1.77)
// - 에이전트별 독립 top-level 세션 (SDK subagent는 일회성이라 1:1 채팅 불가 — ARCHITECTURE.md 참조)
// - 답변 대기 = 커스텀 MCP 툴(ask_choice/ask_form/ask_artifact_review)이 블록 → 웹 카드 → 응답 시 tool result 반환
// - CLAUDE.md 등 파일 편집 → canUseTool diff 승인 카드
// - 오케스트레이터 전용 MCP 툴: dispatch_task / report_progress / upsert_ticket / request_agent_change / submit_report
// - 크래시 복구: session_id를 DB에 저장, 답변 도착 시 resume + 답 주입
//
// SDK API 검증 노트 (0.1.77 타입 정의 기준):
//  - Options에 `effort` 없음 → effort는 앱 메타데이터로만 유지, query에 넘기지 않음
//  - PermissionMode: default|acceptEdits|bypassPermissions|plan|delegate|dontAsk ('auto' 없음)
//  - query()는 setModel/setPermissionMode/interrupt 지원 (스트리밍 입출력 시)
import fs from 'node:fs';
import path from 'node:path';
import { buildTeamLeadPrompt, buildMemberPrompt } from './platformPrompt.js';
import { runCodex, killCodex } from './codexDriver.js';

export function createSdkDriver(ctx) {
  const { db, bus } = ctx;
  const sessions = new Map(); // agentId → { push, end, sessionId, busy }

  let sdk = null;
  async function loadSdk() {
    if (!sdk) sdk = await import('@anthropic-ai/claude-agent-sdk');
    return sdk;
  }

  // 구 라벨 하위호환(과거 DB 값) — 신규 값은 supportedModels()의 실제 model id 그대로 저장
  const MODEL_MAP = { 'opus-4.5': 'opus', 'sonnet-4.5': 'sonnet', 'haiku-4.5': 'haiku' };
  // 앱 MODE → SDK permissionMode. Auto Mode=acceptEdits(파일 자동 수락), Ask/Plan은 게이트.
  const MODE_MAP = { plan: 'plan', auto: 'acceptEdits', ask: 'default' };
  // SDK 0.3+ 정식 effort 5단계. 변경은 query 시점 옵션이라 세션 재시작(resume)으로 반영.
  const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

  function channelOf(agent) { return agent.kind === 'main' ? 'main' : `sub:${agent.id}`; }
  // 세션 키: 팀장은 방(채널)별 독립 세션('main', 'main:N', 'team'), 팀원은 에이전트당 1개
  function skey(agent, channel) { return agent.kind === 'main' ? `t:${channel || 'main'}` : `a:${agent.id}`; }
  // 팀장의 모든 활성 방 세션
  function mainEntries() { return [...sessions.entries()].filter(([k]) => k.startsWith('t:')).map(([, e]) => e); }

  // Layer 1 — 플랫폼 불변 지침 (platformPrompt.js). CLAUDE.md(Layer 2)보다 우선.
  // 언어 설정(lang)에 따라 한국어/영어 지침 주입 — 응답 언어까지 지침이 강제한다.
  function rolePrompt(agent) {
    const lang = db.getSetting('lang', 'ko');
    return agent.kind === 'main'
      ? buildTeamLeadPrompt(db.listAgents().filter(a => a.kind === 'sub'), lang)
      : buildMemberPrompt(agent, lang);
  }

  // 스트리밍 입력용 pushable 큐
  function makeQueue() {
    const buf = []; let notify = null; let done = false;
    return {
      push(v) { buf.push(v); notify?.(); },
      end() { done = true; notify?.(); },
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (buf.length) yield buf.shift();
          if (done) return;
          await new Promise(r => { notify = r; });
          notify = null;
        }
      },
    };
  }

  function buildMcpServer(sdkMod, main, entry) {
    const { createSdkMcpServer, tool } = sdkMod;
    return import('zod').then(({ z }) => createSdkMcpServer({
      name: 'control',
      version: '1.0.0',
      tools: [
        tool('dispatch_task', '서브 에이전트에 작업을 지시한다', {
          agent: z.string().describe('서브 에이전트 이름'),
          task: z.string().describe('작업 내용'),
          request_id: z.number().optional(),
        }, async ({ agent: name, task, request_id }) => {
          const sub = db.listAgents().find(a => a.name === name && !a.deleted && a.kind === 'sub');
          if (!sub) return { content: [{ type: 'text', text: `에이전트 없음: ${name}` }] };
          const reqId = request_id ?? entry.currentRequestId ?? null;
          const room = entry.channel || 'main'; // 위임 대화는 발원한 방에 그대로 표시
          ctx.postMessage({ channel: room, request_id: reqId, from_actor: 'Main', to_actor: sub.name, kind: 'text', content: { text: task } });
          ctx.setAgentStatus(sub.id, 'working', task.slice(0, 60), room);
          // 업무 흐름 자동 티켓: 위임 = 진행 중 티켓 생성 → 응답 = 검토 → REQ 완료 = 자동 done
          const tktTitle = task.split('\n').map(l => l.replace(/^#+\s*/, '').replace(/[*_\`]/g, '').trim()).find(Boolean)?.slice(0, 60) || '위임 작업';
          const tktId = ctx.upsertTicket(
            { title: tktTitle, status: 'in_progress', assignee: sub.name, description: task.slice(0, 500), request_id: reqId },
            { ts: Date.now(), actor: 'System', text: `팀장 → ${sub.name} 위임 (자동 생성)` },
          );
          const reply = await sendAndCollect(sub, task, reqId, room);
          // SDK 팀원은 스트리밍 게시(to Main)가 이미 채팅에 남는다 — 릴레이 중복 게시는 외부 AI(무스트리밍)만
          if (sub.provider) ctx.postMessage({ channel: room, request_id: reqId, from_actor: sub.name, to_actor: 'Main', kind: 'text', content: { text: reply } });
          ctx.setAgentStatus(sub.id, 'idle', '');
          ctx.upsertTicket({ id: tktId, status: 'review' }, { ts: Date.now(), actor: 'System', text: `${sub.name} 응답 — 팀장 검토 대기` });
          return { content: [{ type: 'text', text: `[${sub.name} 응답]\n${reply}\n\n(자동 티켓 TKT-${tktId}: 검토 대기 — 결과를 검증했으면 upsert_ticket으로 done 처리하거나, 보고서 제출 시 자동 완료된다)` }] };
        }),
        tool('open_request', '대표님 메시지를 새 요청(REQ)으로 분류한다. 기존 진행 건과 별개의 새 작업 요청일 때만 호출 — 후속 질문·정정·단순 문의에는 호출하지 마라.', {
          title: z.string().describe('요청 제목 (짧게)'),
        }, async ({ title }) => {
          const id = ctx.openRequest(title, entry.channel || 'main');
          entry.currentRequestId = id; entry.usageRequestId = id;
          return { content: [{ type: 'text', text: `REQ-${id} 생성됨. 이후 대화·토큰이 이 요청에 귀속된다.` }] };
        }),
        tool('close_request', '진행 중이던 요청(REQ)을 완료 처리한다. 작업이 끝나 대표님에게 완료 보고할 때 호출 (submit_report로 보고서를 등록하면 자동 완료되므로 중복 호출 불필요).', {
          request_id: z.number().optional().describe('생략 시 현재 진행 중 REQ'),
        }, async ({ request_id }) => {
          const id = request_id ?? entry.currentRequestId
            ?? db.listRequests().find(r => r.status === 'active' && (r.channel || 'main') === (entry.channel || 'main'))?.id;
          if (!id) return { content: [{ type: 'text', text: '진행 중인 REQ 없음' }] };
          ctx.completeRequest(id, 'done');
          if (entry.currentRequestId === id) entry.currentRequestId = null;
          return { content: [{ type: 'text', text: `REQ-${id} 완료 처리` }] };
        }),
        tool('report_progress', '전체 진행률(%)을 보고한다', {
          percent: z.number(), note: z.string().optional(),
        }, async ({ percent, note }) => {
          ctx.setProgress(percent, note || `진행률 갱신 — ${percent}%`);
          return { content: [{ type: 'text', text: 'ok' }] };
        }),
        tool('upsert_ticket', '티켓 생성/상태 변경', {
          id: z.number().optional(), title: z.string().optional(),
          status: z.enum(['backlog', 'in_progress', 'review', 'done']).optional(),
          priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
          assignee: z.string().optional(), description: z.string().optional(),
          note: z.string().optional(),
        }, async (t) => {
          const id = ctx.upsertTicket(t, { ts: Date.now(), actor: 'Main', text: t.note || '갱신' });
          return { content: [{ type: 'text', text: `TKT-${id}` }] };
        }),
        tool('request_agent_change', '팀원 고용/해고 결재 요청 (대표님 승인 필요)', {
          action: z.enum(['add', 'remove']), name: z.string(),
          model: z.string().optional(), effort: z.string().optional(), role: z.string().optional(),
          reason: z.string().describe('요청 사유 전문. 반드시 빈 줄로 문단을 나눠 작성: ①배경(어떤 작업 중인지) ②이 인력이 필요한 이유(해고면 해고 사유) ③왜 직접 할 수 없는지/기대 역할. 한 덩어리 문단 금지.'),
        }, async ({ action, name, model, effort, role, reason }) => {
          const target = { name, model, effort, role };
          if (action === 'remove') {
            const sub = db.listAgents().find(a => a.name === name && a.kind === 'sub');
            if (sub) target.agentId = sub.id;
          }
          const id = ctx.createApproval(action, target, reason);
          return { content: [{ type: 'text', text: `승인 대기 등록 (#${id}). 사용자 결정을 기다린다.` }] };
        }),
        tool('request_approval', '대표님에게 결재(비동기 승인)를 올린다. 팀원 고용/해고는 request_agent_change, 그 외 대표 결정이 필요한 사안 — 방향 선택 승인, 위험·비용 수반 작업 허가 등 — 은 이 툴. 즉답 가능한 단순 질문은 ask_choice를 써라.', {
          category: z.enum(['decision', 'etc']).describe('decision=결정 필요 사항, etc=기타 결재'),
          title: z.string().describe('결재 제목 (짧게)'),
          reason: z.string().describe('결재 문서 본문. 빈 줄로 문단 구분: 배경 / 요청 사항 / 선택지와 영향'),
        }, async ({ category, title, reason }) => {
          const id = ctx.createApproval(category, { name: title }, reason);
          return { content: [{ type: 'text', text: `결재 대기 등록 (#${id}). 대표님이 결정하면 통지가 온다 — 결정 전까지 해당 사안은 진행하지 마라.` }] };
        }),
        tool('search_history', '전체 채팅 이력(모든 방·팀 채팅·팀원 대화)에서 키워드를 검색한다. 다른 방에서 논의한 결정·내용을 참조해야 할 때 사용 — 방별 대화 기억은 분리되어 있으므로 다른 방 내용은 이 툴로만 찾을 수 있다.', {
          query: z.string().describe('검색 키워드'),
          limit: z.number().optional().describe('최대 결과 수 (기본 10, 최대 30)'),
        }, async ({ query, limit }) => {
          const rows = db.searchMessages(query, Math.min(limit || 10, 30));
          const text = rows.length
            ? rows.map(r => `[${new Date(r.ts).toISOString().slice(0, 16)}] (${r.channel}) ${r.from_actor}→${r.to_actor}: ${String(r.content?.text || r.content?.title || '').replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
            : '검색 결과 없음';
          return { content: [{ type: 'text', text }] };
        }),
        tool('attach_detail', '긴 상세 내용(검토 원문·표·분석 전문)을 접힌 링크 카드로 등록한다. 채팅 본문에는 핵심 요약만 쓰고 상세는 반드시 이 툴로 첨부하라.', {
          title: z.string().describe('카드에 표시될 제목 (짧게)'),
          body: z.string().describe('마크다운 원문 전체 — 표·목록·소제목 그대로'),
        }, async ({ title, body }) => {
          ctx.postMessage({
            channel: entry.replyChannel || entry.channel || 'main', request_id: entry.currentRequestId ?? null,
            from_actor: 'Main', to_actor: 'User', kind: 'detail', content: { title, body },
          });
          return { content: [{ type: 'text', text: '상세 카드 등록 완료. 이어지는 본문에는 핵심 요약과 "자세한 내용은 첨부 카드 참조" 안내만 써라.' }] };
        }),
        tool('ask_artifact_review', '산출물을 대표님에게 미리보기 링크로 보여주고 승인/수정 요청을 받는다 (블로킹). path 전달을 권장 — 상대경로 CSS/JS가 그대로 동작한다.', {
          title: z.string(), summary: z.string(), meta: z.string().optional(),
          path: z.string().optional().describe('워크스페이스 상대경로의 HTML 파일 (권장, 예: index.html 또는 dist/index.html)'),
          url: z.string().optional().describe('이미 실행 중인 서비스의 URL'),
          html: z.string().optional().describe('완결된 단일 HTML 문자열 — 외부 파일 참조 불가한 경우에만'),
        }, async ({ title, summary, meta, path: relPath, url, html }) => {
          let artifactUrl = null;
          if (relPath && !relPath.includes('..')) {
            artifactUrl = `/workspace/${relPath.replace(/^\/+/, '')}`;
          } else if (url) {
            artifactUrl = url;
          } else if (html) {
            // 단일 HTML 문자열은 파일로 저장해 링크 제공
            const dir = path.join(ctx.uploadsDir, 'artifacts');
            fs.mkdirSync(dir, { recursive: true });
            const name = `art-${Date.now().toString(36)}.html`;
            fs.writeFileSync(path.join(dir, name), html);
            artifactUrl = `/uploads/artifacts/${name}`;
          }
          const answer = await ctx.createInteraction(main, entry.replyChannel || entry.channel || 'main', 'artifact', {
            text: summary, artifact: { title, meta: meta || '', url: artifactUrl },
          });
          if (answer.decision === 'approve') return { content: [{ type: 'text', text: '대표님 승인' }] };
          // 주석 리뷰 — 핀 코멘트(요소별)·직접 텍스트 수정·종합 코멘트를 수정 지시서로 조립
          let fb = '대표님 수정 요청:';
          if (answer.pins?.length) {
            fb += '\n\n[요소별 코멘트 — 핀 위치의 요소를 지칭한다]\n'
              + answer.pins.map((p, i) => `${i + 1}. ${p.label ? `"${p.label}" ` : ''}(selector: ${p.selector || '좌표 ' + Math.round(p.xr * 100) + '%,' + Math.round(p.yr * 100) + '%'}) — ${p.comment}`).join('\n');
          }
          if (answer.edits?.length) {
            fb += '\n\n[대표님이 직접 수정한 텍스트 — 이 문구 그대로 반영하라]\n'
              + answer.edits.map(e => `- (${e.selector}) "${e.before}" → "${e.after}"`).join('\n');
          }
          if (answer.note) fb += `\n\n[종합 코멘트] ${answer.note}`;
          fb += '\n\n수정을 반영한 뒤 mcp__control__ask_artifact_review로 같은 path를 다시 검토 요청하라 (버전 반복).';
          return { content: [{ type: 'text', text: fb }] };
        }),
        tool('submit_report', '완료된 요청(REQ)의 산출 보고서를 등록한다. 요청 처리 완료 시 반드시 호출.', {
          request_id: z.number(),
          title: z.string(), subtitle: z.string().optional(),
          date: z.string().optional(),
          summary: z.string().describe('처리 결과 3~4문장 요약'),
          metrics: z.array(z.object({ label: z.string(), value: z.string(), color: z.string().optional() })).max(6).optional(),
          table: z.object({ cols: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
          sections: z.array(z.object({ h: z.string(), b: z.string() })).optional(),
        }, async ({ request_id, ...report }) => {
          ctx.attachReport(request_id, { author: '팀장', ...report }, entry.replyChannel || entry.channel || 'main');
          return { content: [{ type: 'text', text: `REQ-${request_id} 보고서 등록 완료` }] };
        }),
        tool('ask_choice', '2개 이상 선택지를 사용자에게 제시하고 선택을 받는다 (블로킹 — 사용자 응답까지 대기)', {
          prompt: z.string(),
          options: z.array(z.object({ id: z.string(), label: z.string(), desc: z.string().optional() })).min(2),
          multi: z.boolean().optional().describe('복수 선택 허용 — 사용자가 여러 개를 골라 한 번에 제출'),
        }, async ({ prompt, options, multi }) => {
          const answer = await ctx.createInteraction(main, entry.replyChannel || entry.channel || 'main', 'choice', { text: prompt, options, ...(multi ? { multi: true } : {}) });
          return { content: [{ type: 'text', text: multi ? `사용자 선택(복수): ${(answer.labels || []).join(', ')}` : `사용자 선택: ${answer.label} (id=${answer.id})` }] };
        }),
        tool('ask_form', '사용자에게 폼 입력을 요청한다 (블로킹)', {
          prompt: z.string(),
          fields: z.array(z.object({
            key: z.string(), label: z.string(),
            type: z.enum(['text', 'segment']), placeholder: z.string().optional(),
            options: z.array(z.string()).optional(),
          })),
        }, async ({ prompt, fields }) => {
          const answer = await ctx.createInteraction(main, entry.replyChannel || entry.channel || 'main', 'form', { text: prompt, form: { fields } });
          return { content: [{ type: 'text', text: JSON.stringify(answer.values || {}) }] };
        }),
      ],
    }));
  }

  // pendingText: 세션 오류 시 자동 재시도할 메시지 — 반드시 entry 생성 시점에 심는다.
  // (CLI가 resume 실패를 스폰 즉시 뱉으면 onUserMessage의 대입보다 catch가 먼저 도는 레이스가 있음)
  // channel: 팀장의 방('main'|'main:N'|'team') — 방마다 독립 세션(기억)
  async function ensureSession(agent, pendingText = null, channel = null) {
    const key = skey(agent, channel);
    if (sessions.has(key)) {
      const e = sessions.get(key);
      if (pendingText) e.pendingText = pendingText;
      return e;
    }
    // resume 대상 세션 ID — 팀장은 방(threads) 단위, 팀원은 에이전트 단위
    const threadCh = agent.kind === 'main' ? (channel || 'main') : null;
    const thread = agent.kind === 'main' ? db.ensureThread(threadCh) : null;
    const resumeId = thread ? thread.session_id : agent.session_id;
    // 방별 스펙 오버라이드 — 미지정 방은 팀장 기본값
    const effModel = thread?.model || agent.model;
    const effEffort = thread?.effort || agent.effort;
    const mod = await loadSdk();
    const queue = makeQueue();
    // SDKUserMessage 형태: {type:'user', message:APIUserMessage, parent_tool_use_id}
    const entry = {
      push: (t) => queue.push({ type: 'user', message: { role: 'user', content: t }, parent_tool_use_id: null }),
      end: queue.end, sessionId: resumeId, waiters: [], pendingText,
      key, channel: threadCh,
      mdTs: Date.now(), // 새 세션은 CLAUDE.md 최신본을 읽고 시작
    };
    sessions.set(key, entry);

    const mcpServers = agent.kind === 'main' ? { control: await buildMcpServer(mod, agent, entry) } : {};
    const q = mod.query({
      prompt: queue,
      options: {
        cwd: ctx.workDir,
        // 첨부 참고자료(워크스페이스 밖) 열람 허용 — 구조 분석/git 오염 없이 Read만 가능
        additionalDirectories: ctx.uploadsDir ? [ctx.uploadsDir] : [],
        model: MODEL_MAP[effModel] || effModel,
        // SDK 0.3+ 정식 effort (미지원 모델은 CLI가 자동 다운그레이드)
        effort: EFFORT_LEVELS.includes(effEffort) ? effEffort : 'high',
        permissionMode: MODE_MAP[db.getSetting('mode', 'plan')] || 'default',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: rolePrompt(agent) },
        resume: resumeId || undefined,
        mcpServers,
        settingSources: ['project'], // CLAUDE.md 로드 (Layer 2)
        // 구조 강제: 내장 서브에이전트 스폰 차단 — 팀원 고용은 승인 큐 경유만 (Layer 0/1)
        disallowedTools: ['Task', 'Agent'],
        canUseTool: async (toolName, input) => {
          // disallowedTools 우회 대비 이중 방어
          if (toolName === 'Task' || toolName === 'Agent') {
            return { behavior: 'deny', message: '내장 서브에이전트 스폰은 차단되어 있다. 팀원이 필요하면 mcp__control__request_agent_change로 고용을 요청하라.' };
          }
          // AskUserQuestion이 canUseTool로 올 경우: 선택 카드로 처리 (주 경로는 mcp ask_choice)
          // 질문이 여러 개면 전부 순차 카드로 — 첫 질문만 처리하고 버리면 에이전트가 재질문하게 됨
          if (toolName === 'AskUserQuestion') {
            const questions = input.questions || [];
            const answers = {};
            for (let qi = 0; qi < questions.length; qi++) {
              const qn = questions[qi];
              const answer = await ctx.createInteraction(agent, entry.replyChannel || channelOf(agent), 'choice', {
                text: (questions.length > 1 ? `[질문 ${qi + 1}/${questions.length}] ` : '') + (qn?.question || '선택이 필요합니다.'),
                options: (qn?.options || []).map((o, i) => ({ id: String(i), label: o.label, desc: o.description || '' })),
                ...(qn?.multiSelect ? { multi: true } : {}), // 다중 선택은 카드에서 모아 제출
              });
              answers[qn?.question || String(qi)] = qn?.multiSelect ? (answer.labels || [answer.label]).filter(Boolean).join(', ') : answer.label;
            }
            return { behavior: 'allow', updatedInput: { ...input, answers } };
          }
          // Plan Mode 게이트: SDK의 계획 종료(ExitPlanMode)를 기본 allow로 흘려보내면
          // 플랜 승인 없이 실행 단계로 넘어간다(실측: 팀장이 "승인 감사합니다"로 자체 진행).
          // 반드시 대표 승인 카드를 거치게 한다.
          if (toolName === 'ExitPlanMode') {
            const planMd = typeof input?.plan === 'string' ? input.plan : '';
            // 계획 전문은 detail(마크다운 팝업)로 — 카드 본문에 원문을 쏟으면 가독성이 무너진다
            const firstLine = planMd.split('\n').map(l => l.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim()).find(Boolean) || '';
            const answer = await ctx.createInteraction(agent, entry.replyChannel || channelOf(agent), 'choice', {
              text: `[계획 승인 요청] ${agent.kind === 'main' ? '팀장' : `팀원 ${agent.name}`}이(가) 계획 실행 승인을 요청합니다.${firstLine ? `\n${firstLine}` : ''}`,
              detail: { title: '실행 계획 전문', body: planMd },
              options: [
                { id: 'approve', label: '승인 — 실행 진행', desc: '계획대로 실행을 시작합니다.' },
                { id: 'reject', label: '거절 — 계획 보완', desc: '실행하지 않고 계획을 다시 다듬습니다.' },
              ],
            });
            if (answer.id === 'approve' || String(answer.label || '').startsWith('승인')) {
              return { behavior: 'allow', updatedInput: input };
            }
            return { behavior: 'deny', message: answer.freeText
              ? `대표님이 계획 승인 대신 의견을 보냈다: "${answer.freeText}"\n의견을 반영해 계획을 보완하고 다시 승인을 요청하라. 승인 전에는 실행하지 마라.`
              : '대표님이 계획을 승인하지 않았습니다. 무엇을 바꿀지 질문하거나 계획을 보완해 다시 승인을 요청하라. 승인 전에는 실행하지 마라.' };
          }

          const mode = db.getSetting('mode', 'plan');
          const isClaudeMd = typeof input?.file_path === 'string' && input.file_path.endsWith('CLAUDE.md');
          const isEditTool = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName);

          // 구조 강제(Layer 0): 팀장은 구현 노동 금지 — 파일 편집 툴 차단.
          // 예외는 CLAUDE.md(지침 문서)뿐이며, 그것도 diff 승인 카드를 거친다.
          // 프롬프트("직접 구현하지 마라")만으로는 안 지켜지는 것이 실측 확인됨.
          if (agent.kind === 'main' && isEditTool && !isClaudeMd) {
            return {
              behavior: 'deny',
              message: '팀장은 직접 구현할 수 없다(플랫폼 구조). 이 작업은 팀원에게 mcp__control__dispatch_task로 위임하라. 팀원이 없으면 mcp__control__request_agent_change로 고용을 먼저 요청하라.',
            };
          }

          if (isEditTool && (isClaudeMd || mode !== 'auto')) {
            // 승인 카드는 작업이 발원한 공간에 게시 — 위임 턴이면 팀 채팅의 req 흐름, 1:1이면 그 방
            const answer = await ctx.createInteraction(agent, entry.replyChannel || 'main', 'diff', {
              text: `${agent.kind === 'main' ? '팀장' : `팀원 ${agent.name}`}이(가) ${input.file_path} 수정을 제안합니다.`,
              lines: diffLines(input),
              file_path: input.file_path,
            });
            return answer.decision === 'approve'
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: '사용자가 수정을 거절했습니다. 기존 내용을 유지하세요.' };
          }
          return { behavior: 'allow', updatedInput: input };
        },
      },
    });
    entry.q = q;

    (async () => {
      try {
        for await (const msg of q) {
          if (msg.type === 'system' && msg.subtype === 'init') {
            entry.sessionId = msg.session_id;
            if (agent.kind === 'main') db.updateThread(entry.channel, { session_id: msg.session_id });
            else db.updateAgent(agent.id, { session_id: msg.session_id });
          } else if (msg.type === 'rate_limit_event') {
            // 구독 사용량 변화 — 사용량 위젯으로 실시간 전달
            ctx.updateRateLimit(msg.rate_limit_info);
          } else if (msg.type === 'assistant') {
            const text = (msg.message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
            if (text) {
              // 턴 도중 텍스트는 진행 로그(progress) — 채팅에선 접혀 보이고, result 도착 시 마지막 것만 최종 응답으로 승격
              const posted = ctx.postMessage({
                // 응답은 요청이 들어온 공간(1:1/팀 채팅)으로, 위임 턴은 'req'(팀 채팅 공개 흐름)로
                channel: entry.replyChannel || channelOf(agent), request_id: entry.currentRequestId ?? entry.usageRequestId ?? null,
                // 팀원의 현재 턴이 팀장 위임(dispatch)이면 수신자는 팀장 — 대표에게 직접 보고하지 않는다
                from_actor: agent.kind === 'main' ? 'Main' : agent.name,
                to_actor: agent.kind === 'main' ? 'User' : (entry.replyTo || 'User'),
                kind: 'text', content: { text, progress: true },
              });
              entry.lastText = text;
              entry.lastMsgId = posted.id;
              // 작업자 표시(WorkingBar/Indicator)에 지금 뭐 하는지 노출
              ctx.setAgentStatus(agent.id, 'working', text.replace(/\s+/g, ' ').slice(0, 80));
            }
          } else if (msg.type === 'result') {
            // 에러 result는 직후 SDK가 throw — pendingText를 지우지 않고 catch(자동 재시도)에 맡긴다
            if (msg.subtype && msg.subtype !== 'success') continue;
            // 요청별 사용 토큰 집계 (팀장 턴 + 팀원 디스패치 턴 모두 해당 REQ에 귀속)
            if (entry.usageRequestId && msg.usage) {
              const u = msg.usage;
              ctx.addRequestUsage(entry.usageRequestId,
                (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
                u.output_tokens || 0);
            }
            // 마지막 텍스트 = 최종 응답 — progress 해제해 채팅에 정식 표시
            if (entry.lastMsgId) {
              const m = ctx.db.getMessage(entry.lastMsgId);
              if (m?.content?.progress) {
                const { progress, ...rest } = m.content;
                ctx.db.setMessageContent(m.id, rest);
                ctx.bus.message({ ...m, content: rest });
              }
              entry.lastMsgId = null;
            }
            ctx.setAgentStatus(agent.id, 'idle', '');
            entry.pendingText = null;
            for (const w of entry.waiters.splice(0)) w(entry.lastText || '');
            // REQ는 턴 종료로 자동 완료하지 않는다 — 팀장이 close_request/submit_report로 닫는다
          }
        }
      } catch (e) {
        if (entry.stopped) return; // 사용자가 중단/초기화한 세션 — 재시도·이벤트 없이 조용히 종료
        console.error(`[sdk:${agent.name}] 세션 오류:`, e.message);
        sessions.delete(key);
        const actor = agent.kind === 'main' ? 'Main' : agent.name;

        // 마지막 메시지 1회 자동 재시도 (복구 가능한 오류 공통 경로)
        const retry = async (clearSession) => {
          if (!entry.pendingText || entry.wasRetry) return false;
          console.log(`[sdk:${agent.name}] 새 세션으로 마지막 메시지 자동 재전송`);
          const fresh = db.getAgent(agent.id);
          if (clearSession && agent.kind !== 'main') fresh.session_id = null;
          const ne = await ensureSession(fresh, entry.pendingText, entry.channel);
          ne.wasRetry = true;
          ne.currentRequestId = entry.currentRequestId;
          ne.replyChannel = entry.replyChannel;
          ne.replyTo = entry.replyTo;
          ne.push(entry.pendingText);
          return true;
        };

        // 1) resume 대상 transcript 소실(컨테이너 재생성 등): session_id 폐기 후 재시도
        if (/No conversation found|--resume requires a valid session/i.test(e.message)) {
          if (agent.kind === 'main') db.updateThread(entry.channel, { session_id: null });
          else db.updateAgent(agent.id, { session_id: null });
          bus.event(actor, ctx.actorTypeOf(agent.name), '세션 이력 소실 — 새 세션으로 자동 재시작');
          if (await retry(true)) return;
        }
        // 2) 인증 만료(OAuth): 호스트 자격이 갱신됐다면(:ro 마운트) 재복사 후 재시도.
        //    컨테이너는 부팅 시점 복사본을 쓰므로 호스트에서 /login 갱신 시 어긋날 수 있다.
        else if (/OAuth|authenticat|expired/i.test(e.message)) {
          const hostCreds = '/host-claude/.credentials.json';
          const localCreds = path.join(process.env.HOME || '/root', '.claude', '.credentials.json');
          if (fs.existsSync(hostCreds)) {
            try {
              fs.copyFileSync(hostCreds, localCreds);
              bus.event(actor, ctx.actorTypeOf(agent.name), '인증 만료 — 호스트 자격 재적용 후 자동 재시도');
              if (await retry(false)) return;
            } catch (ce) { console.error('[sdk] 자격 재복사 실패:', ce.message); }
          }
          bus.toast('Claude 인증이 만료되었습니다. 호스트에서 claude /login 후 컨테이너를 재시작하세요.');
        }

        bus.event(actor, ctx.actorTypeOf(agent.name), `세션 오류 — 재시작 대기 (${e.message.slice(0, 60)})`);
        ctx.setAgentStatus(agent.id, 'idle');
      }
    })();

    return entry;
  }

  // 세션 강제 종료. entry.end()(입력 큐 닫기)만으로는 진행 중인 턴이 계속 돌며
  // 방에 발화를 이어가는 좀비가 된다(실측: 초기화 후 이전 세션이 계속 조사·보고).
  // interrupt로 턴 자체를 중단하고 stopped 플래그로 catch의 자동 재시도도 차단한다.
  function killEntry(entry) {
    if (!entry) return;
    entry.stopped = true;
    try { Promise.resolve(entry.q?.interrupt?.()).catch(() => { /* 턴 없음 */ }); } catch { /* noop */ }
    try { entry.end(); } catch { /* 이미 닫힘 */ }
    sessions.delete(entry.key);
  }

  function diffLines(input) {
    if (input.old_string != null) {
      return [
        ...String(input.old_string).split('\n').map(t => ({ t: 'del', text: t })),
        ...String(input.new_string || '').split('\n').map(t => ({ t: 'add', text: t })),
      ].slice(0, 60);
    }
    return String(input.content || '').split('\n').slice(0, 60).map(t => ({ t: 'add', text: t }));
  }

  // 외부 AI(Codex) 팀원 실행 — 상태 전환 + 프롬프트(역할·커스텀 지침) 1회 주입 + 세션 저장
  async function runExternal(agent, text) {
    ctx.setAgentStatus(agent.id, 'working', text.replace(/\s+/g, ' ').slice(0, 50));
    // 새 세션이면 역할 프롬프트를 앞에 붙임 (codex에는 systemPrompt 채널이 없음)
    const fresh = db.getAgent(agent.id);
    const payload = fresh.session_id ? text : `${buildMemberPrompt(fresh, db.getSetting('lang', 'ko'))}\n\n---\n\n${text}`;
    const reply = await runCodex(fresh, payload, {
      workDir: ctx.workDir, uploadsDir: ctx.uploadsDir,
      onSessionId: (id) => db.updateAgent(agent.id, { session_id: id }),
    });
    ctx.setAgentStatus(agent.id, 'idle', '');
    return reply;
  }

  // 팀원 턴 직렬화 — 두 방에서 동시에 같은 팀원을 부르면 결과가 뒤바뀌는 레이스 방지.
  // 이전 턴의 result가 끝난 뒤에만 다음 지시를 push한다 (대기 중에도 순서 보장).
  function enqueueSubTurn(entry, setup, text) {
    const run = () => {
      setup();
      const done = new Promise(r => entry.waiters.push(r));
      entry.push(text);
      return done;
    };
    entry.chain = (entry.chain || Promise.resolve()).then(run, run);
    return entry.chain;
  }

  // 서브 세션에 지시를 보내고 result까지 대기 (dispatch_task 릴레이)
  async function sendAndCollect(sub, text, requestId, room = 'main') {
    if (sub.provider) return runExternal(sub, text); // 외부 AI 팀원은 Codex 경로
    const entry = await ensureSession(sub, text);
    return enqueueSubTurn(entry, () => {
      entry.currentRequestId = requestId ?? null;
      entry.usageRequestId = requestId ?? null; // 팀원 사용 토큰도 해당 REQ에 귀속
      entry.replyTo = 'Main'; // 팀장 위임 턴 — 보고 수신자는 팀장
      entry.replyChannel = room; // 위임 대화는 발원한 방에 게시
      entry.pendingText = text;
    }, db.getSetting('lang', 'ko') === 'ko'
      ? `${text}\n\n[시스템: 역할상 다른 언어가 필요한 경우가 아니면 한국어로 보고하라]`
      : `${text}\n\n[System: unless your role requires another language, respond in English]`);
  }

  // 실제 사용 가능 모델 목록 — 일회용 세션에서 supportedModels() 조회.
  // (control request라 LLM 호출/토큰 소모 없음)
  // TTL 캐시: CLI가 새 모델을 내려주면 재기동 없이 10분 내 반영.
  // 초경량 일회성 생성 — 커밋 메시지 등. haiku/low 고정, 툴 없음 (토큰 소모 최소)
  async function oneShotText(prompt) {
    const mod = await loadSdk();
    const queue = makeQueue();
    const q = mod.query({
      prompt: queue,
      options: { cwd: ctx.workDir, tools: [], disallowedTools: ['Task', 'Agent'], permissionMode: 'default', model: 'haiku', effort: 'low', maxTurns: 1 },
    });
    queue.push({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null });
    queue.end();
    let text = '';
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const tt = (msg.message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (tt) text = tt;
      }
      if (msg.type === 'result') break;
    }
    return text;
  }

  let modelsCache = null, modelsCacheAt = 0;
  const MODELS_TTL = 10 * 60_000;
  async function listModels() {
    if (modelsCache && Date.now() - modelsCacheAt < MODELS_TTL) return modelsCache;
    try {
      const mod = await loadSdk();
      const queue = makeQueue();
      const q = mod.query({ prompt: queue, options: { cwd: ctx.workDir, tools: [], permissionMode: 'default' } });
      const models = await q.supportedModels();
      queue.end();
      try { await q.interrupt(); } catch { /* 이미 종료 */ }
      modelsCache = models.map(m => ({
        value: m.value,
        label: m.displayName,
        desc: m.description,
        resolved: m.resolvedModel || null,
        efforts: m.supportedEffortLevels || (m.supportsEffort === false ? [] : ['low', 'medium', 'high']),
      }));
      modelsCacheAt = Date.now();
    } catch (e) {
      console.error('[sdk] supportedModels 조회 실패:', e.message);
      if (!modelsCache) {
        // 폴백: 티어 별칭 (CLI가 각 티어 최신으로 해석)
        modelsCache = [
          { value: 'opus', label: 'Opus (최고성능)', desc: '', resolved: null, efforts: ['low', 'medium', 'high'] },
          { value: 'sonnet', label: 'Sonnet (균형)', desc: '', resolved: null, efforts: ['low', 'medium', 'high'] },
          { value: 'haiku', label: 'Haiku (경량)', desc: '', resolved: null, efforts: ['low', 'medium', 'high'] },
        ];
        modelsCacheAt = Date.now();
      }
    }
    return modelsCache;
  }

  return {
    listModels,
    oneShotText,

    init(agents) {
      // 부팅 시 세션은 게으르게(첫 메시지에) resume — 유휴 세션 유지 비용 방지
      const pend = db.listPendingInteractions();
      if (pend.length) console.log(`[sdk] 미답변 인터랙션 ${pend.length}건 복원 — 답변 도착 시 resume 주입`);
      listModels().then(ms => console.log(`[sdk] 사용 가능 모델 ${ms.length}종 캐시`)); // 예열
    },

    async onUserMessage(agent, channel, text, requestId) {
      // 외부 AI(Codex) 팀원 1:1 — exec/resume 왕복 후 응답 게시
      if (agent.provider) {
        const reply = await runExternal(agent, text);
        ctx.postMessage({
          channel, request_id: requestId ?? null,
          from_actor: agent.name, to_actor: 'User', kind: 'text', content: { text: reply },
        });
        if (requestId) ctx.completeRequest(requestId, 'done');
        return;
      }
      ctx.setAgentStatus(agent.id, 'working', undefined, channel);
      const entry = await ensureSession(agent, text, channel); // pendingText를 생성 시점에 심음
      // CLAUDE.md가 세션 시작 이후 수정됐으면 이번 턴에 1회 노트로 인지시킨다
      if (agent.kind === 'main') {
        const mdTs = db.getSetting('claude_md_ts', 0);
        if (mdTs > entry.mdTs) {
          text = `[시스템 노트: CLAUDE.md가 수정되었다. 파일을 다시 읽고 갱신된 지침을 따르라.]\n\n${text}`;
          entry.mdTs = mdTs;
          entry.pendingText = text;
        }
      }
      if (agent.kind === 'sub') {
        // 팀원: 직렬 큐로 — 진행 중 위임 턴의 라우팅을 덮지 않는다
        enqueueSubTurn(entry, () => {
          entry.currentRequestId = requestId ?? null;
          entry.usageRequestId = requestId ?? null;
          entry.replyTo = 'User';
          entry.replyChannel = channel;
          entry.pendingText = text;
        }, text);
        return;
      }
      entry.currentRequestId = requestId ?? null;
      entry.usageRequestId = requestId ?? null;
      entry.replyTo = 'User'; // 대표 직접 문의 턴 — 대표에게 바로 답한다
      entry.replyChannel = channel; // 응답은 요청이 온 공간(방)으로
      entry.push(text);
    },

    // 크래시 후 답변 도착: 세션이 죽어 있으면 resume 새 세션에 답 주입
    async onInteractionAnswered(agent, interaction, answer) {
      if (!agent) return;
      // 인터랙션이 게시됐던 방을 찾아 그 방 세션에 주입
      const msg = db.getMessage(interaction.message_id);
      const ch = agent.kind === 'main'
        ? ((msg?.channel && (msg.channel === 'team' || msg.channel.startsWith('main'))) ? msg.channel : 'main')
        : null;
      if (sessions.has(skey(agent, ch))) return; // 살아있으면 canUseTool resolve가 처리
      const entry = await ensureSession(agent, null, ch);
      entry.replyChannel = ch || channelOf(agent);
      entry.push(`(재개) 이전 질문 "${interaction.payload.text || interaction.type}"에 대한 사용자 응답: ${JSON.stringify(answer)}. 이어서 진행하라.`);
    },

    async onGoalChanged(main, goal) {
      const entry = await ensureSession(main, null, 'main'); // 시스템 통지는 기본 방으로
      entry.replyChannel = 'main';
      entry.push(`목표가 변경되었다: "${goal}". 계획을 재수립하고 요약을 보고하라.`);
    },

    async onConfigChanged(agent, patch) {
      // 외부 AI(Codex): model/effort는 매 실행마다 플래그로 전달 — 즉시 반영, 세션 유지.
      // role/prompt는 새 스레드에서만 주입되므로 세션을 새로 시작한다.
      if (agent.provider) {
        if (patch.role || patch.prompt != null) db.updateAgent(agent.id, { session_id: null });
        return;
      }
      // 팀장은 열려 있는 모든 방 세션에, 팀원은 자기 세션에 적용
      const entries = agent.kind === 'main' ? mainEntries() : [sessions.get(skey(agent))].filter(Boolean);
      for (const entry of entries) {
        // 미드 세션 제어 요청 (스트리밍 입출력에서만 지원)
        if (patch.mode && entry?.q) await entry.q.setPermissionMode(MODE_MAP[patch.mode] || 'default');
        if (patch.model && entry?.q) await entry.q.setModel(MODEL_MAP[patch.model] || patch.model);
        // effort/role/prompt는 query 시점 옵션(시스템 프롬프트 포함) → 세션 재시작으로 반영
        // (대화 맥락은 session_id resume으로 유지)
        if ((patch.effort || patch.role || patch.prompt != null) && entry) {
          try { entry.end(); } catch { /* already closed */ }
          sessions.delete(entry.key);
        }
      }
    },

    async onAgentRemoved(main, removed) {
      const entry = await ensureSession(main, null, 'main');
      entry.replyChannel = 'main';
      entry.push(`대표님이 팀원 ${removed.name}을(를) 해고했다. 진행 중 작업(${removed.current_task || '없음'})을 회수·재분배하라. 보고 시 "삭제"가 아니라 "해고/퇴사"라고 표현하라.`);
    },

    async onApprovalDecided(main, ap, approved, finalSpec) {
      ctx.setAgentStatus(main.id, 'working', undefined, 'main'); // "기다리는 중" 그대로 멈춰 보이는 문제 방지
      const spec = approved && ap.action === 'add' && finalSpec
        ? ` 최종 스펙: model=${finalSpec.model}, effort=${finalSpec.effort} (관리자가 조정했을 수 있음).`
        : '';
      const text = `결재 #${ap.id} [${ctx.approvalLabel(ap.action)}] "${ap.target.name}" 결과: ${approved ? '승인됨' : '거절됨'}.${spec} 이에 맞게 즉시 이어서 진행하고, 진행 상황을 사용자에게 보고하라.`;
      const entry = await ensureSession(main, text, 'main');
      entry.replyChannel = 'main';
      entry.push(text);
    },

    // 진행 중 턴 중단 — 세션은 유지되고 다음 메시지 수신 가능.
    // channel: 팀장 방 지정(생략 시 팀장의 모든 방 인터럽트)
    async interrupt(agentId, channel) {
      killCodex(agentId); // 외부 AI(Codex)면 프로세스 종료
      const agent = db.getAgent(agentId);
      const entries = agent?.kind === 'main'
        ? (channel ? [sessions.get(`t:${channel}`)].filter(Boolean) : mainEntries())
        : [sessions.get(`a:${agentId}`)].filter(Boolean);
      for (const entry of entries) {
        if (!entry.q) continue;
        entry.pendingText = null; // 중단된 턴은 자동 재시도 대상 아님
        try { await entry.q.interrupt(); } catch (e) { console.error('[sdk] interrupt 실패:', e.message); }
      }
    },

    // 언어 변경: 지침(systemPrompt)은 세션 시작 시 주입 → 모든 세션 재시작(resume으로 맥락 유지)
    onLangChanged() {
      // 진행 중 턴까지 즉시 중단 — 옛 언어 지침의 세션이 계속 발화하는 것을 방지
      for (const [, entry] of [...sessions.entries()]) killEntry(entry);
      // 외부 AI(Codex)는 첫 턴에만 지침 주입 — 세션을 리셋해 새 언어 지침 적용
      for (const a of db.listAgents()) {
        if (a.provider) db.updateAgent(a.id, { session_id: null });
      }
    },

    // 특정 방 세션만 종료 (새 대화 시작)
    stopThread(channel) {
      killEntry(sessions.get(`t:${channel}`));
    },

    stop(agentId) {
      const agent = db.getAgent(agentId);
      if (agent?.kind === 'main') {
        for (const entry of mainEntries()) killEntry(entry);
        return;
      }
      killEntry(sessions.get(`a:${agentId}`));
    },
  };
}
