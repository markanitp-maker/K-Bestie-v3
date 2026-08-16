# Request: 기존 회원가입 유입 링크 전체 랜딩페이지 전환 및 레거시 링크 호환

## 0. 작업 목적

현재 관리자 `운영 도구 > 유입 링크 관리`에서 새로 생성되는 일반 마케팅 유입 링크는 랜딩페이지(`/`)로 정상 생성되지만, 과거에 생성된 기존 링크들은 여전히 `/signup`을 목적지로 사용하고 있다.

현재 예:
`https://app.k-bestie.com/signup?link_id=direct_official_launch&utm_source=direct&utm_medium=personal&utm_campaign=official_launch`

신규 정상 예:
`https://app.k-bestie.com/?link_id=wife_official_launch_2fpg&utm_source=wife&utm_medium=social&utm_campaign=official_launch`

이번 작업의 목표는 기존/신규 모든 일반 마케팅 유입 링크의 최종 목적지를 랜딩페이지 `/`로 통일하는 것이다.

---

## 1. 최종 정책

일반 마케팅/회원가입 유입 링크는 모두 아래 형태로 통일한다.

```text
https://app.k-bestie.com/?link_id=...&utm_source=...&utm_medium=...&utm_campaign=...
```

`/signup?...`은 일반 마케팅 유입 링크의 기본 목적지로 사용하지 않는다.

---

## 2. 정상 사용자 흐름

```text
마케팅 유입 링크
→ app.k-bestie.com 랜딩페이지 `/`
→ 서비스 소개 확인
→ [시작하기]
→ Google/Kakao 인증
→ 기존 사용자: 로그인/ACTIVE 흐름
→ 신규 사용자: 회원가입/약관/온보딩
```

랜딩 진입 시 받은 attribution 정보는 인증/회원가입 완료까지 보존한다.

---

## 3. 기존 링크 데이터 전수 확인

먼저 `acquisition_links` 및 관련 테이블/API를 확인하여 기존 링크의 목적지 정보가 어디에 저장되는지 확정한다.

확인 대상 예:

```text
target_path
destination_path
target_url
destination_url
redirect_url
landing_path
```

또는 URL이 DB에 저장되지 않고 런타임에 조립되는 구조인지 확인한다.

추측해서 컬럼을 만들지 말고 현재 실제 schema를 기준으로 작업한다.

---

## 4. 기존 일반 마케팅 링크 일괄 마이그레이션

기존에 생성된 일반 마케팅 유입 링크 중 `/signup`을 목적지로 사용하는 레코드를 모두 랜딩페이지 `/` 기준으로 변경한다.

```text
Before
/signup?link_id=direct_official_launch&utm_source=direct&utm_medium=personal&utm_campaign=official_launch

After
/?link_id=direct_official_launch&utm_source=direct&utm_medium=personal&utm_campaign=official_launch
```

다음 값은 절대 변경하지 않는다.

```text
link_id
utm_source
utm_medium
utm_campaign
기존 attribution용 기타 query parameter
기존 클릭/가입 집계 데이터
기존 primary key
```

즉 목적지 path만 변경한다.

---

## 5. 변경 대상

관리자 `유입 링크 관리`에서 관리하는 일반 마케팅/홍보 링크 전체.

예:

```text
직접 공유
네이버 카페
카카오톡 오픈채팅
카카오톡
페이스북
Meta 광고
블로그
유튜브
인스타그램
와이프/지인 공유
기타 일반 acquisition 링크
```

활성/비활성 여부와 관계없이 기존 일반 마케팅 링크는 동일 정책으로 정리한다.

---

## 6. 변경 제외 대상

아래처럼 특정 경로가 기능적으로 필요한 링크는 이번 일괄 전환에서 제외한다.

```text
가족 초대 링크
보호자 초대 링크
1회용 초대 토큰 링크
아이/가족 연결용 딥링크
결제/인증 callback
관리자 전용 링크
특정 기능 진입용 딥링크
```

---

## 7. 관리자 `복사` 버튼 동작 통일

기존 레코드와 신규 레코드 모두 `복사` 클릭 시 동일한 URL builder를 사용하도록 공통화한다.

최종 생성 규칙:

```text
origin = https://app.k-bestie.com
pathname = /
query = 기존 link_id + UTM + 기타 attribution parameter
```

과거 레코드라고 별도 `/signup` 분기를 타지 않게 한다.

---

## 8. 이미 외부 공유된 레거시 `/signup` 마케팅 링크 호환

이미 카카오톡/SNS/게시글 등에 공유된 과거 URL은 DB 마이그레이션만으로 바뀌지 않는다.

따라서 레거시 일반 마케팅 `/signup` 링크도 랜딩페이지로 안전하게 유도한다.

대상 예:

```text
/signup?link_id=direct_official_launch&utm_source=direct&utm_medium=personal&utm_campaign=official_launch
```

정상 처리:

```text
302/307 server-side redirect
→ /?link_id=direct_official_launch&utm_source=direct&utm_medium=personal&utm_campaign=official_launch
```

