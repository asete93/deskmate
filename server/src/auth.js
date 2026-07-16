import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// 단일 계정(비밀번호만) 로그인 게이트.
// - 기본 off. on이면 /api·/uploads·/workspace·WS가 토큰(헤더 x-auth-token 또는 쿠키 cc_auth)을 요구한다.
// - 분실 복구: 서버 데이터 폴더에 `reset-password` 파일을 만들면(서버 쉘 접근 = 소유자 증명)
//   다음 로그인 시도 때 로그인 기능이 해제되고 파일은 삭제된다.
export function createAuth(db, dataDir) {
  const RESET_FILE = path.join(dataDir, 'reset-password');

  const hashPw = (pw) => {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
  };
  const verifyPw = (pw) => {
    const stored = db.getSetting('auth_hash', null);
    if (!stored) return false;
    const [salt, hex] = stored.split(':');
    const calc = crypto.scryptSync(pw, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), Buffer.from(calc, 'hex'));
  };

  const auth = {
    enabled: () => !!db.getSetting('auth_enabled', false),
    hasPassword: () => !!db.getSetting('auth_hash', null),

    // 서버 로컬 파일로 초기화 (분실 복구)
    consumeResetFile() {
      if (!fs.existsSync(RESET_FILE)) return false;
      try { fs.unlinkSync(RESET_FILE); } catch { /* noop */ }
      db.setSetting('auth_enabled', false);
      db.setSetting('auth_hash', null);
      db.setSetting('auth_token', null);
      console.log('[auth] reset-password 파일 감지 — 로그인 기능·비밀번호 초기화');
      return true;
    },

    // ── 브루트포스 방어 ─────────────────────────────────────
    // IP별: 연속 5회 실패 → 15분 잠금 (성공 시 리셋).
    // 전역: 최근 15분 내 실패 50회 초과 → 모든 로그인 15분 차단 (IP 위조/분산 대비 안전망).
    // 실패 응답은 ~700ms 지연 — 초당 시도 횟수 자체를 낮춘다.
    _attempts: new Map(), // ip → { count, lockedUntil }
    _globalFails: [],     // 실패 시각 목록
    _checkLock(ip) {
      const now = Date.now();
      const a = auth._attempts.get(ip);
      if (a?.lockedUntil > now) {
        const min = Math.ceil((a.lockedUntil - now) / 60000);
        throw new Error(`로그인이 잠겼습니다 — 약 ${min}분 후 다시 시도하세요`);
      }
      auth._globalFails = auth._globalFails.filter(ts => now - ts < 15 * 60_000);
      if (auth._globalFails.length >= 50) {
        throw new Error('로그인 시도가 너무 많습니다 — 잠시 후 다시 시도하세요');
      }
    },
    _recordFail(ip) {
      const now = Date.now();
      const a = auth._attempts.get(ip) || { count: 0, lockedUntil: 0 };
      a.count += 1;
      if (a.count >= 5) { a.lockedUntil = now + 15 * 60_000; a.count = 0; }
      auth._attempts.set(ip, a);
      auth._globalFails.push(now);
    },

    async login(password, ip = 'unknown') {
      if (auth.consumeResetFile()) return { reset: true };
      auth._checkLock(ip);
      if (!verifyPw(String(password || ''))) {
        auth._recordFail(ip);
        await new Promise(r => setTimeout(r, 700)); // 시도 속도 제한
        return null;
      }
      auth._attempts.delete(ip);
      let token = db.getSetting('auth_token', null);
      if (!token) {
        token = crypto.randomBytes(24).toString('hex');
        db.setSetting('auth_token', token);
      }
      return { token };
    },

    // {enabled, password?} — 켤 때 비밀번호가 없으면 password 필수
    setConfig({ enabled, password }) {
      if (enabled) {
        if (password) db.setSetting('auth_hash', hashPw(String(password)));
        if (!auth.hasPassword()) throw new Error('비밀번호를 먼저 설정하세요');
        db.setSetting('auth_enabled', true);
        // 새 토큰 발급 — 설정한 브라우저는 응답 토큰으로 즉시 인증 유지
        const token = crypto.randomBytes(24).toString('hex');
        db.setSetting('auth_token', token);
        return { token };
      }
      db.setSetting('auth_enabled', false);
      return {};
    },

    isAuthed(req) {
      if (!auth.enabled()) return true;
      const token = db.getSetting('auth_token', null);
      if (!token) return false;
      if (req.headers['x-auth-token'] === token) return true;
      const cookie = req.headers.cookie || '';
      const m = cookie.match(/(?:^|;\s*)cc_auth=([^;]+)/);
      if (m && m[1] === token) return true;
      // WS 등 쿼리 토큰 허용
      try {
        const u = new URL(req.url, 'http://x');
        if (u.searchParams.get('token') === token) return true;
      } catch { /* noop */ }
      return false;
    },

    cookieFor(token) {
      return `cc_auth=${token}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    },
  };
  return auth;
}
