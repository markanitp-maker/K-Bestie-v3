# REQUEST: 내친구 케이 앱 이벤트 통합 구현
## 미션 30일 온보딩 이벤트 + 월별 퀴즈 리더보드 이벤트 + 사용자 로그인 팝업 + 관리자 통합 관리

- 대상 프로젝트: 내친구 케이 앱(K-Bestie v3 메인 앱)
- 적용 환경: Development / Production 모두
- 우선순위: HIGH
- 기준 시간대: Asia/Seoul(KST)
- 연동 프로젝트: 퀴즈마스터 독립 프로젝트
- 시스템 책임: 내친구 케이 앱을 이벤트 정책, 사용자 안내, 관리자 운영, 상품권 지급의 기준 시스템(System of Record)으로 사용
- 핵심 원칙: Development와 Production의 DB, API, Secret, 이벤트 데이터, 지급 데이터는 완전히 분리

---

> ## 2026-08-04 정정 지침 (퀴즈마스터 세션에서 추가 — 착수 전 반드시 먼저 읽을 것)
>
> 퀴즈마스터 측 월별 리더보드 이벤트(§5, §9.5, §11)는 **Development·Production 모두 구현·배포 완료**됐다.
> 실제 아이 데이터는 건드리지 않았고(적용 전후 완전 동일 확인됨), 더미 10명은 결정적 UUID로 시드됐다.
> 아래는 이 요청서 착수 시 §11 순서를 바꾸는 정정 지침이다.
>
> **1) §11.2(최종 스냅샷 수신 API)를 필수 작업으로 시작하지 마라.** 두 프로젝트가 **환경별로 동일한 Supabase
> 프로젝트를 공유**하므로(Dev↔Dev, Prod↔Prod), 내친구 케이 앱 서버가 이미 갖고 있는 service-role 키로
> 아래 테이블을 **직접 SELECT**할 수 있는지 먼저 확인하라:
> - `quiz_monthly_leaderboard_aggregates` (컬럼: environment, period_key, child_id, score, correct_count,
>   incorrect_count, completed_quiz_count, cumulative_time, final_score_achieved_at, scoring_version,
>   is_eligible, period_effective_start_at, updated_at — 실제 아이만 존재, 더미 없음)
> - `quiz_leaderboard_final_snapshots` (환경+period_key당 1행, `checksum`·`status`·`correction_version`으로
>   불변성 보장 — DB 트리거가 일반 UPDATE로 순위 근거 컬럼이 바뀌는 것을 아예 막는다)
> - `quiz_leaderboard_final_entries` (snapshot_id당 rank 1~3, `reward_amount` 포함, 이 행 자체가 UPDATE 자체가
>   금지된 append-only 테이블)
> - `quiz_leaderboard` (전체 누적 테이블, 더미 10명이 `is_seed_user=true`/`is_reward_eligible=false`로 여기
>   존재 — 월별 테이블에는 더미가 없으므로 "더미 포함 리더보드"를 만들려면 이 테이블과 위 aggregates를
>   직접 병합해야 한다. 정렬 로직은 이 요청서 §5.1/퀴즈마스터의 `lib/quiz/event-period.ts`
>   TIE_BREAK_POLICY와 반드시 동일해야 함: score desc → cumulative_time asc → final_score_achieved_at
>   asc(nulls last) → child_id asc)
>
> **직접 조회가 가능하면(같은 Supabase 프로젝트라 실제로 가능할 것이다) §11.2 수신 API는 만들지 말고,
> 이미 존재하는 중복 concept(있다면)은 제거하거나 코드상 비활성 상태로만 남겨라.** 대신 §11.1(현재
> 리더보드 조회)에 해당하는 기능도 서버 간 HTTP 호출 대신 위 테이블 직접 조회로 대체 가능한지 함께
> 판단하라 — 퀴즈마스터의 `GET /api/internal/events/leaderboard`(§11.1 원안)는 이미 구현·배포돼 있어
> 필요하면 그대로 쓸 수 있지만, 같은 DB를 이미 공유하는 이상 굳이 HTTP 왕복 없이 직접 쿼리가 더 단순할
> 수 있다는 뜻이다. 최종 판단(직접 쿼리 vs HTTP 호출)은 이 지시서를 실행하는 세션이 실측 후 결정하라.
>
> **2) §11.2를 정말 필수로 만들어야 하는 상황이 확인되면**(예: 다른 이유로 직접 DB 접근이 막혀 있다면),
> 그때는 원안대로 진행하되 인증은 기존 `MAIN_APP_REWARDS_API_KEY`/`MAIN_APP_REWARDS_API_BASE_URL` 쌍의
> `Bearer + Idempotency-Key` 규약을 그대로 재사용한다(퀴즈마스터 송신측이 이미 이 규약으로 구현·테스트
> 완료됨 — `lib/quiz/leaderboard-delivery.ts`, eventId = `${snapshotId}:${correctionVersion}`).
>
> **3) 이 요청서의 나머지 전체(§1~§21: 로그인 팝업, 미션 30일 이벤트, 아이 홈 진행 카드, 부모 화면,
> 관리자 4개 메뉴, 수동 지급 흐름, Dev 검증, Production 배포 게이트)는 그대로 필수 작업이다.** BLOCKED/
> HIGH/MEDIUM 0건일 때만 Production까지 배포하고, 실계정을 이용한 실제 E2E(퀴즈 시작→제출→월별 점수
> 반영→더미 포함 순위→황금열쇠 및 기존 callback 회귀)는 대표님의 수동 체크리스트로 남겨라 — 이 항목이
> 끝나지 않았다고 해서 코드 작업을 완료로 보고하지 말 것.

