# Deskmate

**Claude Code를 하나의 회사처럼 운영하는 웹 플랫폼.**
대표(당신) → 팀장(메인 에이전트) → 팀원(서브 에이전트) 구조입니다. 채팅으로 지시하면 팀장이 요청을 분석해 팀원에게 위임하고, 결과는 검증을 거쳐 보고서와 산출물로 돌아옵니다.

> English version: [README.en.md](README.en.md)

![데모](docs/screenshots/demo.gif)

## 이 플랫폼의 용도

터미널에서 Claude Code를 1:1로 사용하는 대신, **여러 에이전트를 하나의 조직처럼 운영**하고 싶을 때 사용합니다.

멀티 에이전트 운영에 필요한 세팅(역할 설계·위임 규칙·검증 절차)을 개인이 일일이 구성하기는 번거롭습니다. Deskmate는 **설치 직후 기본값만으로 "팀장에게 지시 → 팀장이 계획을 세워 팀원에게 위임 → 결과 검증 후 보고" 스타일로 동작**하도록 만들어져 있습니다. 팀원 고용, 모델·effort, 방별 스펙 같은 세부 조정은 필요해질 때만 하면 됩니다.

- 개발·문서·디자인 작업을 **역할별 AI 팀원**에게 분담시키고, 팀장이 브리프 작성과 결과 검증을 담당합니다
- 진행 상황은 **티켓 보드·요청(REQ)·보고서**로 추적하고, 중요한 결정은 **결재**로 승인합니다
- 웹 산출물은 화면 위에 **핀을 꽂아 리뷰**하면, 수정 지시가 구조화된 문서로 팀에 전달됩니다
- 브라우저만 있으면 어디서든(모바일 포함) AI 팀에 지시하고 서버의 파일·터미널·Git까지 관리할 수 있습니다

요컨대, **Claude Code 위에 작은 회사를 세우는 도구**입니다.

## 요구사항

| 항목 | 내용 |
|---|---|
| **Node.js** | ≥ 22.5 (내장 SQLite 사용 — 낮으면 안내 후 종료) |
| **Claude Code** | 서버에 **설치 + 로그인 완료**(`claude /login` 또는 `claude setup-token` 토큰) 필수 — 없으면 UI 미리보기(mock)만 동작 |
| **Claude 요금제** | Pro/Max 구독(권장) 또는 Anthropic API 키 |
| 선택 | `git`(Git 메뉴), `codex` CLI(외부 AI 팀원), `tmux`(터미널 세션 영속) |

## 설치

요구사항: **Node.js ≥ 22.5** (낮으면 안내 후 종료), Claude Pro/Max 구독(권장) 또는 Anthropic API 키.
선택 의존성: `git`(Git 메뉴 — 없으면 해당 메뉴만 비활성), `codex` CLI(외부 AI 팀원).

```bash
# GitHub에서 바로 실행 (설치 즉시 기동 — 빌드 불필요)
npx github:asete93/deskmate

# 주요 옵션
npx github:asete93/deskmate \
  --port auto \                     # 남는 포트 자동 할당 (기동 배너에 실제 주소 표시)
  --name myproject \                # 데이터 공간 분리 (~/.claude-control/myproject)
  --allow 192.168.0.0/16 \          # 접근 허용 IP 대역 (미지정 시 전체 허용)
  --https \                         # 자체 서명 인증서로 HTTPS 기동 (클립보드 등 secure 기능)
  --http-port 3201 \                # HTTPS와 HTTP 동시 리슨 (기본: HTTPS포트+1, off=끄기)
  --lang en \                       # 기동 시 시스템 언어 (UI + 에이전트 응답 언어, ko|en)
  --no-terminal --no-files \        # 터미널·파일 기능 완전 비활성 (설정에도 미노출, API 차단)
  --driver sdk                      # mock | sdk | auto
```

인증(실 Claude 구동) — 셋 중 하나:

```bash
# 1) 권장: Claude 구독 장기 토큰
claude setup-token   # 발급 후
CLAUDE_CODE_OAUTH_TOKEN=<토큰> npx github:asete93/deskmate

# 2) 이미 `claude /login` 된 머신이면 그대로 실행 (자동 감지 → sdk 승격)

# 3) API 키
ANTHROPIC_API_KEY=sk-ant-... npx github:asete93/deskmate
```

기동하면 배너에 접속 주소가 출력됩니다:

```
┌──────────────────────────────────────────────────
│  Deskmate · myproject
│  ▶ http://localhost:34357  (bind 0.0.0.0:34357)
└──────────────────────────────────────────────────
```

인증 없이 실행하면 **mock 드라이버**(전 플로우 시뮬레이션)로 떠서 UI를 미리 볼 수 있습니다.

업데이트: 새 커밋 반영이 안 되면 `rm -rf ~/.npm/_npx` 후 재실행하거나, `npm i -g github:asete93/deskmate`로 전역 설치 후 같은 명령으로 재설치하세요. 데이터는 패키지 밖(`~/.claude-control/`)이라 업데이트에 안전합니다.

## 더 알아보기

| 문서 | 내용 |
|---|---|
| [상세 문서](docs/DETAILS.md) | 보안 권고 · macOS/Linux 인증 차이 · 토큰 비용 · 내장 방법론 · 핵심 개념 · 전체 기능 · 스크린샷 · 데이터·아키텍처 |
| [사용자 가이드](docs/USER_GUIDE.md) | 화면별 사용법 (시작–채팅–조직–추적–배포–문제해결) |
| 모바일 앱 | iOS/Android 앱 (같은 서버 연결형) — 별도 저장소, TestFlight 배포 |

> ⚠ **보안 한 줄 요약** — 대시보드 접근 = 서버 명령 실행 권한. 인터넷에 직접 노출하지 말고 내부망/VPN에서 쓰세요. 자세한 구성은 [상세 문서](docs/DETAILS.md) 참조.
