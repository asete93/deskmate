import fs from 'node:fs';

// 목 드라이버: API 키 없이 전체 플로우(인터랙션 카드 4종·디스패치·승인·티켓·진행률)를 시뮬레이션.
// 상태 변화는 전부 ctx(매니저)를 통해 일어나므로 UI 동작은 실 드라이버와 동일하다.
export function createMockDriver(ctx) {
  const { db, bus } = ctx;
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const say = (agent, channel, text, extra = {}) => ctx.postMessage({
    channel, from_actor: agent.kind === 'main' ? 'Main' : agent.name, to_actor: 'User',
    kind: 'text', content: { text }, ...extra,
  });
  const relay = (from, to, text, requestId) => {
    ctx.postMessage({
      channel: 'req', request_id: requestId,
      from_actor: from, to_actor: to, kind: 'text', content: { text },
    });
  };
  const subByName = (name) => db.listAgents().find(a => a.name === name && !a.deleted);

  async function dispatchFlow(main, text, requestId) {
    ctx.setAgentStatus(main.id, 'working', '요청 분석 및 분배');
    await delay(600);
    say(main, 'main', `요청을 접수했습니다 (REQ-${requestId}). 작업을 분해해 서브 에이전트에 분배하겠습니다.`, { request_id: requestId });

    const builder = subByName('Builder') || db.listAgents().find(a => a.kind === 'sub');
    const verifier = subByName('Verifier');
    const tktId = ctx.upsertTicket(
      { title: text.slice(0, 40), status: 'in_progress', priority: 'P1', assignee: builder?.name || '-', description: `사용자 요청: ${text}` },
      { ts: Date.now(), actor: 'Main', text: '티켓 생성 및 In Progress 이동' },
    );
    bus.event('Main', 'main', `TKT-${tktId} 생성 — ${text.slice(0, 30)}`);

    if (builder) {
      await delay(700);
      ctx.setAgentStatus(builder.id, 'working', `TKT-${tktId} 구현`);
      relay('Main', builder.name, `TKT-${tktId} 구현을 시작하세요. 범위: ${text}`, requestId);
      await delay(1200);
      relay(builder.name, 'Main', `구현 완료. 산출물 커밋 준비됨 (TKT-${tktId}).`, requestId);
      ctx.setAgentStatus(builder.id, 'idle', '');
    }
    if (verifier) {
      await delay(500);
      ctx.setAgentStatus(verifier.id, 'working', `TKT-${tktId} 검증`);
      relay('Main', verifier.name, `산출물 검증 요청 (TKT-${tktId}).`, requestId);
      await delay(1000);
      relay(verifier.name, 'Main', '검증 통과 — 회귀 없음, 스모크 테스트 정상.', requestId);
      ctx.setAgentStatus(verifier.id, 'idle', '');
    }
    ctx.upsertTicket({ id: tktId, status: 'review' }, { ts: Date.now(), actor: verifier?.name || 'Main', text: '검증 통과 — Review 이동' });
    await delay(500);
    say(main, 'main', `처리 완료했습니다. TKT-${tktId} 검증까지 통과했고 Review 상태입니다. 상세 흐름은 요청 로그 REQ-${requestId}에서, 정리 결과는 보고서에서 확인할 수 있습니다.`, { request_id: requestId });
    const prog = db.getSetting('progress', 0);
    ctx.setProgress(prog + 4, `진행률 갱신 — ${Math.min(100, prog + 4)}%`);

    // 산출 보고서 작성 (요청 완료 시)
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    ctx.attachReport(requestId, {
      title: `${text.slice(0, 24)} — 처리 결과 보고서`,
      subtitle: `REQ-${requestId} · ${text.slice(0, 40)}`,
      author: '팀장',
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      summary: `사용자 요청 "${text.slice(0, 60)}"을(를) TKT-${tktId}로 분해하여 ${builder?.name || 'Builder'}가 구현하고 ${verifier?.name || 'Verifier'}가 검증했습니다. 회귀 없이 스모크 테스트를 통과했으며 현재 Review 상태로 사용자 최종 확인만 남았습니다. 전체 진행률은 ${Math.min(100, prog + 4)}%로 갱신되었습니다.`,
      metrics: [
        { label: '생성 티켓', value: `TKT-${tktId}`, color: '#006241' },
        { label: '참여 에이전트', value: `${[builder, verifier].filter(Boolean).length + 1}명`, color: '#00754a' },
        { label: '검증 결과', value: 'PASS', color: '#006241' },
        { label: '진행률', value: `${Math.min(100, prog + 4)}%`, color: '#8a6a2f' },
      ],
      table: {
        cols: ['단계', '담당', '결과'],
        rows: [
          ['요청 분해·티켓 생성', '팀장', `TKT-${tktId} 생성`],
          ['구현', builder?.name || '-', '완료 · 커밋 준비'],
          ['검증', verifier?.name || '-', '통과 (회귀 없음)'],
          ['상태 전환', '팀장', 'In Progress → Review'],
        ],
      },
      sections: [
        { h: '리스크 평가', b: '검증 단계에서 회귀가 발견되지 않았습니다. 다만 Review 상태의 산출물은 사용자 승인 전이므로 배포 대상에 포함하지 않습니다. 승인 지연 시 후속 티켓 일정에 1일 이내 영향이 예상됩니다.' },
        { h: '실행 조치', b: `사용자 확인 후 TKT-${tktId}를 Done으로 전환합니다. 관련 문서화는 Scribe가 릴리즈 노트에 반영할 예정입니다.` },
      ],
    });

    ctx.completeRequest(requestId, 'done');
    ctx.setAgentStatus(main.id, 'working', '목표 기준 계획 관리');
  }

  return {
    async listModels() {
      return [
        { value: 'opus', label: 'Opus (최고성능)', desc: '목 모드 — 티어 별칭', resolved: null, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'sonnet', label: 'Sonnet (균형)', desc: '목 모드 — 티어 별칭', resolved: null, efforts: ['low', 'medium', 'high'] },
        { value: 'haiku', label: 'Haiku (경량)', desc: '목 모드 — 티어 별칭', resolved: null, efforts: ['low', 'medium', 'high'] },
      ];
    },

    init() { /* 목 모드: 부팅 시 별도 세션 없음 */ },

    async onUserMessage(agent, channel, text, requestId) {
      if (channel !== 'main') {
        // 서브 1:1 채팅
        ctx.setAgentStatus(agent.id, 'working');
        await delay(800);
        const roleReply = {
          Builder: `현재 ${agent.current_task || '대기'} 상태입니다. 문의하신 내용 확인했습니다: "${text}" — 구현 관점에서는 문제 없습니다.`,
          Verifier: `검증 기준으로 답변드립니다: "${text}" — 테스트 커버리지에 반영하겠습니다.`,
          Researcher: `리서치 관점 요약: "${text}"에 대해 관련 사례 3건을 정리해 두겠습니다.`,
          Scribe: `문서에 반영하겠습니다: "${text}" — 릴리즈 노트 초안에 추가합니다.`,
        }[agent.name] || `확인했습니다: "${text}"`;
        say(agent, channel, roleReply);
        ctx.setAgentStatus(agent.id, agent.current_task ? 'working' : 'idle');
        return;
      }

      const main = agent;
      const t = text.toLowerCase();
      await delay(500);

      if (/선택|옵션|choice/.test(t)) {
        const answer = await ctx.createInteraction(main, 'main', 'choice', {
          text: '진행 방향을 선택해 주세요. 두 가지 접근이 가능합니다.',
          options: [
            { id: 'fast', label: '빠른 프로토타입', desc: '핵심 플로우만 우선 구현, 2일 내 시안 검토 가능' },
            { id: 'solid', label: '안정 우선', desc: '테스트·에러 처리 포함 완성도 우선, 5일 소요' },
          ],
        }, { requestId });
        await delay(600);
        say(main, 'main', `"${answer.label}" 방향으로 확정했습니다. 계획에 반영합니다.`, { request_id: requestId });
        ctx.completeRequest(requestId, 'done');
      } else if (/diff|지침|claude/.test(t)) {
        const current = fs.readFileSync(ctx.claudeMdPath, 'utf8');
        const addition = '\n## 추가 규칙\n- 모든 PR은 스크린샷을 첨부한다.\n';
        const answer = await ctx.createInteraction(main, 'main', 'diff', {
          text: 'CLAUDE.md에 다음 규칙 추가를 제안합니다. 승인 시 즉시 반영됩니다.',
          lines: [
            { t: 'ctx', text: '## 코드 컨벤션' },
            { t: 'ctx', text: '- 커밋 메시지는 한국어, 타입 프리픽스(feat/fix/docs).' },
            { t: 'add', text: '## 추가 규칙' },
            { t: 'add', text: '- 모든 PR은 스크린샷을 첨부한다.' },
          ],
          proposed: current + addition,
        }, { requestId });
        await delay(500);
        say(main, 'main', answer.decision === 'approve'
          ? 'CLAUDE.md에 반영 완료했습니다. Git 파일 뷰에서도 확인 가능합니다.'
          : '제안을 철회합니다. 기존 지침을 유지합니다.', { request_id: requestId });
        ctx.completeRequest(requestId, 'done');
      } else if (/아티팩트|시안|미리보기|artifact/.test(t)) {
        const answer = await ctx.createInteraction(main, 'main', 'artifact', {
          text: 'Builder가 완성한 로그인 화면 시안입니다. 검토해 주세요.',
          artifact: { kind: 'login-preview', title: '로그인 화면 v1', meta: 'TKT-102 · login-v1.html · Builder' },
        }, { requestId });
        await delay(500);
        say(main, 'main', answer.decision === 'approve'
          ? '승인 확인했습니다. Builder에게 다음 단계(회원가입 화면)를 지시합니다.'
          : `수정 요청을 Builder에게 전달했습니다${answer.note ? ` — "${answer.note}"` : ''}.`, { request_id: requestId });
        ctx.completeRequest(requestId, 'done');
      } else if (/폼|입력|form|배포|스테이징/.test(t)) {
        const answer = await ctx.createInteraction(main, 'main', 'form', {
          text: '배포 대상 설정이 필요합니다. 도메인과 환경을 입력해 주세요.',
          form: {
            fields: [
              { key: 'domain', label: 'DOMAIN', type: 'text', placeholder: 'staging.example.com' },
              { key: 'env', label: 'ENVIRONMENT', type: 'segment', options: ['Staging', 'Production'] },
            ],
          },
        }, { requestId });
        await delay(500);
        say(main, 'main', `설정 적용 완료 — ${answer.values?.domain || '-'} / ${answer.values?.env || '-'} 기준으로 배포 파이프라인을 구성합니다.`, { request_id: requestId });
        ctx.completeRequest(requestId, 'done');
      } else if (/에이전트 *추가|충원|designer|디자이너/.test(t)) {
        say(main, 'main', '디자인 산출물 병목이 있어 Designer 에이전트 추가가 필요합니다. 승인 대기 큐에 요청을 올렸습니다.', { request_id: requestId });
        ctx.createApproval('add',
          { name: 'Designer', model: 'sonnet-4.5', effort: 'medium', role: 'UI 시안 · 디자인 시스템' },
          '로그인·대시보드 화면 시안 요청이 3건 밀려 있습니다. Builder가 구현과 시안을 겸하면서 처리량이 40% 떨어졌습니다. 시안 전담 Designer를 추가하면 병렬 처리로 이번 주 내 백로그 해소가 가능합니다.');
        ctx.completeRequest(requestId, 'approval');
      } else {
        await dispatchFlow(main, text, requestId);
      }
    },

    onInteractionAnswered() { /* 후속 응답은 onUserMessage 내 await 흐름에서 처리 */ },

    async onGoalChanged(main, goal) {
      await delay(700);
      say(main, 'main', `목표 변경을 확인했습니다 — "${goal}". 기존 계획을 재수립하고 티켓 우선순위를 재조정합니다.`);
      bus.event('Main', 'main', '목표 변경에 따른 계획 재수립 시작');
    },

    async onConfigChanged(agent, patch) {
      if (agent.kind !== 'main') return;
      await delay(500);
      if (patch.mode) {
        const desc = {
          plan: 'Plan Mode — 계획까지만 수행하고 실행 전 승인을 받습니다.',
          auto: 'Auto Mode — 승인 지정 항목 외에는 자동 실행합니다.',
          ask: 'Ask Mode — 단계마다 확인을 요청합니다.',
        }[patch.mode];
        say(agent, 'main', `실행 모드 전환 확인: ${desc}`);
      } else {
        say(agent, 'main', `설정 변경 적용 완료 (${Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', ')}).`);
      }
    },

    async onAgentRemoved(main, removed) {
      await delay(600);
      say(main, 'main', `${removed.name} 해고를 확인했습니다. 진행 중이던 작업(${removed.current_task || '없음'})은 회수하여 재분배합니다.`);
      bus.event('Main', 'main', `${removed.name} 작업 회수 · 재분배`);
    },

    async onApprovalDecided(main, ap, approved) {
      await delay(600);
      const what = `${ap.target.name} ${ap.action === 'add' ? '고용' : '해고'}`;
      say(main, 'main', approved
        ? `${what} 승인 확인. ${ap.action === 'add' ? '온보딩 후 백로그 티켓을 할당합니다.' : '작업 회수 완료.'}`
        : `${what} 거절 확인. 현 구성으로 계획을 유지합니다.`);
    },

    async onClaudeMdChanged(main) {
      await delay(500);
      say(main, 'main', 'CLAUDE.md 변경을 감지했습니다. 갱신된 지침을 즉시 적용합니다. (실행 중 세션에는 변경 통지가 주입됩니다)');
    },

    interrupt() { /* 목 모드: 중단할 실 세션 없음 */ },

    stop() { /* 목 모드: 정리할 세션 없음 */ },
  };
}
