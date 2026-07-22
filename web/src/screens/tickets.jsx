import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { C, card, label12, Modal, Chip, StatusPill, PRIO, TICKET_STATUS, actorChip, actorLabel, fmtTime, fmtDateTime } from '../ui.jsx';

const COLS = [
  { key: 'backlog', name: 'Backlog' },
  { key: 'in_progress', name: 'In Progress' },
  { key: 'review', name: 'Review' },
  { key: 'done', name: 'Done' },
];
const ORDER = { backlog: 0, in_progress: 1, review: 2, done: 3 };

function TicketModal({ t, onClose }) {
  const prio = PRIO[t.priority] || PRIO.P2;
  const st = TICKET_STATUS[t.status] || TICKET_STATUS.backlog;
  return (
    <Modal onClose={onClose} maxWidth="600px">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: C.t58 }}>TKT-{t.id}</span>
        <Chip bg={prio.bg} color={prio.color} style={{ fontSize: '10.5px', padding: '2px 8px' }}>{t.priority}</Chip>
        <StatusPill bg={st.bg} color={st.color}>{st.label}</StatusPill>
        <span onClick={onClose} style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: '18px', color: C.t58, padding: '0 4px' }}>✕</span>
      </div>
      <div style={{ fontSize: '19px', fontWeight: 600, color: C.heading, marginTop: '10px' }}>{t.title}</div>
      <div style={{ fontSize: '13px', color: C.t58, marginTop: '4px' }}>담당 · {t.assignee || '-'}</div>
      <div style={{ fontSize: '14px', lineHeight: 1.65, marginTop: '14px', whiteSpace: 'pre-wrap', maxHeight: '46vh', overflowY: 'auto', background: C.cream, borderRadius: '10px', padding: '14px 16px' }}>{t.description}</div>
      <div style={{ ...label12, marginTop: '22px', marginBottom: '10px' }}>처리 이력</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {t.history.map((hh, i) => {
          const chip = actorChip(hh.actor);
          return (
            <div key={i} style={{ display: 'flex', gap: '12px', padding: '9px 0', borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: '12.5px', color: C.t58, width: '44px', flexShrink: 0 }}>{fmtTime(hh.ts)}</span>
              <Chip bg={chip.bg} color={chip.color} style={{ height: 'fit-content' }}>{actorLabel(hh.actor)}</Chip>
              <span style={{ fontSize: '13.5px', lineHeight: 1.5 }}>{hh.text}</span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

const COL_CAP = 6; // 컬럼당 기본 표시 수 — 넘치면 '더 보기'로 펼침

export function TicketsScreen() {
  const [view, setView] = useState('board');
  const [selId, setSelId] = useState(null);
  const [expanded, setExpanded] = useState({}); // colKey → true(전체 표시)
  const sel = selId != null ? store.tickets.find(t => t.id === selId) : null;

  const tabStyle = (active) => ({
    borderRadius: '50px', padding: '7px 18px', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${C.cta}`, background: active ? C.cta : '#fff', color: active ? '#fff' : C.cta,
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        <div onClick={() => setView('board')} style={tabStyle(view === 'board')}>{t('보드')}</div>
        <div onClick={() => setView('table')} style={tabStyle(view === 'table')}>{t('테이블')}</div>
      </div>

      {view === 'board' ? (
        <div style={{ overflowX: 'auto', paddingBottom: '8px' }}>
          <div style={{ display: 'flex', gap: '14px', minWidth: '900px', alignItems: 'flex-start' }}>
            {COLS.map(col => {
              const all = store.tickets.filter(t => t.status === col.key);
              const items = expanded[col.key] ? all : all.slice(0, COL_CAP);
              return (
                <div key={col.key} style={{ flex: 1, minWidth: '210px', background: C.ceramic, borderRadius: '12px', padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '0 4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: C.heading }}>{col.name}</span>
                    <span style={{ fontSize: '11.5px', fontWeight: 700, background: '#fff', borderRadius: '50px', padding: '1px 8px', color: C.t58 }}>{all.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {items.map(tk => {
                      const prio = PRIO[tk.priority] || PRIO.P2;
                      return (
                        <div key={tk.id} onClick={() => setSelId(tk.id)} style={{ background: '#fff', borderRadius: '8px', boxShadow: C.cardShadow, padding: '14px', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 700, color: C.t58 }}>TKT-{tk.id}</span>
                            <Chip bg={prio.bg} color={prio.color} style={{ marginLeft: 'auto', fontSize: '10.5px', padding: '2px 8px' }}>{tk.priority}</Chip>
                          </div>
                          <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '6px', lineHeight: 1.4 }}>{tk.title}</div>
                          <div style={{ fontSize: '12px', color: C.t58, marginTop: '8px' }}>{tk.assignee || '-'}</div>
                        </div>
                      );
                    })}
                    {all.length > COL_CAP && (
                      <div onClick={() => setExpanded(p => ({ ...p, [col.key]: !p[col.key] }))}
                        style={{ cursor: 'pointer', textAlign: 'center', fontSize: '12.5px', fontWeight: 700, color: C.cta, background: '#fff', borderRadius: '8px', padding: '9px' }}>
                        {expanded[col.key] ? t('접기') : `${t('더 보기')} +${all.length - COL_CAP}`}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={card({ overflowX: 'auto' })}>
          <div style={{ minWidth: '780px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr 112px 108px 64px 200px', gap: '8px', padding: '13px 20px', borderBottom: `1px solid ${C.line}`, fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58 }}>
              <span>ID</span><span>{t('제목')}</span><span>{t('상태')}</span><span>{t('담당')}</span><span>{t('우선순위')}</span><span>{t('최근 업데이트')}</span>
            </div>
            {[...store.tickets].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id - b.id).map(tr => {
              const st = TICKET_STATUS[tr.status];
              const prio = PRIO[tr.priority] || PRIO.P2;
              return (
                <div key={tr.id} onClick={() => setSelId(tr.id)} style={{ display: 'grid', gridTemplateColumns: '88px 1fr 112px 108px 64px 200px', gap: '8px', padding: '14px 20px', borderBottom: `1px solid ${C.line}`, cursor: 'pointer', alignItems: 'center' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: C.t58 }}>TKT-{tr.id}</span>
                  <span style={{ fontSize: '14px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr.title}</span>
                  <span><StatusPill bg={st.bg} color={st.color}>{st.label}</StatusPill></span>
                  <span style={{ fontSize: '13px', color: C.t58 }}>{tr.assignee || '-'}</span>
                  <Chip bg={prio.bg} color={prio.color} style={{ fontSize: '10.5px', padding: '2px 8px', textAlign: 'center' }}>{tr.priority}</Chip>
                  <span style={{ fontSize: '12.5px', color: C.t58, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtDateTime(tr.updated_ts)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sel && <TicketModal t={sel} onClose={() => setSelId(null)} />}
    </div>
  );
}