---

# 1. 목적

신규 아이가 케이와 자연스럽게 친해지고 서비스의 핵심 기능을 반복 경험하도록 다음 두 이벤트를 구현한다.

1. 아이별 최초 미션 정상 완료 시점부터 정확히 30일 동안 한 번만 진행되는 미션 온보딩 이벤트
2. 2026년 8월, 9월, 10월 각 월의 퀴즈 리더보드 1·2·3위 상품권 이벤트

아이와 부모가 로그인하면 현재 진행 중인 이벤트의 목적, 기간, 참여 방법, 보상 기준을 이해할 수 있도록 역할별 이벤트 안내 팝업을 표시한다.

메인 앱 담당 범위:

- 아이 로그인 이벤트 안내 팝업
- 부모 로그인 이벤트 안내 팝업
- 아이별 최초 미션 완료 시 30일 이벤트 시작
- 아이별 미션 완료 횟수 집계
- 아이 홈 미션 진행 카드
- 부모 화면 자녀별 이벤트 현황
- 퀴즈 리더보드 현황 표시
- 관리자 통합 이벤트 관리
- 상품권 지급 대상, 승인, 발송, 실패, 재처리 관리
- 퀴즈마스터 현재 리더보드 조회
- 퀴즈마스터 월말 최종 TOP3 스냅샷 수신
- 감사 로그, 권한, 보안, 중복 방지
- Development / Production 독립 운영

---

# 2. 작업 전 필수 현황 점검

코드 변경 전에 다음을 점검하고 결과를 task.md 또는 walkthrough.md에 남긴다.

## 2.1 사용자·화면 구조

- 아이 로그인 완료 후 최초 진입 라우트
- 부모 로그인 완료 후 최초 진입 라우트
- 아이와 부모 역할 구분 방식
- 아이 홈 상단 컴포넌트 구조
- 부모 홈 또는 자녀 현황 화면 구조
- 기존 공통 모달, 팝업, 바텀시트 컴포넌트
- 모바일·태블릿 공통 레이아웃
- 관리자 사이드 메뉴와 iframe 또는 내부 라우트 구조

## 2.2 미션 구조

- 기존 공식 미션 완료 판정 기준
- 자동 미션, 수동 미션, Premium 미션 등 유형별 완료 저장 방식
- 미션 세션 ID
- 완료 콜백 재시도 가능성
- 중복 완료 이벤트 가능성
- 무효·중단·취소 미션 처리
- 기존 완료 시간을 저장하는 컬럼
- 기존 일일 미션 2회 정책과 충돌 여부

## 2.3 사용자·보호자 식별

- child_id
- parent_user_id
- 부모와 아이 연결 관계
- 아이 이름, 로그인 아이디
- 부모 이름, 로그인 아이디
- QA·테스트 계정 식별 방식
- 탈퇴·soft delete 상태

## 2.4 관리자·지급 구조

- 기존 관리자 권한 체계
- 기존 감사 로그
- 기존 보상 또는 상품권 테이블
- 보호자 연락처 저장 위치
- CSV 다운로드 패턴
- 관리자 변경 이력 저장 방식

## 2.5 퀴즈마스터 연동

- handoff token 구조
- 완료 callback
- 환불 callback
- 서버 간 인증 방식
- 실제 퀴즈마스터 외부 URL 비노출 구조
- Development / Production callback URL과 Secret 분리

---

