import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 자체 서명(self-signed) TLS 인증서 자동 생성/재사용.
// HTTPS로 뜨면 secure context가 되어 클립보드(붙여넣기) 등 브라우저 보안 기능이 IP 접속에서도 동작한다.
// 자체 서명이라 브라우저가 최초 1회 "신뢰할 수 없음" 경고를 띄우지만, 진행하면 secure context로 취급된다.
export function ensureCert(dataDir) {
  const keyPath = path.join(dataDir, 'tls-key.pem');
  const certPath = path.join(dataDir, 'tls-cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${JSON.stringify(keyPath)} -out ${JSON.stringify(certPath)} ` +
      `-days 3650 -subj "/CN=claude-control" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
      { stdio: 'ignore' },
    );
    console.log('[claude-control] 자체 서명 TLS 인증서 생성:', certPath);
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  } catch (e) {
    console.warn('[claude-control] HTTPS 인증서 생성 실패(openssl 필요):', e.message, '— HTTP로 폴백');
    return null;
  }
}
