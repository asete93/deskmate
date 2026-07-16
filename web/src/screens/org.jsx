import { h, Fragment } from 'preact';
import { store } from '../store.js';
import { C, card, Btn, Chip, dotStyle, agentStatus, modelLabel } from '../ui.jsx';
import { nav } from '../main.jsx';

const PROVIDER_LABEL = { openai: 'OpenAI', google: 'Google', xai: 'xAI' };
const VLine = ({ h: hh = 20 }) => <div style={{ width: '2px', height: `${hh}px`, background: C.border }} />;

export function OrgScreen({ openAi }) {
  const main = store.agents.find(a => a.kind === 'main');
  const subs = store.agents.filter(a => a.kind === 'sub');
  const pendingAdds = store.approvals.filter(a => a.status === 'pending' && a.action === 'add');

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
      <div onClick={() => nav('chat')} style={{ background: C.dark, color: '#fff', borderRadius: '12px', padding: '18px 32px', textAlign: 'center', minWidth: '230px', cursor: 'pointer' }}>
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
              <div onClick={() => nav('subs', og.id)} style={card({ padding: '16px 18px', width: '200px', cursor: 'pointer', marginBottom: '16px' })}>
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
    </div>
  );
}