# 3. 금지 사항

- 현재 미션 완료 기준을 추측해서 새로 만들지 말 것
- 클라이언트에서 미션 완료 횟수를 직접 증가시키지 말 것
- localStorage만으로 이벤트 시작·진행·팝업 확인 상태를 관리하지 말 것
- 퀴즈마스터 외부 URL을 사용자 화면, 주소창, 쿼리스트링, 클라이언트 코드에 노출하지 말 것
- Development 데이터를 Production에 복사하거나 합산하지 말 것
- service role key, API key, Secret, token, password를 코드·로그·문서·임시파일에 출력하지 말 것
- 관리자 승인 없이 상품권 자동 발송을 구현하지 말 것
- 상품권을 아이 연락처로 직접 발송하지 말 것
- 기존 미션, 자유대화, 황금열쇠, 놀이, 리포트 기능을 회귀시키지 말 것
- 이미 시작된 이벤트의 started_at을 일반 관리자 UI에서 임의 변경하지 말 것
- 30일 종료 후 이벤트 재시작 버튼을 만들지 말 것

---

# 4. 미션 이벤트 확정 정책

## 4.1 이벤트 성격

이 이벤트는 신규 아이가 케이와 친해지기 위한 최초 30일 1회성 온보딩 이벤트다.

- 아이마다 생애 1회만 진행
- 부모 가입일에 시작하지 않음
- 아이 등록일에 시작하지 않음
- 아이가 최초 미션을 정상 완료한 시점에 시작
- 단순 미션 진입, 마이크 활성화, 질문 일부 응답, 중간 이탈은 시작 조건 아님
- 시작 후 정확히 30일 동안만 미션 완료를 집계
- 종료 후 재시작·초기화·반복 운영 금지
- 앱 재설치, 기기 변경, 로그아웃·재로그인에도 상태 유지
- 형제·자매·쌍둥이는 각 child_id별 독립 이벤트
- Development와 Production에서 각각 독립 진행

## 4.2 시작과 종료

- started_at: 아이의 최초 유효 미션 완료 시각
- ends_at: started_at + 정확히 30일
- 인정 범위: completed_at >= started_at AND completed_at < ends_at
- ends_at과 정확히 같은 시각의 완료는 집계 제외
- DB 저장은 UTC
- 사용자·관리자 표시는 KST
- 최초 미션 완료 저장과 이벤트 인스턴스 생성은 원자적 또는 동등한 멱등 처리

예시:

- 최초 미션 완료: 2026-08-05 14:20:00 KST
- 이벤트 종료: 2026-09-04 14:20:00 KST
- 2026-09-04 14:19:59 KST 완료: 인정
- 2026-09-04 14:20:00 KST 완료: 제외

## 4.3 미션 완료 집계

- 기존 공식 미션 완료 판정을 기준으로 함
- 같은 mission_session_id는 한 번만 인정
- 네트워크 재시도, 중복 콜백, 동시 요청에도 중복 증가 금지
- 하루 정상 완료 가능한 미션 수만큼 인정
- QA·내부 테스트·무효·삭제·취소 미션은 지급 집계에서 제외 가능
- 최대 60회까지만 이벤트 카운트 반영
- 60회 이후에도 일반 미션은 정상 이용
- 60회 이후 이벤트 카운트는 60에서 고정
- 종료 후 미션은 일반 기록에는 남지만 이벤트 집계 제외

## 4.4 상품권 지급

30일 종료 시 최종 완료 횟수에 따라 가장 높은 달성 구간의 상품권 1개만 지급한다.

| 최종 미션 완료 횟수 | 지급 상품권 |
|---:|---:|
| 0~9회 | 없음 |
| 10~29회 | 1,000원 |
| 30~49회 | 3,000원 |
| 50~59회 | 5,000원 |
| 60회 | 10,000원 |

- 누적 지급 금지
- 60회 달성 시 10,000원만 지급
- 50회 달성 시 5,000원만 지급
- 30일 종료 전 60회 달성 시 최고 구간 달성 상태 표시 가능
- 실제 발송은 관리자 지급 절차를 따름
- 60회 미만은 30일 종료 시 최종 지급 금액 확정
- 상품권은 보호자에게 전달
- 미션 집계 상태와 지급 상태는 분리

---

# 5. 퀴즈 리더보드 이벤트 확정 정책

## 5.1 월별 기간

