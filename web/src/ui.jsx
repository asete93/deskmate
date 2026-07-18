import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { store } from './store.js';

// ---- Green Apron 토큰 ----
export const C = {
  heading: '#006241', cta: '#00754a', dark: '#1e3932', sub: '#2b5148',
  gold: '#cba258', goldText: '#8a6a2f', goldLight: '#faf6ee', goldBorder: '#dfc49d',
  mint: '#d4e9e2', ceramic: '#edebe9', cream: '#f2f0eb', danger: '#c82014',
  line: '#e7e7e7', border: '#d6dbde',
  t87: 'rgba(0,0,0,0.87)', t58: 'rgba(0,0,0,0.58)',
  cardShadow: '0 0 0.5px rgba(0,0,0,0.14), 0 1px 1px rgba(0,0,0,0.24)',
  popShadow: '0 1px 3px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.14)',
};

export const card = (extra = {}) => ({ background: '#fff', borderRadius: '12px', boxShadow: C.cardShadow, ...extra });
export const label11 = { fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58 };
export const label12 = { fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58 };

// ---- 상태/칩 매핑 ----
export const AGENT_STATUS = {
  working: { label: '작업 중', dot: C.cta, bg: C.mint, color: C.heading },
  idle: { label: '대기', dot: C.border, bg: C.ceramic, color: C.t58 },
  waiting: { label: '응답 대기', dot: C.gold, bg: C.goldLight, color: C.goldText },
};
export const agentStatus = (s) => AGENT_STATUS[s] || AGENT_STATUS.idle;

export function actorChip(name) {
  if (name === 'User') return { bg: C.goldLight, color: C.goldText };
  if (name === 'Main' || name === '팀장') return { bg: C.dark, color: '#fff' };
  return { bg: C.ceramic, color: C.sub };
}
export const actorLabel = (name) => (name === 'Main' ? '팀장' : name);

export const PRIO = {
  P0: { bg: 'rgba(200,32,20,0.10)', color: C.danger },
  P1: { bg: C.goldLight, color: C.goldText },
  P2: { bg: C.ceramic, color: C.t58 },
  P3: { bg: C.ceramic, color: C.t58 },
};
export const TICKET_STATUS = {
  backlog: { label: 'Backlog', bg: C.ceramic, color: C.t58 },
  in_progress: { label: 'In Progress', bg: C.mint, color: C.heading },
  review: { label: 'Review', bg: C.goldLight, color: C.goldText },
  done: { label: 'Done', bg: C.mint, color: C.heading },
};
export const REQ_STATUS = {
  active: { label: '진행 중', bg: C.ceramic, color: C.t58 },
  review: { label: '검토 대기', bg: C.goldLight, color: C.goldText },
  approval: { label: '결재 대기', bg: C.goldLight, color: C.goldText },
  done: { label: '완료', bg: C.mint, color: C.heading },
};

// 모델 목록은 서버가 SDK supportedModels()로 조회 (store.models). 아래는 미로딩 시 폴백.
const MODEL_LABEL_FALLBACK = {
  opus: 'Opus (최고성능)', sonnet: 'Sonnet (균형)', haiku: 'Haiku (경량)',
  'opus-4.5': 'Opus', 'sonnet-4.5': 'Sonnet', 'haiku-4.5': 'Haiku', // 구 DB 값 하위호환
};
export function modelOptions() {
  return store.models.length
    ? store.models
    : Object.entries(MODEL_LABEL_FALLBACK).slice(0, 3).map(([value, label]) => ({ value, label, desc: '' }));
}
export const modelLabel = (m) => store.models.find(x => x.value === m)?.label || MODEL_LABEL_FALLBACK[m] || m;
// EFFORT 5단계 (SDK 정식) — 모델별 지원 목록은 effortOptions(model)로 조회
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export function effortOptions(model) {
  const info = store.models.find(x => x.value === model);
  return info?.efforts?.length ? info.efforts : EFFORTS.slice(0, 3);
}

// 외부 AI(provider)별 모델·effort — openai는 Codex CLI 실연동
export const PROVIDER_MODELS = {
  // 이 서버의 Codex CLI(ChatGPT 계정) 기준 실지원 모델 — 계정/버전에 따라 달라질 수 있음
  openai: [
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  ],
};
export const PROVIDER_EFFORTS = {
  openai: ['minimal', 'low', 'medium', 'high', 'xhigh'],
};
export function providerModelOptions(provider) { return PROVIDER_MODELS[provider] || []; }
export function providerEffortOptions(provider) { return PROVIDER_EFFORTS[provider] || ['low', 'medium', 'high']; }

