#!/usr/bin/env node
// 서버 로컬 전용 비밀번호 관리 CLI — 웹에 노출되지 않는다 (셸 접근 = 소유자 증명).
//
//   node bin/passwd.js               새 비밀번호 설정 (숨김 입력, 로그인 자동 활성화)
//   node bin/passwd.js --off         로그인 기능 끄기
//   node bin/passwd.js --status      현재 상태 확인
//   echo '비번' | node bin/passwd.js   비대화(스크립트) 설정 — 1줄이면 확인 생략
//   DATA_DIR=... 로 다른 인스턴스 지정 (기본: ~/.claude-control/default)
//
// 변경 즉시 기존 로그인 세션(토큰·쿠키)은 전부 무효화된다. 서버 재시작 불필요.
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.claude-control', 'default');
const db = new DatabaseSync(path.join(DATA_DIR, 'control.db'));
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? JSON.parse(r.value) : null; };
const set = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));

const arg = process.argv[2];

if (arg === '--status') {
  console.log(`로그인: ${get('auth_enabled') ? 'ON' : 'OFF'} · 비밀번호: ${get('auth_hash') ? '설정됨' : '없음'} · 데이터: ${DATA_DIR}`);
  process.exit(0);
}
if (arg === '--off') {
  set('auth_enabled', false);
  set('auth_token', null); // 기존 세션 전부 로그아웃
  console.log('로그인 기능 OFF (비밀번호 해시는 유지 — 다시 켜려면 새 비밀번호 설정)');
  process.exit(0);
}

function readLineOnce() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.once('line', (l) => { resolve(l); rl.close(); });
    rl.once('close', () => resolve(null));
  });
}
async function askHidden(promptText) {
  if (!process.stdin.isTTY) return readLineOnce(); // 파이프 입력 (스크립트용)
  process.stdout.write(promptText);
  execSync('stty -echo', { stdio: ['inherit', 'ignore', 'ignore'] });
  const answer = await readLineOnce();
  execSync('stty echo', { stdio: ['inherit', 'ignore', 'ignore'] });
  process.stdout.write('\n');
  return answer;
}

const interactive = process.stdin.isTTY;
const pw = await askHidden('새 비밀번호 (8자 이상): ');
if (!pw || pw.length < 8) { console.error('8자 이상이어야 합니다.'); process.exit(1); }
if (interactive) {
  const pw2 = await askHidden('다시 입력: ');
  if (pw !== pw2) { console.error('불일치 — 변경 취소.'); process.exit(1); }
}

// server/src/auth.js hashPw와 동일 포맷: `${salt}:${scrypt(pw, salt, 32) hex}`
const salt = crypto.randomBytes(16).toString('hex');
set('auth_hash', `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`);
set('auth_enabled', true);
set('auth_token', null); // 기존 웹 쿠키·앱 토큰 전부 무효화 — 새 비밀번호로 재로그인
console.log('완료 — 로그인 ON, 비밀번호 변경됨. 모든 기기에서 재로그인 필요.');