| 이벤트 월 | 집계 시작 | 기준 종료 |
|---|---|---|
| 2026년 8월 | 2026-08-01 00:00:00 KST | 2026-08-31 23:59:59 KST |
| 2026년 9월 | 2026-09-01 00:00:00 KST | 2026-09-30 23:59:59 KST |
| 2026년 10월 | 2026-10-01 00:00:00 KST | 2026-10-31 23:59:59 KST |

구현은 반개구간으로 처리:

- 8월: 2026-08-01 00:00:00 KST 이상, 2026-09-01 00:00:00 KST 미만
- 9월: 2026-09-01 00:00:00 KST 이상, 2026-10-01 00:00:00 KST 미만
- 10월: 2026-10-01 00:00:00 KST 이상, 2026-11-01 00:00:00 KST 미만

## 5.2 보상

| 최종 순위 | 상품권 |
|---:|---:|
| 1위 | 5,000원 |
| 2위 | 3,000원 |
| 3위 | 1,000원 |

- 각 월은 독립 이벤트
- 8월 순위는 9월에 이월하지 않음
- 기존 퀴즈마스터 공식 점수 산식을 그대로 사용
- 메인 앱은 점수를 재계산하지 않음
- 마감 전: 현재 순위, 예상 상품권
- 마감 후: 최종 순위, 지급 확정
- 상품권 발송은 메인 앱 관리자에서 관리

---

# 6. 로그인 시 이벤트 안내 팝업

## 6.1 공통 노출 정책

아이와 부모가 로그인에 성공하고 홈 데이터 로딩이 완료된 직후 이벤트 안내 팝업을 표시한다.

- 이벤트 공지 버전별 최초 1회 확인
- 확인하지 못하고 앱 종료 시 다음 로그인에서 재노출
- 확인 버튼을 누르면 서버에 acknowledgement 저장
- 같은 공지 버전은 재노출하지 않음
- 공지 버전이 변경되면 다시 1회 노출 가능
- 아이와 부모 확인 상태 분리
- 같은 부모의 여러 아이는 부모 팝업에서 자녀별 상태 표시 가능
- 미션 시작 전, 진행 중, 종료 상태별 동적 문구
- 퀴즈 이벤트는 해당 월에만 활성 안내
- 팝업 조회 실패가 로그인 자체를 막지 않게 함
- 단순 페이지 이동·새로고침·리렌더링으로 중복 표시 금지
- localStorage가 아니라 서버 확인 상태를 기준으로 함

## 6.2 아이 팝업

제목:

`케이와 더 친해지는 이벤트가 열렸어요!`

본문:

```text
첫 미션을 끝까지 완료하면 그 순간부터 30일 이벤트가 시작돼요.

30일 동안 케이와 미션을 완료해 보세요.
10번, 30번, 50번, 60번을 달성할수록 받을 수 있는 선물이 커져요.

최종 달성한 가장 높은 단계의 선물 하나를 받아요.
60번을 완료하면 편의점 상품권 10,000원을 받을 수 있어요.

8월, 9월, 10월에는 퀴즈 리더보드 이벤트도 진행돼요.
매월 마지막 날 기준 1·2·3등에게 선물을 드려요.
```

버튼:

`이벤트 확인했어요`

진행 중 동적 문구 예시:

```text
케이와 친해지는 30일 이벤트가 진행 중이에요.

현재 미션 13/60 완료
이벤트 종료까지 18일 남았어요.
현재 달성 선물: 편의점 상품권 1,000원
다음 단계까지 17번 남았어요.
```

UX:

- 아동이 이해하기 쉬운 문장
- 돈보다 케이와 친해지는 경험을 우선
- 실패·탈락·보상 소멸 압박 문구 금지
- 자동 닫힘 금지
- 본문 스크롤, 하단 버튼 고정
- 모바일·태블릿 안전 영역 대응

## 6.3 부모 팝업

제목:

`내친구 케이 이벤트 안내`

본문:

```text
아이들이 케이와 자연스럽게 친해질 수 있도록 두 가지 이벤트를 진행합니다.

1. 케이와 친해지는 30일 미션
- 자녀가 최초 미션을 정상 완료한 순간부터 30일이 시작됩니다.
- 자녀별로 한 번만 진행되며 30일 종료 후 다시 시작되지 않습니다.
- 30일 동안 완료한 미션 횟수에 따라 가장 높은 달성 구간의 상품권 1개를 지급합니다.
- 10회 1,000원 / 30회 3,000원 / 50회 5,000원 / 60회 10,000원

2. 월별 퀴즈 리더보드
- 2026년 8월 31일, 9월 30일, 10월 31일 23:59:59 KST 기준으로 월별 순위를 확정합니다.
- 매월 1위 5,000원 / 2위 3,000원 / 3위 1,000원 상품권을 지급합니다.

상품권은 보호자에게 전달하며, 관리자 확인 후 지급 상태를 안내합니다.
```

