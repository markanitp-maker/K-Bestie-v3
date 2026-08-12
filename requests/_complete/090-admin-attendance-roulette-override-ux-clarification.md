# Request: 관리자 출석 룰렛 Override UX 명확화 — 예약값과 현재 보유 열쇠 구분

## 0. 결론
Production 읽기 전용 감사 결과, 출석 룰렛 one-shot override 자체는 정상 동작한다.

안서현(`ash160202`) 사례에서 관리자가 `다음 룰렛 = 황금열쇠 +3`을 저장한 직후 보유 열쇠가 늘어난 것처럼 보였지만, 실제 `gold_key_ledger`에는 관리자 override 저장으로 생성된 원장이 0건이었다.

당일 실제 열쇠 증가 원인은 아이의 미션/자유대화 보상이었으며, `KEY_3` override는 `PENDING`으로만 저장되어 다음 실제 룰렛 spin 시 1회 적용된다.

따라서 이번 작업은 **보상 로직 수정이 아니라 관리자 UX 오해 방지 개선**이다.

---

## 1. 현재 정상 동작 유지
현재 one-shot override 상태 흐름을 변경하지 않는다.

```text
관리자 설정 저장
→ attendance_roulette_overrides.status = PENDING
→ 즉시 황금열쇠 지급 없음

아이가 다음 eligible roulette spin 실행
→ PENDING override 감지
→ 지정 result_code 적용
→ 그 시점에 gold_key_ledger 지급
→ override = CONSUMED
```

오늘 이미 룰렛을 사용한 상태에서 override를 저장하면:

```text
당일 추가 지급 없음
→ PENDING 유지
→ 다음날/다음 eligible spin에서 1회 적용
```

---

## 2. 절대 수정하지 말아야 할 것
아래 로직은 정상 확인됐으므로 임의 변경 금지.

- `set_attendance_roulette_override`
- `spin_attendance_roulette`
- override `PENDING → CONSUMED`
- `gold_key_ledger` 지급 로직
- 당일 `base_spin_used` 검사
- `no_available_spin` 처리
- one-shot override 정책

관리자 저장 시 즉시 지급하도록 바꾸지 않는다.

---

## 3. 관리자 화면 컬럼명 변경
현재:

```text
황금열쇠
```

변경:

```text
현재 보유 열쇠
```

또는 공간이 허용되면:

```text
현재 보유 열쇠(잔여)
```

이 값은 룰렛 당첨 결과가 아니라 `gold_key_ledger`의 미소비 잔여 balance라는 것을 명확히 한다.

---

## 4. `다음 룰렛` 설명 강화
헤더 또는 설정 영역에 안내 문구를 추가한다.

```text
다음 룰렛 결과를 1회 예약합니다. 저장 즉시 열쇠가 지급되지 않으며, 아이가 다음 룰렛을 실제로 돌릴 때 적용됩니다.
```

모바일/좁은 화면에서는 툴팁 또는 info icon 사용 가능.

---

## 5. 저장 후 피드백 개선
저장 성공 메시지:

```text
다음 룰렛이 `황금열쇠 +3`으로 예약되었습니다.
아이의 다음 룰렛 실행 시 1회 적용됩니다.
```

오늘 이미 spin을 사용한 아이는:

```text
오늘 룰렛은 이미 사용했습니다.
예약한 결과는 다음 eligible 룰렛에 적용됩니다.
```

실제 DB 상태 기반으로 표시하고 날짜 하드코딩 금지.

---

## 6. 상태 시각화
PENDING이면:

```text
예약됨 · 황금열쇠 +3
```

오늘 이미 spin 완료라면:

```text
예약됨 · 황금열쇠 +3
다음 룰렛에 적용
```

CONSUMED 된 override는 pending 영역에 남기지 않는다.

---

## 7. `최근 결과`와 `다음 룰렛` 의미 분리
### 최근 결과
실제로 이미 실행된 룰렛 결과.

예:
```text
황금열쇠 +1
2026. 8. 10. 오전 9:25
```

### 다음 룰렛
아직 실행되지 않은 1회성 예약 결과.

예:
```text
예약됨 · 황금열쇠 +3
다음 eligible spin에 적용
```

---

## 8. 현재 보유 열쇠 Source of Truth 유지
기존대로 실제 미소비 원장 기준:

```text
gold_key_ledger
consumed = false
```

override 값을 balance에 합산하지 않는다.

---

## 9. 회귀 테스트
### Case A — 오늘 아직 spin 전
1. 현재 보유 열쇠 기록
2. `다음 룰렛 = +3` 저장
3. 저장 직후 balance 불변
4. `예약됨 · +3` 표시
5. 실제 spin
6. +3 결과 확인
7. ledger 지급 확인
8. override CONSUMED 확인

### Case B — 오늘 이미 spin 완료
1. 오전 spin +1 완료
2. `다음 룰렛 = +3` 저장
3. 저장 직후 balance 불변
4. 당일 추가 spin 불가
5. override PENDING 유지
6. 다음 eligible spin에서 +3 적용
7. 그 시점에만 ledger 생성
8. override CONSUMED

### Case C — 다른 활동으로 열쇠 증가
1. override PENDING
2. 미션/자유대화 보상 발생
3. 현재 보유 열쇠 증가
4. override는 그대로 PENDING
5. UI가 보유 열쇠와 예약값을 혼동시키지 않는지 확인

---

## 10. 완료 조건
- 룰렛 지급 로직 변경 없음
- override 저장 시 `gold_key_ledger` 생성 0건
- `황금열쇠` 컬럼을 `현재 보유 열쇠` 계열 명칭으로 변경
- `다음 룰렛`이 예약값임을 명확히 표시
- 저장 성공 메시지에 `즉시 지급 아님 / 다음 실제 룰렛 적용` 의미 포함
- 오늘 이미 spin 완료한 경우 다음 eligible spin 적용 안내
- 최근 결과와 다음 예약 결과 시각적 구분
- 모바일에서도 의미 유지
- 기존 PENDING → CONSUMED 동작 유지
- TypeScript 오류 0
- Build 성공
- Dev E2E PASS
- Production smoke PASS

---

## 11. 완료 보고
1. 변경 전 UX 문제
2. 변경된 컬럼명
3. 추가한 안내/툴팁
4. 저장 후 메시지
5. 오늘 spin 완료 상태 처리
6. one-shot override 상태 흐름 유지 확인
7. 저장 직후 ledger 변화 없음 검증
8. 다음 spin 지급 검증
9. TypeScript/Build
10. Dev E2E
11. Production smoke