export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(ts)}`;
}

// ---- 공통 컴포넌트 ----
// 50px pill 버튼, press scale(0.95)
export function Btn({ variant = 'primary', onClick, children, style = {}, small }) {
  const [press, setPress] = useState(false);
  const base = {
    borderRadius: '50px', border: 'none', cursor: 'pointer',
    fontSize: small ? '12.5px' : '13.5px', fontWeight: 600,
    padding: small ? '6px 14px' : '9px 20px',
    transition: 'all 0.2s ease', whiteSpace: 'nowrap',
    transform: press ? 'scale(0.95)' : 'none',
  };
  const variants = {
    primary: { background: C.cta, color: '#fff' },
    outline: { background: '#fff', color: C.cta, border: `1px solid ${C.cta}` },
    darkOutline: { background: '#fff', color: C.dark, border: `1px solid ${C.border}` },
    black: { background: C.dark, color: '#fff' },
    danger: { background: '#fff', color: C.danger, border: '1px solid rgba(200,32,20,0.4)' },
  };
  return h('button', {
    style: { ...base, ...variants[variant], ...style },
    onClick,
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    onMouseLeave: () => setPress(false),
  }, children);
}

// 세그먼트 선택 필 (MODE/MODEL/EFFORT 등)
export function SegPill({ active, onClick, children, small }) {
  return (
    <div onClick={onClick} style={{
      borderRadius: '50px', padding: small ? '5px 12px' : '6px 14px',
      fontSize: small ? '12px' : '13px', fontWeight: 600, cursor: 'pointer',
      transition: 'all 0.2s ease', display: 'inline-block',
      border: `1px solid ${active ? C.cta : C.border}`,
      background: active ? C.cta : '#fff', color: active ? '#fff' : C.t58,
    }}>{children}</div>
  );
}

export function Chip({ bg, color, children, style = {} }) {
  return <span style={{ fontSize: '11.5px', fontWeight: 700, borderRadius: '50px', padding: '2px 9px', whiteSpace: 'nowrap', background: bg, color, ...style }}>{children}</span>;
}

export function StatusPill({ bg, color, children }) {
  return <span style={{ fontSize: '12px', fontWeight: 600, borderRadius: '50px', padding: '3px 10px', whiteSpace: 'nowrap', background: bg, color }}>{children}</span>;
}

export function Modal({ onClose, children, maxWidth = '560px' }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, padding: '28px', width: '100%', maxWidth, maxHeight: '86vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

export function Input(props) {
  return h('input', {
    ...props,
    style: {
      width: props.width || '100%', border: `1px solid ${C.border}`, borderRadius: '4px',
      padding: '11px 12px', fontSize: '14px', outlineColor: C.cta, ...props.style,
    },
  });
}

// 텍스트 내 URL을 하이퍼링크로 (새 창) — light: 진한 배경(그린 버블)용 색상
const URL_SPLIT_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
export function Linkify({ text, light = false }) {
  const parts = String(text ?? '').split(URL_SPLIT_RE);
  if (parts.length === 1) return text;
  return h(Fragment, null, parts.map((p, i) => (i % 2
    ? h('a', {
        key: i, href: p, target: '_blank', rel: 'noreferrer',
        style: { color: light ? '#d4e9e2' : C.cta, textDecoration: 'underline', wordBreak: 'break-all' },
      }, p)
    : p)));
}

// 즉시 피드백용 미니 스피너 — 클릭 후 서버 반영까지의 공백을 메운다
export function Spin({ size = 12, color = '#00754a', track = 'rgba(0,0,0,0.15)' }) {
  return h('span', { style: { width: `${size}px`, height: `${size}px`, border: `2px solid ${track}`, borderTopColor: color, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin 0.7s linear infinite', verticalAlign: '-2px' } });
}

export const dotStyle = (color, size = 8, pulse = false) => ({
  width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: color,
  flexShrink: 0, display: 'inline-block',
  ...(pulse ? { animation: 'ga-pulse 1.6s ease infinite' } : {}),
});