자녀별 상태 예시:

```text
서아: 미션 이벤트 시작 전
서현: 13/60 완료 · 18일 남음 · 현재 1,000원 구간
```

버튼:

`이벤트 확인`

---

# 7. 아이 홈 화면

## 7.1 위치

아이 홈 인사 영역 바로 아래, 주요 미션 카드보다 위에 배치한다.

## 7.2 시작 전

```text
케이와 친해지는 30일

첫 미션을 완료하면 30일 이벤트가 시작돼요.
30일 동안 최대 60번의 미션에 도전해 보세요.

[미션 시작하기]
```

카드 조회만으로 이벤트를 시작하지 않는다.

## 7.3 진행 중

필수 표시:

- 이벤트명
- 완료 횟수
- 남은 기간 또는 종료일
- 현재 달성 상품권
- 다음 구간까지 남은 횟수
- 진행 막대
- 10·30·50·60 마커
- 상세 보기

예시:

```text
케이와 친해지는 30일
13/60 완료

케이와 벌써 13번 이야기했어요!
현재 1,000원 구간을 달성했어요.
17번 더 완료하면 3,000원 구간이에요.
이벤트 종료까지 18일 남았어요.
```

## 7.4 60회 달성

```text
60/60 최고 단계 달성!

케이와 60번 미션을 완료했어요.
편의점 상품권 10,000원 구간을 달성했어요.
상품권은 보호자에게 전달될 예정이에요.
```

## 7.5 종료

10회 이상:

```text
케이와 함께한 30일이 끝났어요.
총 38번 미션을 완료했어요.
편의점 상품권 3,000원 지급 대상이에요.
상품권은 보호자에게 전달될 예정이에요.
```

10회 미만:

```text
케이와 함께한 30일이 끝났어요.
총 8번 미션을 완료했어요.
앞으로도 케이와 재미있게 이야기해요.
```

종료 후 재시작 버튼 금지.

---

# 8. 부모 화면

자녀별 이벤트 현황을 제공한다.

## 8.1 미션 이벤트 항목

- 아이 이름 (로그인 아이디)
- 상태
- 최초 미션 완료 시각
- 종료 예정 시각
- 완료 횟수
- 현재 달성 구간
- 최종 상품권
- 지급 상태

예시:

```text
안서현 (testb@kbestie.local)
진행 중 · 13/60 완료
2026-08-03 20:14 시작
2026-09-02 20:14 종료 예정
현재 달성 구간: 1,000원
```

## 8.2 퀴즈 이벤트 항목

- 현재 이벤트 월
- 아이 현재 순위
- 현재 점수
- 마감 시각
- 예상 상품권
- 마감 후 최종 순위
- 지급 상태

---

# 9. 데이터 모델

기존 공통 이벤트·지급 테이블이 적합하면 재사용한다. 아래 의미는 반드시 보장한다.

## 9.1 이벤트 공지 확인

`event_announcement_acknowledgements`

- id
- announcement_key
- announcement_version
- audience_type
- parent_user_id 또는 child_id
- acknowledged_at
- created_at

유일성:

- 부모: announcement_key + announcement_version + parent_user_id
- 아이: announcement_key + announcement_version + child_id

## 9.2 미션 이벤트 인스턴스

`child_mission_onboarding_events`

- id
- child_id
- environment
- status
- started_at
- ends_at
- completed_at
- mission_completed_count
- final_mission_count
- current_reward_amount
- final_reward_amount
- reward_fulfillment_status
- created_at
- updated_at

제약:

- environment + child_id unique
- 아이당 환경별 생애 1개
- mission_completed_count 0~60
- started_at과 ends_at 일반 수정 금지

상태:

- not_started
- active
- max_completed
- completed

## 9.3 미션 집계 원장

`child_mission_event_completions`

- id
- event_id
- child_id
- mission_session_id
- mission_type
- mission_completed_at
- counted
- excluded_reason
- counted_at
- created_at

유일성:

- event_id + mission_session_id

## 9.4 상품권 지급

`event_reward_fulfillments`

- id
- environment
- event_type
- event_reference_id
- child_id
- parent_user_id
- reward_amount
- reward_type
- status
- recipient_contact_snapshot_masked
- provider_reference
- approved_by
- approved_at
- sent_at
- failure_reason
- created_at
- updated_at

상태:

