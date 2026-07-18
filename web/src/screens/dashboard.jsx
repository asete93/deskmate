import { h, Fragment } from 'preact';
import { store } from '../store.js';
import { C, card, label12, Btn, StatusPill, Chip, dotStyle, agentStatus, actorChip, actorLabel, fmtTime, fmtDateTime, modelLabel, REQ_STATUS } from '../ui.jsx';
import { nav } from '../main.jsx';
import { CAT } from './approvals.jsx';
import { t } from '../i18n.js';

const COLS = [
  { key: 'backlog', label: 'Backlog', color: C.t58 },
  { key: 'in_progress', label: 'In Progress', color: C.heading },
  { key: 'review', label: 'Review', color: C.goldText },
  { key: 'done', label: 'Done', color: C.cta },
];

export function Dashboard({ openGoal }) {
  const apPending = store.approvals.filter(a => a.status === 'pending');
  const apCount = apPending.length;
  // 카테고리별 건수 요약 — 예: "결정 필요 1 · 팀원 고용 1"
  const apSummary = apCount
    ? Object.entries(apPending.reduce((acc, a) => { const t = (CAT[a.action] || CAT.etc).text; acc[t] = (acc[t] || 0) + 1; return acc; }, {}))
      .map(([t, n]) => `${t} ${n}`).join(' · ')
    : t('팀원 고용 · 결정 사항 등');
  const qCount = store.pendingCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* GOAL 카드 */}
      <section style={card({ padding: '28px' })}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={label12}>GOAL</div>
            <div style={{ fontSize: '21px', fontWeight: 600, color: C.heading, marginTop: '8px', lineHeight: 1.45 }}>{store.goal}</div>
          </div>
          <Btn variant="outline" onClick={openGoal}>{t('목표 수정')}</Btn>
        </div>
        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, color: C.t58, marginBottom: '8px' }}>
            <span>{t('전체 진행률')}</span><span style={{ color: C.heading }}>{store.progress}%</span>
          </div>
          <div style={{ height: '8px', borderRadius: '50px', background: C.ceramic, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '50px', background: C.cta, width: `${store.progress}%`, transition: 'width 0.4s ease' }} />
          </div>
        </div>
      </section>

      {/* 지금 진행 중 — 활성 요청 + 작업 중인 팀 한눈에 */}
      {(() => {
        const activeReqs = store.requests.filter(r => r.status !== 'done').slice(0, 5);
        const working = store.agents.filter(a => a.status !== 'idle');
        if (!activeReqs.length && !working.length) return null;
        return (
          <section style={card({ padding: '24px' })}>
            <div style={{ ...label12, marginBottom: '14px' }}>지금 진행 중</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', color: C.t58, marginBottom: '8px' }}>열려 있는 요청 {activeReqs.length}건</div>
                {activeReqs.length === 0 && <div style={{ fontSize: '13px', color: C.t58 }}>없음</div>}
                {activeReqs.map(rq => {
                  const st = REQ_STATUS[rq.status] || REQ_STATUS.active;
                  return (
                    <div key={rq.id} onClick={() => nav('chat', 'team')} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f9f9f9'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: C.t58, flexShrink: 0 }}>REQ-{rq.id}</span>
                      <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rq.title}</span>
                      <StatusPill bg={st.bg} color={st.color}>{st.label}</StatusPill>
                    </div>
                  );
                })}
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', color: C.t58, marginBottom: '8px' }}>가동 중인 팀 {working.length}명</div>
                {working.length === 0 && <div style={{ fontSize: '13px', color: C.t58 }}>모두 대기 중</div>}
                {working.map(ag => {
                  const st = agentStatus(ag.status);
                  return (
                    <div key={ag.id} onClick={() => nav(ag.kind === 'main' ? 'chat' : 'subs', ag.kind === 'main' ? null : ag.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f9f9f9'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={dotStyle(st.dot, 7, ag.status === 'working')} />
                      <span style={{ fontSize: '13.5px', fontWeight: 600, flexShrink: 0 }}>{ag.name}</span>
                      <span style={{ flex: 1, fontSize: '12.5px', color: ag.status === 'waiting' ? C.goldText : C.t58, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ag.status === 'waiting' ? '대표님 응답 대기 중' : (ag.current_task || '작업 중')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        {/* AGENTS */}
        <section style={card({ padding: '24px' })}>
          <div style={{ ...label12, marginBottom: '14px' }}>AGENTS</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {store.agents.map(ag => {
              const st = agentStatus(ag.status);
              return (
                <div key={ag.id} onClick={() => nav(ag.kind === 'main' ? 'chat' : 'subs', ag.kind === 'main' ? null : ag.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 10px', borderRadius: '8px', cursor: 'pointer' }}>
                  <span style={dotStyle(st.dot, 8)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ag.name}</div>
                    <div style={{ fontSize: '12.5px', color: ag.status === 'working' && ag.current_task ? C.heading : C.t58, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ag.status === 'working' && ag.current_task ? `▸ ${ag.current_task}` : ag.role}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    <StatusPill bg={st.bg} color={st.color}>{st.label}</StatusPill>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: C.t58, whiteSpace: 'nowrap' }}>{modelLabel(ag.model)} · {ag.effort}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 사용자 확인 필요 */}
          <section style={{ background: C.dark, color: '#fff', borderRadius: '12px', padding: '24px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.7)', marginBottom: '14px' }}>{t('대표님 확인 필요')}</div>
            <div onClick={() => nav('approvals')} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.10)', cursor: 'pointer' }}>
              <span style={{ fontSize: '22px', fontWeight: 700, color: C.gold, minWidth: '26px' }}>{apCount}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{t('결재 대기')}</div>
                <div style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.7)' }}>{apSummary}</div>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>→</span>
            </div>
            <div onClick={() => nav('chat')} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.10)', cursor: 'pointer', marginTop: '8px' }}>
              <span style={{ fontSize: '22px', fontWeight: 700, color: C.gold, minWidth: '26px' }}>{qCount}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{t('답변 대기 질문')}</div>
                <div style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.7)' }}>{t('팀장이 응답을 기다립니다')}</div>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>→</span>
            </div>
          </section>

          {/* TICKETS 요약 */}
          <section style={card({ padding: '24px' })}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ ...label12, flex: 1 }}>TICKETS</div>
              <a onClick={() => nav('tickets')} style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>{t('보드 열기')} →</a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px' }}>
              {COLS.map(cl => (
                <div key={cl.key} style={{ textAlign: 'center', background: '#f9f9f9', borderRadius: '8px', padding: '12px 4px' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: cl.color }}>{store.tickets.filter(t => t.status === cl.key).length}</div>
                  <div style={{ fontSize: '11.5px', fontWeight: 600, color: C.t58, marginTop: '2px' }}>{cl.label}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

    </div>
  );
}
