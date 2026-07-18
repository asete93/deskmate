import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { store, showToast } from '../store.js';
import { api } from '../api.js';
import { C, card, Btn, Chip, SegPill, fmtDateTime, modelLabel, modelOptions, effortOptions } from '../ui.jsx';
import { t } from '../i18n.js';

// 결재 카테고리 — 팀원 고용/해고 외에 팀장이 올리는 결정 사항·기타 결재 포함
export const CAT = {
  add: { text: '팀원 고용', bg: C.mint, color: C.heading },
  remove: { text: '팀원 해고', bg: 'rgba(200,32,20,0.10)', color: C.danger },
  decision: { text: '결정 필요', bg: C.goldLight, color: C.goldText },
  etc: { text: '기타', bg: C.ceramic, color: C.t58 },
};
const badge = (action) => CAT[action] || CAT.etc;

// 고용 승인 카드 — 팀장이 제안한 model/effort를 관리자가 조정 후 승인 가능
function PendingCard({ ap, leadName }) {
  const [model, setModel] = useState(ap.target.model || 'sonnet');
  const [effort, setEffort] = useState(ap.target.effort || 'medium');
  const b = badge(ap.action);
  const adjusted = model !== (ap.target.model || 'sonnet') || effort !== (ap.target.effort || 'medium');

  const decide = (approve) => api.post(`/approvals/${ap.id}/decide`,
    approve && ap.action === 'add' ? { approve, model, effort } : { approve },
  ).catch(e => showToast(e.message));

  return (
    <section style={card({ padding: '24px' })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <Chip bg={b.bg} color={b.color} style={{ fontSize: '12px', padding: '4px 12px' }}>{b.text}</Chip>
        <span style={{ fontSize: '17px', fontWeight: 600, color: C.heading }}>{ap.target.name}</span>
        {ap.target.role && <Chip bg={C.ceramic} color={C.t58} style={{ fontWeight: 600, whiteSpace: 'normal', lineHeight: 1.5, maxWidth: '100%' }}>{ap.target.role}</Chip>}
        <span style={{ marginLeft: 'auto', fontSize: '12.5px', color: C.t58 }}>{fmtDateTime(ap.created_ts)}</span>
      </div>

      <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '14px 16px', marginTop: '14px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>{leadName}의 요청 사유</div>
        <div style={{ fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ap.reason}</div>
      </div>

      {ap.action === 'add' && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: '8px', padding: '14px 16px', marginTop: '12px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '10px' }}>
            스펙 — {leadName} 제안: {modelLabel(ap.target.model || 'sonnet')} · {ap.target.effort || 'medium'}
            {adjusted && <span style={{ color: C.goldText, marginLeft: '8px' }}>(조정됨)</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: C.t58, marginBottom: '6px' }}>MODEL</div>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                {modelOptions().map(mo => <SegPill key={mo.value} small active={model === mo.value} onClick={() => setModel(mo.value)}>{mo.label}</SegPill>)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: C.t58, marginBottom: '6px' }}>EFFORT</div>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                {effortOptions(model).map(ef => <SegPill key={ef} small active={effort === ef} onClick={() => setEffort(ef)}>{ef}</SegPill>)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <Btn variant="primary" onClick={() => decide(true)}>{t('승인')}{ap.action === 'add' ? ` (${modelLabel(model)} · ${effort})` : ''}</Btn>
        <Btn variant="darkOutline" onClick={() => decide(false)}>{t('거절')}</Btn>
      </div>
    </section>
  );
}

// 결재 이력 행 — 카테고리·결정 결과·사유(클릭 확장)
function HistoryRow({ ap }) {
  const [open, setOpen] = useState(false);
  const b = badge(ap.action);
  const decided = ap.status === 'approved';
  return (
    <div onClick={() => setOpen(!open)} style={{ padding: '14px 18px', borderBottom: `1px solid ${C.line}`, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <Chip bg={b.bg} color={b.color} style={{ fontWeight: 700 }}>{b.text}</Chip>
        <span style={{ fontSize: '14.5px', fontWeight: 600, color: C.heading, flex: 1, minWidth: '120px' }}>{ap.target.name}</span>
        <Chip bg={decided ? C.mint : 'rgba(200,32,20,0.10)'} color={decided ? C.heading : C.danger} style={{ fontWeight: 700 }}>
          {decided ? t('승인') : t('거절')}
        </Chip>
        <span style={{ fontSize: '12px', color: C.t58 }}>{fmtDateTime(ap.created_ts)}</span>
        <span style={{ fontSize: '11px', color: C.t58 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '12px 14px', marginTop: '10px', fontSize: '13.5px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {ap.reason}
        </div>
      )}
    </div>
  );
}

export function ApprovalsScreen() {
  const [tab, setTab] = useState('pending'); // pending | history
  const pending = store.approvals.filter(a => a.status === 'pending');
  const history = store.approvals.filter(a => a.status !== 'pending');
  const lead = store.agents.find(a => a.kind === 'main');
  const leadName = lead?.name || '팀장';
  const tabStyle = (active) => ({
    padding: '7px 18px', borderRadius: '50px', cursor: 'pointer', fontSize: '13.5px', fontWeight: 700,
    background: active ? C.dark : '#fff', color: active ? '#fff' : C.t58, boxShadow: active ? 'none' : C.cardShadow,
  });

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <div onClick={() => setTab('pending')} style={tabStyle(tab === 'pending')}>{t('대기')} {pending.length > 0 ? `· ${pending.length}` : ''}</div>
        <div onClick={() => setTab('history')} style={tabStyle(tab === 'history')}>{t('결재 이력')} {history.length > 0 ? `· ${history.length}` : ''}</div>
      </div>

      {tab === 'pending' && pending.length === 0 && (
        <section style={card({ padding: '40px', textAlign: 'center' })}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: C.heading }}>{t('대기 중인 결재가 없습니다')}</div>
          <div style={{ fontSize: '13.5px', color: C.t58, marginTop: '6px' }}>{leadName}{t('이(가) 팀원 고용·해고나 대표 결정이 필요한 사안을 올리면 여기에 표시됩니다.')}</div>
        </section>
      )}
      {tab === 'pending' && pending.map(ap => <PendingCard key={ap.id} ap={ap} leadName={leadName} />)}

      {tab === 'history' && (
        history.length === 0
          ? (
            <section style={card({ padding: '40px', textAlign: 'center' })}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: C.heading }}>결재 이력이 없습니다</div>
            </section>
          )
          : <section style={card({ padding: '4px 0' })}>{[...history].reverse().map(ap => <HistoryRow key={ap.id} ap={ap} />)}</section>
      )}
    </div>
  );
}