- pending
- approved
- sending
- sent
- failed
- on_hold
- cancelled

## 9.5 퀴즈 최종 스냅샷 미러

`quiz_leaderboard_final_snapshots`

- id
- environment
- period_key
- period_started_at
- period_ended_at
- finalized_at
- source_snapshot_id
- source_checksum
- payload_version
- created_at

`quiz_leaderboard_final_entries`

- snapshot_id
- rank
- child_id
- score
- correct_count
- completed_quiz_count
- tie_break_values
- reward_amount
- created_at

제약:

- environment + period_key unique
- snapshot_id + rank unique
- snapshot_id + child_id unique

---

# 10. 미션 이벤트 서버 로직

## 10.1 최초 미션 완료

```text
1. 미션 공식 완료 확정
2. child_id와 mission_session_id 확보
3. 이벤트 인스턴스 조회
4. 없으면 최초 완료 시각으로 이벤트 생성
5. started_at = 공식 완료 시각
6. ends_at = started_at + 30일
7. 동일 트랜잭션에서 첫 미션 원장 저장
8. mission_completed_count = 1
9. 이미 이벤트가 있으면 기간·중복 확인 후 집계
10. 60회 도달 시 max_completed 및 10,000원 구간 반영
```

## 10.2 종료 처리

지연 평가와 정기 작업을 모두 안전하게 지원한다.

```text
if now >= ends_at and status != completed:
  final_mission_count = min(mission_completed_count, 60)
  final_reward_amount = reward_tier(final_mission_count)
  status = completed
  completed_at = ends_at
  final_reward_amount > 0이면 지급 대상 1건 생성
```

동일 작업 재실행 시 지급 대상 중복 생성 금지.

## 10.3 보상 계산 단일화

서버 공통 함수 하나로 관리:

```text
60 이상 -> 10000
50 이상 -> 5000
30 이상 -> 3000
10 이상 -> 1000
그 외 -> 0
```

클라이언트와 관리자에서 별도 계산식 중복 금지.

---

# 11. 퀴즈마스터 연동

## 11.1 현재 리더보드 조회

브라우저가 아니라 메인 앱 서버가 퀴즈마스터 서버에 요청한다.

예시:

```http
GET /internal/events/leaderboard?period=2026-08&limit=100&cursor=...
Authorization: server-to-server credential
X-Environment: development|production
```

응답 의미:

```json
{
  "period": "2026-08",
  "status": "active",
  "asOf": "2026-08-03T13:55:00Z",
  "scoringVersion": "existing-production-rule-version",
  "entries": [
    {
      "rank": 1,
      "childId": "uuid",
      "score": 12450,
      "correctCount": 184,
      "completedQuizCount": 21,
      "lastActivityAt": "2026-08-03T12:10:00Z",
      "estimatedRewardAmount": 5000
    }
  ],
  "nextCursor": null
}
```

요구사항:

- 서버 간 인증
- environment 검증
- period allowlist
- timeout
- pagination
- rate limit
- 브라우저 직접 호출 금지
- 외부 URL 노출 금지
- 실패 시 마지막 정상 조회 시각 표시
- 임의 순위 생성 금지

## 11.2 최종 스냅샷 수신

이벤트 타입:

`quiz.leaderboard.finalized.v1`

필수 payload 의미:

```json
{
  "eventId": "unique-event-id",
  "environment": "production",
  "period": "2026-08",
  "periodStartedAt": "2026-07-31T15:00:00Z",
  "periodEndedAtExclusive": "2026-08-31T15:00:00Z",
  "finalizedAt": "2026-08-31T15:00:10Z",
  "snapshotId": "quizmaster-snapshot-id",
  "scoringVersion": "existing-production-rule-version",
  "checksum": "payload-checksum",
  "winners": [
    {
      "rank": 1,
      "childId": "uuid",
      "score": 12450,
      "correctCount": 184,
      "completedQuizCount": 21,
      "rewardAmount": 5000,
      "tieBreakValues": {}
    },
    {
      "rank": 2,
      "childId": "uuid",
      "score": 11920,
      "correctCount": 179,
      "completedQuizCount": 20,
      "rewardAmount": 3000,
      "tieBreakValues": {}
    },
    {
      "rank": 3,
      "childId": "uuid",
      "score": 10880,
      "correctCount": 165,
      "completedQuizCount": 19,
      "rewardAmount": 1000,
      "tieBreakValues": {}
    }
  ]
}
```

검증:

