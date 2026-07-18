import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { store, showToast } from '../store.js';
import { api } from '../api.js';
import { C, card, Btn, SegPill, Modal, StatusPill, Chip, dotStyle, agentStatus, modelOptions, effortOptions, modelLabel, providerModelOptions, providerEffortOptions, Spin } from '../ui.jsx';
import { I } from '../icons.jsx';
import { nav } from '../main.jsx';
import { MessageList, ChatInput, AgentSwitcher } from './chat.jsx';
import { OrgScreen } from './org.jsx';
import { t } from '../i18n.js';

export function CfgPanel({ agent, small }) {
  const [nameDraft, setNameDraft] = useState(null);
  const [avatarDraft, setAvatarDraft] = useState(null);
  const [roleDraft, setRoleDraft] = useState(null);
  const [promptDraft, setPromptDraft] = useState(null);
  const [fullPrompt, setFullPrompt] = useState(null); // 적용 프롬프트 열람 중이면 내용
  const [pillBusy, setPillBusy] = useState(null);
  const setCfg = (patch) => api.post(`/agents/${agent.id}/config`, patch).catch(e => showToast(e.message));
  const setCfgPill = (key, patch) => { setPillBusy(key); Promise.resolve(setCfg(patch)).finally(() => setTimeout(() => setPillBusy(null), 250)); };
  const toggleFullPrompt = async () => {
    if (fullPrompt != null) { setFullPrompt(null); return; }
    try { setFullPrompt((await api.get(`/agents/${agent.id}/prompt`)).content); } catch (e) { showToast(e.message); }
  };
  const inputStyle = { flex: 1, minWidth: 0, border: `1px solid ${C.border}`, borderRadius: '4px', padding: '7px 10px', fontSize: '13px', outlineColor: C.cta };
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#fff' }}>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>NAME</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input value={nameDraft ?? agent.name} onInput={e => setNameDraft(e.target.value)} style={inputStyle} />
          <Btn variant="outline" small onClick={() => { if (nameDraft && nameDraft !== agent.name) setCfg({ name: nameDraft }); }}>변경</Btn>
        </div>
        <div style={{ fontSize: '11.5px', color: C.t58, marginTop: '4px' }}>"@이름 요청내용"으로 이 팀원을 직접 부를 수 있습니다.</div>
      </div>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>아바타 (1~4자 · 이모지 가능)</div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input value={avatarDraft ?? (agent.avatar || '')} maxLength={4} onInput={e => setAvatarDraft(e.target.value)} placeholder={agent.name.slice(0, 2)} style={{ ...inputStyle, flex: 'none', width: '90px', textAlign: 'center' }} />
          <Btn variant="outline" small onClick={() => { if (avatarDraft != null) setCfg({ avatar: avatarDraft.trim() }); }}>변경</Btn>
          <span style={{ fontSize: '11.5px', color: C.t58 }}>채팅 발신자 아이콘에 표시 — 비우면 이름 앞 2자</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>ROLE</div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          <textarea value={roleDraft ?? agent.role} rows={3} onInput={e => setRoleDraft(e.target.value)} placeholder="예: 코드 구현"
            style={{ ...inputStyle, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />
          <Btn variant="outline" small onClick={() => { if (roleDraft != null && roleDraft !== agent.role) setCfg({ role: roleDraft.trim() }); }}>변경</Btn>
        </div>
      </div>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>커스텀 지침 (이 팀원에게만 추가 적용)</div>
        <textarea value={promptDraft ?? (agent.prompt || '')} onInput={e => setPromptDraft(e.target.value)} rows={3}
          placeholder="예: 모든 코드에 JSDoc을 붙여라. 테스트는 vitest만 사용."
          style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '4px', padding: '8px 10px', fontSize: '12.5px', lineHeight: 1.5, outlineColor: C.cta, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
          <Btn variant="outline" small onClick={() => { if (promptDraft != null && promptDraft !== (agent.prompt || '')) { setCfg({ prompt: promptDraft }); showToast('저장됨 — 다음 메시지부터 적용됩니다.'); } }}>지침 저장</Btn>
          <Btn variant="darkOutline" small onClick={toggleFullPrompt}>{fullPrompt != null ? '적용 프롬프트 닫기' : '적용 프롬프트 보기'}</Btn>
        </div>
        {fullPrompt != null && (
          <pre style={{ margin: '8px 0 0', background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '8px', padding: '12px', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '11.5px', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: '260px', overflowY: 'auto', color: C.t87 }}>{fullPrompt}</pre>
        )}
      </div>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>
          MODEL{agent.provider && <Chip bg={C.goldLight} color={C.goldText} style={{ marginLeft: '6px' }}>{agent.provider === 'openai' ? 'Codex 연동' : `${agent.provider} 연동`}</Chip>}
        </div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {(agent.provider ? providerModelOptions(agent.provider) : modelOptions()).map(mo =>
            <SegPill key={mo.value} small={small} active={agent.model === mo.value} onClick={() => setCfgPill(`m:${mo.value}`, { model: mo.value })}>{pillBusy === `m:${mo.value}` ? <Spin /> : null} {mo.label}</SegPill>)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>EFFORT</div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {(agent.provider ? providerEffortOptions(agent.provider) : effortOptions(agent.model)).map(ef =>
            <SegPill key={ef} small={small} active={agent.effort === ef} onClick={() => setCfgPill(`e:${ef}`, { effort: ef })}>{pillBusy === `e:${ef}` ? <Spin /> : null} {ef}</SegPill>)}
        </div>
      </div>
    </div>
  );
}

const PROVIDER_LABEL = { openai: 'OpenAI', google: 'Google', xai: 'xAI' };

// 대표 권한 직접 고용 모달 — 스펙(이름·역할·모델·effort·지침)을 대표가 직접 지정
function HireModal({ onClose }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [model, setModel] = useState('sonnet');
  const [effort, setEffort] = useState('medium');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const hire = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/agents', { name: name.trim(), role: role.trim(), model, effort, prompt: prompt.trim() || undefined });
      onClose();
    } catch (e) { showToast(e.message); }
    setBusy(false);
  };
  const label = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' };
  const inputStyle = { width: '100%', border: `1px solid ${C.line}`, borderRadius: '8px', padding: '9px 12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' };
  return (
    <Modal onClose={onClose} maxWidth="520px">
      <div style={{ fontSize: '17px', fontWeight: 700, color: C.heading, marginBottom: '4px' }}>{t('팀원 고용 (대표 권한)')}</div>
      <div style={{ fontSize: '12.5px', color: C.t58, marginBottom: '16px' }}>결재 절차 없이 즉시 입사합니다. 스펙은 입사 후에도 변경할 수 있습니다.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={label}>이름 (공백 불가 — @호출용)</div>
            <input value={name} onInput={e => setName(e.target.value)} placeholder="예: QA담당" style={inputStyle} />
          </div>
          <div style={{ flex: 1.4 }}>
            <div style={label}>역할</div>
            <input value={role} onInput={e => setRole(e.target.value)} placeholder="예: 테스트·검증 전담" style={inputStyle} />
          </div>
        </div>
        <div>
          <div style={label}>MODEL</div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {modelOptions().map(mo => <SegPill key={mo.value} small active={model === mo.value} onClick={() => setModel(mo.value)}>{mo.label}</SegPill>)}
          </div>
        </div>
        <div>
          <div style={label}>EFFORT</div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {effortOptions(model).map(ef => <SegPill key={ef} small active={effort === ef} onClick={() => setEffort(ef)}>{ef}</SegPill>)}
          </div>
        </div>
        <div>
          <div style={label}>커스텀 지침 (선택)</div>
          <textarea value={prompt} onInput={e => setPrompt(e.target.value)} rows={3} placeholder="이 팀원에게만 적용할 추가 지침"
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <Btn variant="darkOutline" onClick={onClose}>{t('취소')}</Btn>
          <Btn variant="primary" onClick={hire} disabled={!name.trim() || busy}>{busy ? '입사 처리 중…' : '고용'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

export function SubsScreen({ param, openAi }) {
  const [cfgOpenId, setCfgOpenId] = useState(null); // 열린 카드만 확장 (grid align-items:start)
  const [delTarget, setDelTarget] = useState(null);
  const [hireOpen, setHireOpen] = useState(false);
  const [chatCfgOpen, setChatCfgOpen] = useState(false);
  const [view, setView] = useState('org'); // 기본 조직도 — 팀원 목록은 탭 전환
  const subs = store.agents.filter(a => a.kind === 'sub');
  const sel = param ? subs.find(a => a.id === Number(param)) : null;

  const doDelete = async () => {
    try { await api.del(`/agents/${delTarget.id}`); } catch (e) { showToast(e.message); }
    setDelTarget(null);
  };

  if (sel) {
    const st = agentStatus(sel.status);
    const mobile = window.innerWidth < 840;
    const iconBtn = (active) => ({
      width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: active ? '#fff' : 'rgba(255,255,255,0.12)', color: active ? C.dark : 'rgba(255,255,255,0.85)',
    });
    const band = (
      <div style={{ background: C.dark, color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', borderRadius: mobile ? '12px' : '0' }}>
        <AgentSwitcher current={String(sel.id)} dark
          subtitle={`${modelLabel(sel.model)} · ${sel.effort}${sel.provider ? ` · ${PROVIDER_LABEL[sel.provider]} 연동` : ''} · ${sel.role || '팀원'}`} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StatusPill bg={st.bg} color={st.color}>{st.label}</StatusPill>
          <span onClick={() => {
            if (confirm(`${sel.name}의 대화를 초기화할까요?\n대화 내용과 기억이 모두 지워집니다. (누적 세션이 길어지면 토큰이 낭비됩니다)`)) {
              api.post(`/threads/${encodeURIComponent(`sub:${sel.id}`)}/clear`).catch(e => showToast(e.message));
            }
          }} title="대화 초기화 — 이 팀원의 대화 내용과 기억을 비웁니다" style={iconBtn(false)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
          </span>
          <span onClick={() => setChatCfgOpen(!chatCfgOpen)} title="팀원 설정 (이름·역할·지침·모델)" style={iconBtn(chatCfgOpen)}>{I.settings(15)}</span>
        </div>
      </div>
    );
    const cfg = chatCfgOpen && (
      mobile ? <CfgPanel agent={sel} />
        : <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.line}` }}><CfgPanel agent={sel} /></div>
    );
    return (
      <div style={{ maxWidth: '860px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <a onClick={() => nav('subs')} style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 600, alignSelf: 'flex-start' }}>← 목록으로</a>
        {mobile ? (
          <>
            {band}
            {cfg}
            <MessageList channel={`sub:${sel.id}`} agentName={sel.name} agentColor={C.sub} />
            <ChatInput channel={`sub:${sel.id}`} placeholder={`${sel.name}에게 직접 문의…`} />
          </>
        ) : (
          <div style={card({ overflow: 'hidden' })}>
            {band}
            {cfg}
            <div style={{ background: '#edeae3', margin: '12px 12px 0', borderRadius: '8px' }}>
              <MessageList channel={`sub:${sel.id}`} agentName={sel.name} agentColor={C.sub} inCard />
            </div>
            <div style={{ margin: '12px' }}>
              <ChatInput channel={`sub:${sel.id}`} placeholder={`${sel.name}에게 직접 문의…`} inCard />
            </div>
          </div>
        )}
      </div>
    );
  }

  const tabStyle = (on) => ({
    borderRadius: '50px', padding: '7px 18px', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${C.cta}`, background: on ? C.cta : '#fff', color: on ? '#fff' : C.cta,
  });

  if (view === 'org') {
    return (
      <div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <div onClick={() => setView('list')} style={tabStyle(false)}>{t('팀원 목록')}</div>
          <div onClick={() => setView('org')} style={tabStyle(true)}>{t('조직도')}</div>
        </div>
        <OrgScreen openAi={openAi} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div onClick={() => setView('list')} style={tabStyle(true)}>{t('팀원 목록')}</div>
          <div onClick={() => setView('org')} style={tabStyle(false)}>{t('조직도')}</div>
        </div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: C.t58 }}>가동 중인 팀원 {subs.length}기</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <Btn variant="primary" onClick={() => setHireOpen(true)}>{t('+ 팀원 고용')}</Btn>
          <Btn variant="outline" onClick={openAi}>{t('외부 AI 연동')}</Btn>
        </div>
      </div>
      {/* 팀원이 없을 때 — 빈 화면 대신 채용 안내 */}
      {subs.length === 0 && (
        <section style={card({ padding: '48px 32px', textAlign: 'center' })}>
          <div style={{ display: 'flex', justifyContent: 'center', color: C.cta, marginBottom: '12px' }}>{I.subs(44)}</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: C.heading }}>{t('아직 팀원이 없습니다')}</div>
          <div style={{ fontSize: '13.5px', color: C.t58, marginTop: '8px', lineHeight: 1.7, maxWidth: '440px', margin: '8px auto 0' }}>
            구현·검증 작업은 팀원이 담당합니다. 대표 권한으로 직접 고용하거나,
            팀장에게 작업을 요청하면 팀장이 필요한 팀원의 고용 결재를 올립니다.
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={() => setHireOpen(true)}>{t('+ 첫 팀원 고용하기')}</Btn>
            <Btn variant="outline" onClick={openAi}>{t('외부 AI 연동 (Codex)')}</Btn>
          </div>
        </section>
      )}
      {/* align-items:start — 설정 연 카드만 높이 확장 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: '16px', alignItems: 'start' }}>
        {subs.map(sc => {
          const st = agentStatus(sc.status);
          return (
            <div key={sc.id} style={card({ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={dotStyle(st.dot, 9)} />
                <span style={{ fontSize: '17px', fontWeight: 600, color: C.heading, flex: 1 }}>{sc.name}</span>
                <StatusPill bg={st.bg} color={st.color}>{st.label}</StatusPill>
              </div>
              <div style={{ fontSize: '13.5px', color: C.t58 }}>{sc.role}</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <Chip bg={C.ceramic} color={C.t58} style={{ fontWeight: 600 }}>{modelLabel(sc.model)}</Chip>
                <Chip bg={C.ceramic} color={C.t58} style={{ fontWeight: 600 }}>effort: {sc.effort}</Chip>
                {sc.provider && <Chip bg={C.goldLight} color={C.goldText}>{PROVIDER_LABEL[sc.provider]} 연동</Chip>}
              </div>
              <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: C.heading }}>현재 작업 · </span>{sc.current_task || '대기 중'}
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <Btn variant="primary" small onClick={() => nav('subs', sc.id)}>{t('직접 문의')}</Btn>
                <Btn variant="darkOutline" small onClick={() => setCfgOpenId(cfgOpenId === sc.id ? null : sc.id)}>{t('모델 설정')}</Btn>
                <Btn variant="danger" small style={{ marginLeft: 'auto' }} onClick={() => setDelTarget(sc)}>{t('해고')}</Btn>
              </div>
            </div>
          );
        })}
      </div>

      {cfgOpenId != null && (() => {
        const a = subs.find(x => x.id === cfgOpenId);
        if (!a) return null;
        return (
          <Modal onClose={() => setCfgOpenId(null)} maxWidth="640px">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '15.5px', fontWeight: 700, color: C.heading, whiteSpace: 'nowrap', flexShrink: 0 }}>{a.name}</span>
              <span style={{ fontSize: '12.5px', color: C.t58, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.role}</span>
            </div>
            <CfgPanel agent={a} />
          </Modal>
        );
      })()}
      {hireOpen && <HireModal onClose={() => setHireOpen(false)} />}
      {delTarget && (
        <Modal onClose={() => setDelTarget(null)} maxWidth="440px">
          <div style={{ fontSize: '18px', fontWeight: 600, color: C.danger }}>팀원 해고</div>
          <div style={{ fontSize: '14px', lineHeight: 1.6, marginTop: '12px' }}>"{delTarget.name}" 팀원을 해고할까요?</div>
          <div style={{ fontSize: '13px', lineHeight: 1.55, color: C.t58, marginTop: '6px' }}>진행 중인 작업은 팀장이 회수해 재분배하며, 대화 이력은 보관됩니다.</div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
            <Btn variant="darkOutline" onClick={() => setDelTarget(null)}>{t('취소')}</Btn>
            <Btn variant="black" onClick={doDelete}>{t('해고')}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
