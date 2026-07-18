import { h, Fragment } from 'preact';
import { store } from '../store.js';
import {C, card, Btn, Chip, dotStyle, agentStatus, modelLabel, Modal} from '../ui.jsx';
import { nav } from '../main.jsx';
import { useState } from 'preact/hooks';
import { CfgPanel } from './subs.jsx';
import { t } from '../i18n.js';

const PROVIDER_LABEL = { openai: 'OpenAI', google: 'Google', xai: 'xAI' };
const VLine = ({ h: hh = 20 }) => <div style={{ width: '2px', height: `${hh}px`, background: C.border }} />;

export function OrgScreen({ openAi }) {
  const main = store.agents.find(a => a.kind === 'main');
  const subs = store.agents.filter(a => a.kind === 'sub');
  const pendingAdds = store.approvals.filter(a => a.status === 'pending' && a.action === 'add');
  const [pick, setPick] = useState(null);   // 클릭한 에이전트 — 이동/설정 선택 팝업
  const [cfgId, setCfgId] = useState(null); // 설정 팝업 대상 id
  const goChat = (a) => { setPick(null); if (a.kind === 'main') nav('chat'); else nav('subs', a.id); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: '960px', display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: C.t58 }}>회사 조직도</div>
        <div style={{ marginLeft: 'auto' }}>
          <Btn variant="outline" onClick={openAi}>외부 AI 연동</Btn>
        </div>
      </div>

      {/* 대표 */}
      <div style={{ background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '12px', padding: '16px 28px', textAlign: 'center', minWidth: '200px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: C.goldText }}>CEO</div>
        <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>대표</div>
        <div style={{ fontSize: '12px', color: C.t58, marginTop: '2px' }}>목표 설정 · 승인 · 피드백</div>
      </div>
      <VLine h={26} />

      {/* Orchestrator */}
      <div onClick={() => main && setPick(main)} style={{ background: C.dark, color: '#fff', borderRadius: '12px', padding: '18px 32px', textAlign: 'center', minWidth: '230px', cursor: 'pointer' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.7)' }}>MAIN AGENT</div>
        <div style={{ fontSize: '17px', fontWeight: 600, marginTop: '4px' }}>{main?.name || '팀장'}</div>
        <div style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>{main ? `${modelLabel(main.model)} · effort: ${main.effort}` : ''}</div>
      </div>
      <VLine h={26} />
      <div style={{ width: '70%', maxWidth: '760px', borderTop: `2px solid ${C.border}` }} />

      {/* 서브 + 승인 대기 ghost */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 16px', maxWidth: '1000px' }}>
        {subs.map(og => {
          const st = agentStatus(og.status);
          return (
            <div key={og.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <VLine />
              <div onClick={() => setPick(og)} style={card({ padding: '16px 18px', width: '200px', cursor: 'pointer', marginBottom: '16px' })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={dotStyle(st.dot, 8)} />
                  <span style={{ fontSize: '15px', fontWeight: 600, color: C.heading }}>{og.name}</span>
                </div>
                <div style={{ fontSize: '12px', color: C.t58, marginTop: '6px', lineHeight: 1.4 }}>{og.role}</div>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '10px' }}>
                  <Chip bg={C.ceramic} color={C.t58} style={{ fontSize: '10.5px', fontWeight: 600 }}>{modelLabel(og.model)} · {og.effort}</Chip>
                  {og.provider && <Chip bg={C.goldLight} color={C.goldText} style={{ fontSize: '10.5px' }}>{PROVIDER_LABEL[og.provider]} 연동</Chip>}
                </div>
              </div>
            </div>
          );
        })}
        {pendingAdds.map(op => (
          <div key={`p${op.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <VLine />
            {/* 승인 대기 ghost 카드 — 골드 점선 */}
            <div onClick={() => nav('approvals')} style={{ background: 'transparent', border: `1.5px dashed ${C.gold}`, borderRadius: '12px', padding: '16px 18px', width: '200px', cursor: 'pointer', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={dotStyle(C.gold, 8)} />
                <span style={{ fontSize: '15px', fontWeight: 600, color: C.goldText }}>{op.target.name}</span>
              </div>
              <div style={{ fontSize: '12px', color: C.t58, marginTop: '6px', lineHeight: 1.4 }}>{op.target.role}</div>
              <div style={{ marginTop: '10px' }}>
                <Chip bg={C.goldLight} color={C.goldText} style={{ fontSize: '10.5px' }}>고용 승인 대기</Chip>
              </div>
            </div>
          </div>
        ))}
      </div>
      {pick && (
        <Modal onClose={() => setPick(null)} maxWidth="420px">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: C.heading, whiteSpace: 'nowrap', flexShrink: 0 }}>{pick.name}</span>
            <span style={{ fontSize: '12.5px', color: C.t58 }}>{pick.kind === 'main' ? t('팀장') : pick.role}</span>
          </div>
          <div style={{ fontSize: '13px', color: C.t58, marginBottom: '16px' }}>{t('무엇을 할까요?')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Btn variant="primary" onClick={() => goChat(pick)} style={{ justifyContent: 'center' }}>💬 {t('채팅으로 이동')}</Btn>
            <Btn variant="darkOutline" onClick={() => { setCfgId(pick.id); setPick(null); }} style={{ justifyContent: 'center' }}>⚙️ {t('모델·설정 변경')}</Btn>
          </div>
        </Modal>
      )}
      {cfgId != null && (() => {
        const a = store.agents.find(x => x.id === cfgId);
        if (!a) return null;
        return (
          <Modal onClose={() => setCfgId(null)} maxWidth="640px">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '15.5px', fontWeight: 700, color: C.heading, whiteSpace: 'nowrap', flexShrink: 0 }}>{a.name}</span>
              <span style={{ fontSize: '12.5px', color: C.t58 }}>{a.kind === 'main' ? t('팀장') : a.role}</span>
            </div>
            <CfgPanel agent={a} />
          </Modal>
        );
      })()}
    </div>
  );
}