- HMAC 또는 기존 서명
- timestamp 허용 오차
- replay 방지
- eventId 멱등성
- environment 일치
- period allowlist
- rank 1·2·3 유일성
- rewardAmount 고정 검증
- childId 유효성
- checksum 검증
- 최종 snapshot 중복 생성 금지

수신 성공:

1. 최종 스냅샷 저장
2. TOP3 지급 대상 생성
3. 관리자 지급 대기 표시
4. 성공 응답
5. 재전송에도 중복 없음

---

# 12. 관리자 화면

사이드 메뉴:

```text
이벤트 관리
 ├─ 이벤트 현황
 ├─ 미션 이벤트
 ├─ 퀴즈 리더보드
 └─ 상품권 지급 관리
```

기존 관리자 페이지가 iframe 기반이면 동일 사이드 메뉴 안에서 표시하고 외부 페이지로 이탈하지 않는다.

## 12.1 공통

- 환경: Development / Production
- Production 경고 배지
- 아이: 이름 (로그인 아이디)
- 부모: 이름 (로그인 아이디)
- 검색
- 상태 필터
- 기간 필터
- 보상 구간
- 지급 상태
- QA 계정 포함 여부
- 정렬
- 페이지네이션
- CSV
- 새로고침
- 오류 원인과 마지막 정상 조회 시각

## 12.2 이벤트 현황 KPI

- 미션 시작 전
- 미션 진행 중
- 오늘 종료
- 7일 내 종료
- 10회 달성
- 30회 달성
- 50회 달성
- 60회 달성
- 미션 예상 총 지급액
- 현재 월 퀴즈 참여자 수
- 현재 TOP3
- 월별 예상 지급액
- 지급 대기
- 승인
- 발송 완료
- 발송 실패

주의 항목:

- 종료 후 보상 미확정
- 보호자 연락처 누락
- 중복 집계 의심
- 퀴즈 최종 스냅샷 미수신
- 지급 실패
- 환경 불일치

## 12.3 미션 이벤트 목록

컬럼:

- 아이
- 부모
- 환경
- 상태
- 최초 미션 완료
- 종료 시각
- 남은 시간
- 완료 횟수
- 현재 구간
- 최종 지급액
- 지급 상태
- 최근 미션
- 상세

## 12.4 미션 상세

- 아이·부모 정보
- started_at
- ends_at
- 상태
- 13/60
- 다음 구간
- 현재 상품권
- 최종 상품권
- 집계 원장
- 제외 미션
- 지급 이력
- 감사 로그

관리자 기능:

- 재계산
- 집계 제외
- 집계 복구
- 지급 승인
- 지급 보류
- CSV

모든 변경에 사유 필수.

## 12.5 퀴즈 리더보드

월 선택:

- 2026-08
- 2026-09
- 2026-10

표시:

- 예정 / 진행 중 / 최종 확정
- 기간
- 마지막 동기화
- scoringVersion
- 현재 TOP3
- 전체 리더보드
- 아이별 순위·점수·정답 수·완료 세션 수
- 예상 상품권
- 최종 상품권
- snapshotId
- finalizedAt
- 지급 상태
- 연동 오류

## 12.6 상품권 지급 관리

컬럼:

- 이벤트 유형
- 이벤트 기간 또는 월
- 아이
- 부모
- 달성 내역
- 지급 금액
- 보호자 연락처 마스킹
- 지급 상태
- 승인자
- 발송 시각
- 외부 참조번호
- 실패 사유
- 상세

상태 흐름:

```text
pending -> approved -> sending -> sent
                      -> failed -> approved 또는 on_hold
pending/approved -> on_hold
```

실제 자동 발송 연동은 별도 승인 없이 구현하지 않는다.

---

# 13. 관리자 권한·감사 로그

권한:

- 조회 관리자
- 운영 관리자
- 최고 관리자

감사 로그:

- 관리자 ID
- 환경
- 아이
- 이벤트 유형
- 대상 레코드
- 작업 유형
- 변경 전
- 변경 후
- 변경 사유
- 요청 ID
- 작업 시각
- 기존 보안 감사 컨텍스트

---

# 14. 보안

- 관리자 API 역할 기반 권한
- 일반 사용자 관리자 데이터 접근 금지
- service role 서버 전용
- 환경별 Secret 분리
- Secret 로그 금지
- webhook 서명 검증 전 반영 금지
- replay 방지
- 브라우저 내부 API Secret 노출 금지
- 보호자 연락처 마스킹
- CSV 다운로드 감사 로그
- RLS 또는 서버 전용 정책
- 아이는 본인 이벤트만
- 부모는 연결된 아이만
- child_id만으로 보호자 조회 금지