조건:
- 실제 acquisition `link_id` 또는 명확한 마케팅 UTM 링크에만 적용
- query parameter 100% 보존
- 가족 초대/특수 딥링크에는 적용 금지
- redirect loop 금지

---

## 9. 랜딩페이지 Attribution 보존

아래 값은 랜딩부터 회원가입/로그인 완료까지 유실되면 안 된다.

```text
link_id
utm_source
utm_medium
utm_campaign
기타 기존 attribution parameter
```

흐름:

```text
랜딩
→ 시작하기 CTA
→ OAuth
→ 신규 회원가입 / 기존 로그인
→ parent_attributions 또는 현재 attribution 저장 구조
```

---

## 10. CTA href 서버 렌더링 원칙

이전 확인된 hydration 문제를 재발시키지 않는다.

`시작하기` CTA의 최종 `href`는 가능하면 서버 렌더링 단계에서 확정하여 최초 HTML부터 정확해야 한다.

다음 동작 모두 attribution이 보존되어야 한다.

```text
일반 좌클릭
새 탭 열기
middle-click
우클릭 → 링크 주소 복사
```

클라이언트 `useState` 지연 초기화나 hydration 후 DOM href 보정에만 의존하지 않는다.

---

## 11. 기존 통계 데이터 보존

이번 작업은 링크 목적지 정책 변경이다.

아래 기존 데이터는 삭제/초기화하지 않는다.

```text
클릭 수
고유 방문 수
가입 시작 수
부모 가입 완료 수
attribution 이력
채널별 성과 데이터
```

기존 `link_id`를 유지하여 과거/향후 성과가 같은 링크 기준으로 이어지게 한다.

---

## 12. 대표 검증 대상

`direct_official_launch`의 관리자 `복사` 결과는 아래여야 한다.

```text
https://app.k-bestie.com/?link_id=direct_official_launch&utm_source=direct&utm_medium=personal&utm_campaign=official_launch
```

다른 기존 링크도 동일 규칙으로 확인한다.

---

## 13. 마이그레이션 안전성

DB update가 필요한 경우:

- 대상 레코드 조건 명시
- 일반 acquisition 링크만 update
- 적용 전 read-only 대상 수 확인
- 변경 전/후 건수 보고
- link_id/UTM 값 변경 금지
- 특수 링크 제외 건수 보고
- Production 전체 문자열 replace 금지

---

## 14. 테스트 시나리오

### Case A — 기존 링크 복사
`direct_official_launch` 복사 결과가 `/signup`이 아닌 `/`인지 확인.

### Case B — 신규 링크 생성
신규 일반 마케팅 링크 생성 후 pathname `/` 확인.

### Case C — 기존 외부 `/signup` URL
과거 링크 직접 접속 시 랜딩 `/`로 이동하고 query가 모두 유지되는지 확인.

### Case D — 랜딩 CTA
랜딩 → 시작하기 → OAuth → 신규 가입 완료까지 `link_id`/UTM 유지 확인.

### Case E — 기존 사용자
랜딩 → 시작하기 → OAuth → 기존 ACTIVE 사용자 로그인 시 오류/루프 없음.

### Case F — 특수 링크
가족 초대/보호자 초대/1회용 초대 링크의 기존 동작 유지.

---

## 15. 완료 조건

- 신규 일반 유입 링크 pathname `/`
- 기존 일반 유입 링크도 pathname `/`
- `direct_official_launch` 복사 결과 `/signup` 제거
- 기존 `link_id` 유지
- 기존 UTM 유지
- 기존 통계/attribution 데이터 유지
- 이미 외부 공유된 레거시 `/signup` 마케팅 URL도 랜딩으로 정상 유도
- 특수 초대/딥링크 영향 없음
- 랜딩 → 시작하기 → OAuth → 회원가입/로그인 attribution 유지
- 새 탭/middle-click/링크 주소 복사에서도 UTM 유지
- redirect loop 0
- TypeScript 오류 0
- Build 성공
- Dev E2E PASS
- Production smoke PASS

---

## 16. 완료 보고 형식

1. 기존 링크가 `/signup`으로 남아있던 정확한 원인
2. 기존 링크 저장 schema
3. 변경 대상 기존 레코드 수
4. 제외한 특수 링크 수/유형
5. DB migration/update 내용
6. 공통 URL builder 변경 내용
7. `direct_official_launch` 최종 복사 URL
8. 신규 링크 최종 복사 URL
9. 레거시 `/signup` URL redirect 검증
10. UTM/link_id 보존 검증
11. OAuth 이후 attribution 검증
12. 특수 초대 링크 회귀 테스트
13. TypeScript/Build
14. Dev E2E
15. Production 배포/Smoke 결과

---

## 17. 보안 주의

- Secret/API Key/Token 출력 금지
- 초대 token 평문 로그 금지
- Production key 하드코딩 금지
- 사용자 개인정보 로그 출력 금지
- migration 실행 전 대상 조건 확인
