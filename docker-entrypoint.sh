#!/bin/sh
set -e
# 구독 자격(~/.claude)이 읽기전용으로 /host-claude에 마운트된 경우,
# 쓰기가능한 컨테이너 홈으로 복사한다. SDK/CLI가 debug·로그·토큰갱신을
# 자기 홈에 기록해야 하므로 읽기전용 마운트를 직접 쓰면 EROFS로 크래시한다.
# 인스턴스별 독립 복사본 → 다중 컨테이너 공유쓰기 손상도 방지.
if [ -d /host-claude ]; then
  mkdir -p /root/.claude
  cp -a /host-claude/. /root/.claude/ 2>/dev/null || true
  chmod -R u+rw /root/.claude 2>/dev/null || true
fi
exec "$@"
