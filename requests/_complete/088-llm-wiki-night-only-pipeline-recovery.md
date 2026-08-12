# 088 LLM Wiki night-only 자동 파이프라인 회귀 수정

## 상태

- 완료 (2026-08-08, Dev·Production)

## 목표

- Phase2 후보를 C1 완료 사용자와 미수집 eligible source 보유 사용자의 UNION으로 구성한다.
- night-only 사용자의 collection_1 completed(0) marker를 멱등 생성한다.
- collection_2 완료 후 Correction → Memory → Report가 자동 진행되게 한다.
- cron 누락·일시 실패를 poll/reconciliation이 중복 없이 자동 복구한다.
- 새 forward migration으로 Dev targeted QA 후 Production 적용, 최근 7일 누락만 안전 복구한다.
- 기존 completed 데이터 삭제·재생성·전체 초기화·중복 LLM 호출을 금지한다.

## 완료 결과

- main `4ecc223`, Production 배포 READY 및 `app.k-bestie.com` 반영.
- forward migration 4건 Dev·Production 적용.
- Dev DB 목표 시나리오 7/7, 단위 2/2, tsc, 206페이지 build PASS.
- Production 최근 7개 완료일 누락 복구 후 affected 0.
- pipeline job/raw/corrected/memory fact/evidence/embedding/daily report 중복 모두 0.
- 2026-08-07 윤도건 C1 completed(0)/C2 completed(24), 윤도원 C1 completed(0)/C2 completed(23), 안서아·안서현 포함 Raw/Correction/Memory/Report completed.
- 매일 00:10 KST 자동 reconciliation과 cron/worker 인증 smoke PASS, 수동 조치 0.
- 김비서 Discord `sent` 확인.
