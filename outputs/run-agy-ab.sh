#!/usr/bin/env bash
# agy A/B안 위임 실행 스크립트 (tmux가 PowerShell 기본셸이라 bash 명시 실행)
export PATH="/c/Users/Home/AppData/Local/agy/bin:/usr/bin:/mingw64/bin:$PATH"
cd /e/VibeCoding/K-Bestie-v3 || exit 1
timeout 1800 agy --dangerously-skip-permissions \
  --add-dir 'E:/VibeCoding/K-Bestie-v3' \
  --model='Gemini 3.1 Pro (High)' \
  -p 'E:/VibeCoding/K-Bestie-v3/outputs/agy-brief-ab.md 파일을 먼저 읽고, 그 지시문을 정확히 수행하라. 지시문의 대상 파일 목록 외 파일은 절대 수정하지 마라. 완료 전 셀프검증 게이트(tsc, build)를 직접 실행하고, 마지막에 지시문의 보고 형식으로 결과를 출력하라.' \
  2>&1 | tee /e/VibeCoding/K-Bestie-v3/outputs/agy-ab-live.log
echo "AGY_EXIT=$?" >> /e/VibeCoding/K-Bestie-v3/outputs/agy-ab-live.log