---

# 15. 기존 아이 처리

배포 전에 가입한 아이도 대상이다.

- 과거 가입일로 30일 종료 처리하지 않음
- 배포 후 최초 유효 미션 완료 시 시작
- 과거 미션 기록 소급 집계 금지
- 이미 동일 이벤트 데이터가 있으면 중복 생성 금지
- 퀴즈 8월 이벤트만 8월 1일부터 유효 점수를 소급 집계

---

# 16. UI 상태와 오류 처리

## 16.1 로딩

- 0으로 임시 표시 금지
- skeleton 또는 로딩 문구

## 16.2 실패

- 마지막 정상 데이터 표시
- 마지막 업데이트 시각
- 재시도
- 추정 금지

## 16.3 중복 팝업

- React Strict Mode 중복 방지
- route transition 중복 방지
- hydration 중복 방지
- 서버 acknowledgement 기준
- localStorage 단독 사용 금지

---

# 17. 테스트

## 17.1 단위

- 보상 경계: 0, 9, 10, 29, 30, 49, 50, 59, 60, 61
- 30일 종료
- KST/UTC
- 중복 미션
- 이벤트 시작 멱등
- 종료 멱등
- 공지 acknowledgement
- 퀴즈 rank 보상 검증

## 17.2 통합

- 첫 미션 완료와 이벤트 생성
- 동일 미션 2회 콜백
- 두 기기 동시 완료
- 59→60
- 60 이후
- 종료 직전·정확히 종료·직후
- 형제 2명 독립
- 아이 팝업 1회
- 부모 팝업 1회
- 공지 버전 변경
- 현재 퀴즈 순위 조회
- 최종 snapshot 정상·중복·변조·환경 불일치
- 지급 대상 중복 방지

## 17.3 E2E

1. 아이 로그인 팝업
2. 부모 로그인 팝업
3. 첫 미션 완료
4. 홈 1/60
5. 관리자 반영
6. 부모 반영
7. 누적
8. 30일 종료 fixture
9. 상품권 확정
10. Dev 퀴즈 순위
11. 월말 snapshot mock
12. 관리자 TOP3
13. 지급 대기
14. Dev/Prod 격리

## 17.4 회귀

- 자동 미션
- 수동 미션
- Premium Live
- 자유대화
- 황금열쇠
- 놀이
- MBTI
- 퀴즈 handoff
- 부모 리포트
- 관리자 기존 메뉴
- 모바일·태블릿

---

# 18. 배포 순서

1. 현황 감사
2. Dev migration
3. Dev 서버 로직
4. 로그인 팝업
5. 아이 홈
6. 부모 화면
7. 관리자 화면
8. 퀴즈마스터 Dev 연동
9. Dev E2E
10. Production migration 검토
11. Production migration
12. 메인 앱 Production 배포
13. 퀴즈마스터 Production 연동
14. Production smoke test
15. 모니터링
16. 결과 보고

---

# 19. 롤백·장애 대응

- UI feature flag
- 팝업·카드 즉시 비활성 가능
- 데이터 기록 유지
- started_at 삭제 금지
- 원장 기반 재계산
- 퀴즈 장애 시 마지막 정상 순위 표시
- 최종 스냅샷 미수신 경고
- webhook 재시도
- 상품권 실패 재처리
- Production 문제 시 Dev 데이터 대체 금지

---

# 20. 완료 조건

- 아이·부모 로그인 팝업
- 공지 버전별 1회 확인
- 첫 미션 완료부터 30일
- 아이별 생애 1회
- 종료 후 재시작 불가
- 정확한 시간 경계
- 0~60 집계
- 최고 구간 하나만 지급
- 아이·부모·관리자 데이터 일치
- 퀴즈 현재 순위 조회
- 8·9·10월 TOP3 snapshot 수신
- 지급 관리
- Dev/Prod 분리
- 권한·RLS·Secret·서명 검증
- 단위·통합·E2E·회귀 PASS
- walkthrough 기록

---

# 21. 최종 보고 형식

```text
1. 구현 요약
2. 변경 파일
3. DB migration과 RLS
4. 미션 이벤트 시작·종료·보상 로직
5. 아이·부모 로그인 팝업
6. 아이 홈·부모 화면
7. 관리자 화면
8. 퀴즈마스터 연동 API
9. Development 테스트
10. Production 배포
11. 보안 점검
12. 미해결 항목
13. 롤백/Forward Fix
```

Secret, token, service role key, 개인정보 원문 출력 금지.
