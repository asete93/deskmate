import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { store, showToast } from '../store.js';
import { api, getServices, saveServices, currentBase, setCurrentBase } from '../api.js';
import { useEffect } from 'preact/hooks';
import { C, card, label12, Btn, Chip, Input, dotStyle, Modal, SegPill, fmtDateTime } from '../ui.jsx';
import { t, isEn } from '../i18n.js';

// 예약 작업 — 지정 시각/주기에 팀장(또는 특정 팀원)에게 요청을 자동 전송
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function SchedulesCard() {
  const [list, setList] = useState([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [target, setTarget] = useState('main');
  const [repeat, setRepeat] = useState('daily');
  const [atTime, setAtTime] = useState('09:00');
  const [weekday, setWeekday] = useState(1);
  const [runAt, setRunAt] = useState('');

  const load = () => api.get('/schedules').then(setList).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  const add = async () => {
    if (!title.trim() || !text.trim()) { showToast('제목과 요청 내용을 입력하세요.'); return; }
    const body = { title: title.trim(), text: text.trim(), target, repeat, at_time: atTime, weekday };
    if (repeat === 'once') {
      if (!runAt) { showToast('실행 일시를 선택하세요.'); return; }
      body.run_at = new Date(runAt).getTime();
    }
    try {
      await api.post('/schedules', body);
      setTitle(''); setText(''); showToast('예약 작업이 등록되었습니다.'); load();
    } catch (e) { showToast(e.message); }
  };

  const lbl = { fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' };
  const repeatLabel = (s) => s.repeat === 'once'
    ? `1회 · ${fmtDateTime(s.run_at)}`
    : s.repeat === 'daily' ? `매일 ${s.at_time}` : `매주 ${WEEKDAYS[s.weekday ?? 1]} ${s.at_time}`;
  const targetName = (t) => t === 'main'
    ? (store.agents.find(a => a.kind === 'main')?.name || '팀장')
    : (store.agents.find(a => String(a.id) === String(t).split(':')[1])?.name || '(삭제된 팀원)');

  return (
    <section style={card({ padding: '24px' })}>
      <div style={label12}>예약 작업</div>
      <div style={{ fontSize: '13px', color: C.t58, marginTop: '4px' }}>지정한 시각·주기에 요청을 자동으로 전송합니다. 실행 결과는 팀 채팅에 기록됩니다.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
        {list.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', border: `1px solid ${C.line}`, borderRadius: '8px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>{s.title}</div>
              <div style={{ fontSize: '12px', color: C.t58, marginTop: '2px' }}>
                {repeatLabel(s)} · 대상 {targetName(s.target)}
                {s.enabled && s.next_run_ts ? ` · 다음 실행 ${fmtDateTime(s.next_run_ts)}` : ''}
                {s.last_run_ts ? ` · 마지막 ${fmtDateTime(s.last_run_ts)}` : ''}
              </div>
            </div>
            <div onClick={() => api.post(`/schedules/${s.id}/toggle`).then(load).catch(e => showToast(e.message))}
              style={{ width: '40px', height: '22px', borderRadius: '50px', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s ease', background: s.enabled ? C.cta : C.border }}>
              <span style={{ position: 'absolute', top: '2px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.24)', transition: 'all 0.2s ease', left: s.enabled ? '20px' : '2px' }} />
            </div>
            <Btn variant="darkOutline" small onClick={() => api.del(`/schedules/${s.id}`).then(load).catch(e => showToast(e.message))}>삭제</Btn>
          </div>
        ))}
        {list.length === 0 && <div style={{ fontSize: '13px', color: C.t58 }}>등록된 예약 작업이 없습니다.</div>}
      </div>

      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: '16px', paddingTop: '16px' }}>
        <div style={lbl}>새 예약 작업</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Input value={title} onInput={e => setTitle(e.target.value)} placeholder="제목 (예: 아침 진행 보고)" style={{ flex: 1, minWidth: '180px', width: 'auto' }} />
        </div>
        <textarea value={text} onInput={e => setText(e.target.value)} rows={2} placeholder="요청 내용 (예: 어제까지의 진행 상황을 요약해 보고해줘)"
          style={{ width: '100%', marginTop: '8px', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 12px', fontSize: '13.5px', lineHeight: 1.5, outlineColor: C.cta, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '10px', alignItems: 'flex-end' }}>
          <div>
            <div style={lbl}>대상</div>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <SegPill small active={target === 'main'} onClick={() => setTarget('main')}>{targetName('main')}</SegPill>
              {store.agents.filter(a => a.kind === 'sub').map(a => (
                <SegPill key={a.id} small active={target === `sub:${a.id}`} onClick={() => setTarget(`sub:${a.id}`)}>{a.name}</SegPill>
              ))}
            </div>
          </div>
          <div>
            <div style={lbl}>반복</div>
            <div style={{ display: 'flex', gap: '5px' }}>
              {[['once', '1회'], ['daily', '매일'], ['weekly', '매주']].map(([k, l]) => (
                <SegPill key={k} small active={repeat === k} onClick={() => setRepeat(k)}>{l}</SegPill>
              ))}
            </div>
          </div>
          {repeat === 'weekly' && (
            <div>
              <div style={lbl}>요일</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {WEEKDAYS.map((w, i) => <SegPill key={i} small active={weekday === i} onClick={() => setWeekday(i)}>{w}</SegPill>)}
              </div>
            </div>
          )}
          {repeat === 'once' ? (
            <div>
              <div style={lbl}>실행 일시</div>
              <input type="datetime-local" value={runAt} onInput={e => setRunAt(e.target.value)}
                style={{ border: `1px solid ${C.border}`, borderRadius: '4px', padding: '8px 10px', fontSize: '13px', outlineColor: C.cta }} />
            </div>
          ) : (
            <div>
              <div style={lbl}>시간</div>
              <input type="time" value={atTime} onInput={e => setAtTime(e.target.value)}
                style={{ border: `1px solid ${C.border}`, borderRadius: '4px', padding: '8px 10px', fontSize: '13px', outlineColor: C.cta }} />
            </div>
          )}
          <Btn variant="primary" onClick={add}>등록</Btn>
        </div>
      </div>
    </section>
  );
}

// 로그인 기능 — 단일 계정(비밀번호만). on 전환 시 비밀번호 미설정이면 설정 입력이 먼저 열린다.
function SecurityCard() {
  const [setup, setSetup] = useState(false); // 비밀번호 설정 입력 표시
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const a = store.auth || {};
  const toggle = async () => {
    if (a.enabled) {
      if (!confirm(t('로그인 기능을 끌까요? 누구나 접속할 수 있게 됩니다.'))) return;
      try { await api.post('/auth/config', { enabled: false }); } catch (e) { showToast(e.message); }
      return;
    }
    if (!a.has_password) { setSetup(true); return; } // 비밀번호부터 설정
    try { await api.post('/auth/config', { enabled: true }); } catch (e) { showToast(e.message); }
  };
  const savePw = async () => {
    if (pw.length < 4) { showToast(t('비밀번호는 4자 이상이어야 합니다')); return; }
    if (pw !== pw2) { showToast(t('비밀번호가 서로 다릅니다')); return; }
    try {
      const r = await api.post('/auth/config', { enabled: true, password: pw });
      if (r.token) localStorage.setItem('cc_auth_token', r.token);
      setSetup(false); setPw(''); setPw2('');
    } catch (e) { showToast(e.message); }
  };
  return (
    <section style={card({ padding: '24px' })}>
      <div style={label12}>{t('로그인')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>{t('비밀번호 로그인')}</div>
          <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '2px' }}>
            {t('켜면 대시보드·API·파일 접근에 비밀번호가 필요합니다 (단일 계정, ID 없음).')}
          </div>
        </div>
        <div onClick={toggle}
          style={{ width: '40px', height: '22px', borderRadius: '50px', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s ease', background: a.enabled ? C.cta : C.border }}>
          <span style={{ position: 'absolute', top: '2px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.24)', transition: 'all 0.2s ease', left: a.enabled ? '20px' : '2px' }} />
        </div>
      </div>
      {setup && !a.enabled && (
        <div style={{ marginTop: '14px', background: '#f9f9f9', borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: C.heading, marginBottom: '10px' }}>{t('비밀번호 설정 — 설정 후 로그인이 켜집니다')}</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Input type="password" value={pw} onInput={e => setPw(e.target.value)} placeholder={t('새 비밀번호')} style={{ flex: 1, minWidth: '160px', width: 'auto' }} />
            <Input type="password" value={pw2} onInput={e => setPw2(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') savePw(); }} placeholder={t('비밀번호 확인')} style={{ flex: 1, minWidth: '160px', width: 'auto' }} />
            <Btn variant="primary" onClick={savePw}>{t('설정하고 켜기')}</Btn>
            <Btn variant="darkOutline" onClick={() => setSetup(false)}>{t('취소')}</Btn>
          </div>
        </div>
      )}
      <div style={{ fontSize: '11.5px', color: C.t58, marginTop: '12px', lineHeight: 1.6 }}>
        {t('비밀번호 분실 시: 서버의 데이터 폴더에 reset-password 파일을 만들면 다음 로그인 시도 때 초기화됩니다.')}
        {' '}<code style={{ background: C.ceramic, borderRadius: '4px', padding: '1px 6px', fontSize: '11px' }}>touch ~/.claude-control/default/reset-password</code>
      </div>
    </section>
  );
}

export function SettingsScreen() {
  const [, bump] = useState(0);
  const [newSvc, setNewSvc] = useState('');
  const [editUrl, setEditUrl] = useState(null);   // 이름 편집 중인 서비스 URL
  const [nameDraft, setNameDraft] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const services = getServices();

  const doReset = async () => {
    try {
      await api.post('/reset', { confirm: 'RESET' });
      showToast('전체 데이터가 초기화되었습니다.');
      setTimeout(() => location.reload(), 800);
    } catch (e) { showToast(e.message); }
  };

  const addService = async () => {
    let url;
    try { url = new URL(newSvc.trim()).origin; } catch { showToast('올바른 URL을 입력하세요.'); return; }
    if (services.some(s => s.url === url)) { showToast('이미 등록된 서비스입니다.'); return; }
    let name = 'Claude Control';
    try {
      const info = await (await fetch(url + '/api/service-info')).json();
      name = info.name || name;
    } catch { showToast('서비스에 연결할 수 없습니다 — URL을 확인하세요.'); return; }
    const port = new URL(url).port || '80';
    services.push({ url, name: `${name} · :${port}` });
    saveServices(services);
    setNewSvc('');
    showToast('서비스가 등록되었습니다.');
    bump(x => x + 1);
  };

  const removeService = (url) => {
    if (url === currentBase()) { showToast('현재 연결 중인 서비스는 해제할 수 없습니다.'); return; }
    saveServices(services.filter(s => s.url !== url));
    showToast('서비스 연결이 해제되었습니다.');
    bump(x => x + 1);
  };

  const switchService = (url) => { setCurrentBase(url); location.reload(); };

  const saveName = (url) => {
    const nm = nameDraft.trim();
    if (!nm) { showToast('이름을 입력하세요.'); return; }
    saveServices(services.map(s => s.url === url ? { ...s, name: nm } : s));
    setEditUrl(null);
    showToast('서비스 이름이 변경되었습니다.');
    bump(x => x + 1);
  };

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 서비스 연결 */}
      <section style={card({ padding: '24px' })}>
        <div style={label12}>서비스 연결</div>
        <div style={{ fontSize: '13px', color: C.t58, marginTop: '4px' }}>동일한 Claude Control 서비스를 연결하고 사이드 패널 상단에서 전환할 수 있습니다.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
          {services.map(sv => {
            const isCur = sv.url === currentBase();
            return (
              <div key={sv.url} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', border: `1px solid ${C.line}`, borderRadius: '8px', flexWrap: 'wrap' }}>
                <span style={dotStyle(isCur ? C.cta : C.border, 8)} />
                <div style={{ flex: 1, minWidth: '160px' }}>
                  {editUrl === sv.url ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input value={nameDraft} onInput={e => setNameDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveName(sv.url); }}
                        style={{ flex: 1, minWidth: 0, border: `1px solid ${C.cta}`, borderRadius: '4px', padding: '6px 10px', fontSize: '13.5px', outline: 'none' }} autoFocus />
                      <Btn variant="primary" small onClick={() => saveName(sv.url)}>저장</Btn>
                      <Btn variant="darkOutline" small onClick={() => setEditUrl(null)}>취소</Btn>
                    </div>
                  ) : (
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{sv.name}</div>
                  )}
                  <div style={{ fontSize: '12.5px', color: C.t58 }}>{sv.url}</div>
                </div>
                {editUrl !== sv.url && (
                  <Btn variant="darkOutline" small onClick={() => { setEditUrl(sv.url); setNameDraft(sv.name); }}>이름 변경</Btn>
                )}
                {isCur ? (
                  <Chip bg={C.mint} color={C.heading} style={{ fontSize: '12px', padding: '4px 12px' }}>현재 연결됨</Chip>
                ) : (
                  <>
                    <Btn variant="outline" small onClick={() => switchService(sv.url)}>이 서비스로 전환</Btn>
                    <Btn variant="darkOutline" small onClick={() => removeService(sv.url)}>해제</Btn>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
          <Input value={newSvc} onInput={e => setNewSvc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addService(); }}
            placeholder="http://localhost:3201" style={{ flex: 1, minWidth: '200px', width: 'auto' }} />
          <Btn variant="primary" onClick={addService}>연결</Btn>
        </div>
      </section>

      {/* 언어 — UI + 에이전트 동작 언어 (지침·응답 언어까지 전환) */}
      <section style={card({ padding: '24px' })}>
        <div style={label12}>{t('언어 / Language')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <div style={{ fontSize: '12.5px', color: C.t58 }}>{t('사이트 표시 언어와 팀(에이전트)의 동작·보고 언어가 함께 전환됩니다.')}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[['ko', '한국어'], ['en', 'English']].map(([code, label]) => (
              <SegPill key={code} active={store.lang === code}
                onClick={() => { if (store.lang !== code) api.post('/lang', { lang: code }).catch(e => showToast(e.message)); }}>
                {label}
              </SegPill>
            ))}
          </div>
        </div>
      </section>

      {/* 로그인 (단일 계정 — 비밀번호만). 기본 off */}
      <SecurityCard />

      <SchedulesCard />

      {/* 메뉴 표시 */}
      <section style={card({ padding: '24px' })}>
        <div style={label12}>메뉴 표시</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Git 메뉴</div>
            <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '2px' }}>끄면 사이드패널에서만 숨겨지고, Git 연동·커밋 기록 등 실제 동작은 그대로 유지됩니다.</div>
          </div>
          <div onClick={() => api.post('/settings/git-menu', { show: !store.show_git_menu }).catch(e => showToast(e.message))}
            style={{ width: '40px', height: '22px', borderRadius: '50px', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s ease', background: store.show_git_menu ? C.cta : C.border }}>
            <span style={{ position: 'absolute', top: '2px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.24)', transition: 'all 0.2s ease', left: store.show_git_menu ? '20px' : '2px' }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap', borderTop: `1px solid ${C.line}`, paddingTop: '16px' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>{t('터미널')}</div>
            <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '2px' }}>{t('서버 셸에 접근하는 웹 터미널. 끄면 메뉴·기능·연결이 모두 차단됩니다.')}</div>
          </div>
          <div onClick={() => api.post('/settings/terminal', { enabled: !store.terminal_enabled }).catch(e => showToast(e.message))}
            style={{ width: '40px', height: '22px', borderRadius: '50px', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s ease', background: store.terminal_enabled ? C.cta : C.border }}>
            <span style={{ position: 'absolute', top: '2px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.24)', transition: 'all 0.2s ease', left: store.terminal_enabled ? '20px' : '2px' }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap', borderTop: `1px solid ${C.line}`, paddingTop: '16px' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>{t('파일')}</div>
            <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '2px' }}>{t('워크스페이스 파일 탐색기·에디터. 끄면 메뉴·파일 API가 모두 차단됩니다.')}</div>
          </div>
          <div onClick={() => api.post('/settings/files', { enabled: !store.files_enabled }).catch(e => showToast(e.message))}
            style={{ width: '40px', height: '22px', borderRadius: '50px', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s ease', background: store.files_enabled ? C.cta : C.border }}>
            <span style={{ position: 'absolute', top: '2px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.24)', transition: 'all 0.2s ease', left: store.files_enabled ? '20px' : '2px' }} />
          </div>
        </div>
      </section>

      {/* 위험 구역 — 기억/데이터 초기화 */}
      <section style={card({ padding: '24px', border: '1px solid rgba(200,32,20,0.35)' })}>
        <div style={{ ...label12, color: C.danger }}>위험 구역</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>{t('전체 기억 초기화')}</div>
            <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '2px' }}>
              {t('팀장(모든 방)·팀원 전원의 세션 기억만 리셋합니다. 대화 기록·티켓·결재·워크스페이스 파일은 유지되고, 대기 중인 질문 카드는 취소됩니다.')}
            </div>
          </div>
          <Btn variant="danger" onClick={() => {
            if (confirm(isEn()
              ? 'Reset ALL agent memory?\nChat history/tickets/files are kept; every Team Lead room session and all member sessions start fresh.'
              : '팀장·팀원의 기억을 모두 초기화할까요?\n대화 기록·티켓·파일은 유지되지만, 모든 세션이 백지에서 다시 시작합니다.')) {
              api.post('/reset-memory').catch(e => showToast(e.message));
            }
          }}>{t('기억 초기화')}</Btn>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap', borderTop: `1px solid ${C.line}`, paddingTop: '16px' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>전체 데이터 초기화</div>
            <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '2px' }}>
              대화·요청·티켓·승인·타임라인·팀원 구성·워크스페이스(Git 포함)를 모두 삭제하고 처음 상태로 되돌립니다.
            </div>
          </div>
          <Btn variant="danger" onClick={() => { setResetText(''); setResetOpen(true); }}>초기화</Btn>
        </div>
      </section>

      {resetOpen && (
        <Modal onClose={() => setResetOpen(false)} maxWidth="460px">
          <div style={{ fontSize: '18px', fontWeight: 600, color: C.danger }}>전체 데이터 초기화</div>
          <div style={{ fontSize: '14px', lineHeight: 1.6, marginTop: '12px' }}>
            이 서비스({store.service.name})의 모든 데이터가 삭제됩니다:
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: '13.5px', lineHeight: 1.7, color: C.t58 }}>
            <li>대화 이력 · 요청 로그 · 산출 보고서</li>
            <li>티켓 · 승인 이력 · 타임라인</li>
            <li>팀원 구성 · 목표 · 설정</li>
            <li>워크스페이스 파일과 Git 이력 전체</li>
          </ul>
          <div style={{ fontSize: '13px', color: C.danger, fontWeight: 600, marginTop: '10px' }}>복구할 수 없습니다.</div>
          <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '14px', marginBottom: '6px' }}>계속하려면 <b>초기화</b>라고 입력하세요.</div>
          <Input value={resetText} onInput={e => setResetText(e.target.value)} placeholder="초기화" />
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '18px' }}>
            <Btn variant="darkOutline" onClick={() => setResetOpen(false)}>취소</Btn>
            <Btn variant="black" style={{ background: C.danger }} onClick={() => { if (resetText.trim() === '초기화') { setResetOpen(false); doReset(); } else showToast('"초기화"를 정확히 입력해주세요.'); }}>영구 삭제</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
