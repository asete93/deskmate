#!/usr/bin/env node
// npx claude-control — 한 명령으로 로컬 서비스 기동.
// 데이터는 ~/.claude-control/<이름>/ 에 저장 (실행 위치와 무관하게 유지).
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.findIndex(a => a === `--${name}`);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const eq = args.find(a => a.startsWith(`--${name}=`));
  return eq ? eq.split('=').slice(1).join('=') : def;
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(`claude-control — Claude Code 팀 오케스트레이션 대시보드

사용법:
  npx claude-control [옵션]

옵션:
  --port <n|auto> 포트 (기본 3200, "auto"면 남는 포트 자동 할당 — 기동 후 배너에 표시)
  --name <이름>   서비스 이름 겸 데이터 공간 (기본 "default" → ~/.claude-control/default)
  --data <경로>   데이터 디렉터리 직접 지정 (name보다 우선)
  --driver <m>    mock | sdk | auto (기본 auto)
  --host <addr>   바인딩 주소 (기본 0.0.0.0)
  --allow <cidr>  접근 허용 IP 대역 (쉼표 구분, 예: 192.168.0.0/16,127.0.0.1/32)
                  미지정 시 전체 허용 — 0.0.0.0 공개 바인딩이면 지정 권장
  --https         자체 서명 인증서로 HTTPS 기동 (클립보드 등 secure 기능 활성화, 브라우저 최초 경고 있음)

인증(실 Claude 구동):
  이미 claude /login 된 머신이면 --driver sdk 만 주면 됩니다.
  또는 CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY 환경변수를 설정하세요.
  (권장: claude setup-token 으로 발급한 장기 토큰)`);
  process.exit(0);
}

const name = flag('name', 'default');
const portArg = flag('port', process.env.PORT || '3200');
process.env.PORT = portArg === 'auto' ? '0' : portArg; // 0 = OS가 남는 포트 할당
const allow = flag('allow', process.env.ALLOW_CIDR || '');
if (allow) process.env.ALLOW_CIDR = allow;
if (args.includes('--https')) process.env.HTTPS = '1';
process.env.HOST = flag('host', process.env.HOST || '0.0.0.0');
process.env.AGENT_DRIVER = flag('driver', process.env.AGENT_DRIVER || 'auto');
process.env.SERVICE_NAME = process.env.SERVICE_NAME || `Claude Control · ${name}`;
process.env.DATA_DIR = flag('data', process.env.DATA_DIR || path.join(os.homedir(), '.claude-control', name));

// ambient 로그인(~/.claude) 감지 시 auto → sdk 승격 힌트
if (process.env.AGENT_DRIVER === 'auto' && !process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  const fs = await import('node:fs');
  const creds = path.join(os.homedir(), '.claude', '.credentials.json');
  if (fs.existsSync(creds)) {
    process.env.AGENT_DRIVER = 'sdk';
    console.log('[claude-control] 호스트 Claude 로그인 감지 → sdk 드라이버 사용');
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(__dirname, '../server/src/index.js'));
