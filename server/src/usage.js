import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Claude 구독 사용량 조회 — CLI가 쓰는 OAuth usage API 활용.
// 공식 사용량 화면과 동일한 항목(현재 세션 / 주간 전체 / 모델별)을 제공한다.
const CACHE_MS = 120_000; // 외부 호출 최대 2분당 1회 — 위젯/탭이 몇 개든 서버가 단일 창구
let cache = null, cacheAt = 0;
let planCache = null;
let lastGood = null;      // 마지막 성공 응답 — 일시 오류(429 등) 동안 대신 반환
let backoffUntil = 0;     // 오류 시 재시도 금지 시각

function loadToken() {
  // usage API는 장기 토큰(setup-token)을 거부한다 — CLI가 갱신하는 세션 토큰을 우선 사용.
  // (모델 호출용 SDK 인증은 별개로 CLAUDE_CODE_OAUTH_TOKEN을 그대로 쓴다)
  try {
    const p = path.join(os.homedir(), '.claude', '.credentials.json');
    const t = JSON.parse(fs.readFileSync(p, 'utf8'))?.claudeAiOauth?.accessToken;
    if (t) return t;
  } catch { /* 파일 없으면 env 폴백 */ }
  return process.env.CLAUDE_CODE_OAUTH_TOKEN || null;
}

async function oauthGet(pathName, token) {
  const res = await fetch(`https://api.anthropic.com${pathName}`, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`usage api ${res.status}`);
  return res.json();
}

const KIND_LABELS = { session: '현재 세션', weekly_all: '주간 · 모든 모델' };

export async function fetchUsage() {
  const nowTs = Date.now();
  if (cache && nowTs - cacheAt < CACHE_MS) return cache;
  // 백오프 중: 재시도하지 않고 마지막 성공값(stale) 반환 — 429 악순환 방지
  if (nowTs < backoffUntil) {
    return lastGood ? { ...lastGood, stale: true } : { plan: '', limits: [], error: 'rate_limited' };
  }
  const token = loadToken();
  if (!token) return { error: 'no_token', plan: '', limits: [] };

  try {
    const usage = await oauthGet('/api/oauth/usage', token);
    if (planCache == null) {
      try {
        const prof = await oauthGet('/api/oauth/profile', token);
        planCache = prof?.account?.has_claude_max ? 'Max' : prof?.account?.has_claude_pro ? 'Pro' : (prof?.organization?.organization_type || '');
      } catch { planCache = ''; }
    }

    const limits = (usage.limits || []).map(l => ({
      kind: l.kind,
      label: l.kind === 'weekly_scoped'
        ? `주간 · ${l.scope?.model?.display_name || l.scope?.surface || '범위'}`
        : (KIND_LABELS[l.kind] || l.kind),
      percent: l.percent ?? null,
      severity: l.severity || 'normal',
      resets_at: l.resets_at || null,
      is_active: !!l.is_active,
    }));

    cache = { plan: planCache, limits };
    cacheAt = nowTs;
    lastGood = cache;
    return cache;
  } catch (e) {
    // 429는 길게, 그 외 오류는 짧게 백오프
    backoffUntil = nowTs + (String(e.message).includes('429') ? 180_000 : 60_000);
    if (lastGood) return { ...lastGood, stale: true };
    return { plan: '', limits: [], error: e.message };
  }
}
