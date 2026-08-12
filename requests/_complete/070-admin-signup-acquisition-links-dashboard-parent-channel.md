# Request: 관리자 회원가입 유입 링크 관리·유입 현황 대시보드·부모 계정 가입 채널 표시

## 1. 작업 목적

인스타그램, 유튜브, 네이버 카페, 카카오톡, 블로그, 광고, 지인 추천 등 다양한 채널에 서로 다른 회원가입 링크를 배포하고, 실제 부모 회원가입이 어느 채널에서 발생했는지 관리자에서 확인할 수 있도록 유입 추적 기능을 구현한다.

이번 작업 범위는 아래 3개다.

1. 관리자 페이지에 `회원가입 유입 링크 관리` 메뉴 추가
2. 관리자 페이지에 `회원가입 유입 현황` 메뉴와 채널별 전환 대시보드 추가
3. `사용자 관리 > 부모 계정 관리` 화면에 부모별 가입 채널 표시

단순 브라우저 referrer만 사용하지 않는다. 채널별 고유 `link_id`와 UTM 파라미터를 함께 사용하고, 최초 방문부터 부모 회원가입 완료까지 서버 기준으로 연결한다.

---

## 2. 확정 메뉴 구조

관리자 사이드바에 아래 그룹을 추가한다.

```text
회원가입 유입
├─ 유입 링크 관리
└─ 유입 현황
```

메뉴명:

```text
회원가입 유입 링크 관리
회원가입 유입 현황
```

권장 라우트:

```text
/admin/acquisition/links
/admin/acquisition/dashboard
```

기존 관리자 AdminShell, 모바일 드로어, 권한 검사, 공통 디자인 시스템을 그대로 사용한다.

---

## 3. 기본 추적 방식

채널별 링크는 아래 정보를 포함한다.

```text
link_id
utm_source
utm_medium
utm_campaign
utm_content
```

예시:

```text
https://app.k-bestie.com/signup?link_id=instagram_202608_launch&utm_source=instagram&utm_medium=social&utm_campaign=official_launch&utm_content=profile
```

### 필수 원칙

- `link_id`는 내부 고유 식별자
- UTM은 관리자 분석용 메타데이터
- referrer는 보조 정보
- 회원가입 완료 시 서버에서 부모 계정에 유입 정보를 연결
- 아이 계정에는 유입 정보를 직접 저장하지 않음
- 부모 계정을 기준으로 회원가입 전환을 계산
- QA·내부 테스트·관리자 생성 계정은 기본 통계에서 제외
- 기존 가입자는 `미확인/기존 가입자`로 표시

---

## 4. 어트리뷰션 기준

최초 유입과 최종 가입 유입을 모두 저장한다.

### First Touch

사용자가 내친구 케이에 최초로 방문한 채널이다.

```text
first_touch_link_id
first_touch_source
first_touch_medium
first_touch_campaign
first_touch_content
first_touch_at
```

### Signup Touch

실제로 부모 회원가입 완료 직전에 사용한 유입 채널이다.

```text
signup_link_id
signup_source
signup_medium
signup_campaign
signup_content
signup_touch_at
```

관리자 기본 채널 통계는 `signup_source` 기준으로 보여준다.

대시보드에서 First Touch와 Signup Touch를 전환해 조회할 수 있게 한다.

---

## 5. 어트리뷰션 유효 기간

권장 유효 기간:

```text
30일
```

동작:

- 최초 유입 정보는 30일 동안 유지
- 다른 채널 링크로 다시 방문하면 signup touch는 최신 채널로 갱신
- first touch는 최초 값 유지
- 직접 방문으로 다시 접속해도 기존 유효 채널을 즉시 지우지 않음
- 30일이 지나면 새 방문을 새로운 first touch로 처리할 수 있음

실제 구현은 보안 쿠키 또는 서버 세션을 우선 사용한다.

브라우저 localStorage만을 유일한 근거로 사용하지 않는다.

---

## 6. PWA·모바일 환경 대응

PWA 설치나 앱 재실행 과정에서 유입 정보가 유실되지 않게 한다.

필수 대응:

- 랜딩 시 서버 클릭 로그 저장
- 브라우저 쿠키 또는 안전한 세션 식별자 저장
- 회원가입 페이지 이동 시 link_id 유지
- OAuth 또는 외부 인증 리다이렉트 후에도 attribution_id 유지
- PWA 설치 후 회원가입하는 경우에도 가능한 범위에서 동일 방문 식별자를 연결
- 카카오톡·인스타그램 인앱 브라우저처럼 referrer가 없는 환경도 link_id로 추적
- QR 링크도 동일 구조로 추적

완전한 크로스디바이스 추적은 이번 범위에서 제외한다.

---

## 7. 회원가입 유입 링크 관리 화면

### 7.1 화면 제목

```text
회원가입 유입 링크 관리
```

설명:

```text
홍보 채널별 회원가입 링크를 생성하고 클릭·가입 성과를 관리합니다.
```

### 7.2 목록 컬럼

```text
채널명
link_id
Source
Medium
Campaign
Content
용도
회원가입 URL
상태
클릭 수
가입 완료 수
전환율
최근 가입일
액션
```

### 7.3 제공 기능

- 신규 링크 생성
- 링크 수정
- 활성·비활성 전환
- 링크 복사
- QR 코드 생성 또는 다운로드
- 링크 상세 보기
- 링크별 성과 확인
- 검색
- 채널 필터
- 캠페인 필터
- 활성 상태 필터
- 생성일 필터
- CSV/XLSX 다운로드
- 소프트 삭제
- 휴지통 복구

### 7.4 생성 폼

필수 입력:

```text
채널명
utm_source
utm_medium
utm_campaign
용도
```

선택 입력:

```text
utm_content
메모
시작일
종료일
```

자동 생성:

```text
link_id
회원가입 URL
```

`link_id`는 중복되지 않게 서버에서 생성한다.

예시:

```text
instagram_202608_launch_profile
youtube_202608_shorts_01
naver_cafe_202608_post_01
kakao_202608_direct_01
```

### 7.5 초기 채널 템플릿

다음 채널은 템플릿으로 제공할 수 있다.

```text
인스타그램
유튜브
블로그
Meta 광고
페이스북
카카오톡
카카오톡 오픈채팅방
네이버 카페
직접 공유
QR 오프라인
기타
```

기존 베타 모집 링크 관리 화면의 구조나 데이터를 재사용할 수 있는지 먼저 확인한다.

별도 베타 사이트 저장소에만 존재하는 기능이라면 임의 수정하지 말고, 메인 관리자 저장소에 새 기능으로 구현한다.

---

## 8. 링크 상태 정책

상태:

```text
ACTIVE
INACTIVE
EXPIRED
DELETED
```

실제 프로젝트의 enum 규칙에 맞춰 구현한다.

비활성 링크 접근 시:

- 회원가입 페이지 접근 자체는 허용할 수 있음
- 다만 해당 링크로 신규 유입 집계는 중단하거나 `비활성 링크 유입`으로 별도 기록
- 운영 정책을 코드에 명확히 반영

권장안:

```text
비활성 링크도 회원가입 페이지로 이동
단, 클릭 로그에는 inactive=true 기록
관리자 대시보드 기본 성과에는 제외
```

---

## 9. 유입 클릭 로그

링크 방문 시 서버에 클릭 이벤트를 저장한다.

필수 필드:

```text
id
link_id
visitor_id
occurred_at
landing_path
referrer
user_agent_category
device_category
is_internal_test
ip_hash
```

주의:

- 원본 IP를 장기 저장하지 않음
- 필요 시 단방향 hash 또는 비식별 처리
- user agent 원문 저장은 최소화하고 device category 수준으로 변환
- 개인정보 처리방침과 보존 정책을 확인
- 비밀정보 로그 출력 금지

### 클릭 수 정의

기본 KPI는 아래 두 가지를 구분한다.

```text
총 클릭 수
고유 방문자 수
```

고유 방문자는 `visitor_id + attribution window` 기준으로 계산한다.

단순 페이지 새로고침을 매번 새로운 고유 방문자로 계산하지 않는다.

---

## 10. 회원가입 퍼널 이벤트

최소 아래 이벤트를 기록한다.

```text
LINK_CLICK
SIGNUP_PAGE_VIEW
SIGNUP_STARTED
PARENT_SIGNUP_COMPLETED
CHILD_ADDED
```

선택적으로 추가:

```text
EMAIL_VERIFIED
FAMILY_CREATED
FIRST_CHILD_APPROVED
```

각 이벤트에는 아래 식별 정보를 연결한다.

```text
attribution_id
visitor_id
link_id
parent_user_id
occurred_at
```

회원가입 전에는 parent_user_id가 없어도 된다.

회원가입 완료 순간 기존 attribution_id를 부모 계정과 연결한다.

---

## 11. 회원가입 유입 현황 대시보드

### 11.1 화면 제목

```text
회원가입 유입 현황
```

설명:

```text
채널별 방문과 부모 회원가입 전환 성과를 확인합니다.
```

### 11.2 조회 기간

```text
오늘
최근 7일
최근 14일
최근 30일
이번 달
지난달
전체
사용자 지정
```

기준 시간대:

```text
Asia/Seoul
```

### 11.3 필터

- Attribution 기준: Signup Touch / First Touch
- 채널
- Source
- Medium
- Campaign
- Content
- 링크
- 내부 테스트 계정 포함·제외
- 활성·비활성 링크
- 기간

기본값:

```text
Signup Touch
내부 테스트 제외
최근 30일
```

### 11.4 상단 KPI 카드

```text
총 클릭 수
고유 방문자 수
회원가입 시작 수
부모 가입 완료 수
가입 전환율
아이 등록 수
부모 1명당 평균 아이 수
미확인 유입 가입 수
```

전환율 기본 계산:

```text
부모 가입 완료 수 / 고유 방문자 수 × 100
```

분모가 0이면 `-`로 표시한다.

### 11.5 핵심 차트

#### 채널별 부모 가입 수

가장 중요한 기본 차트다.

```text
X축: 채널
Y축: 부모 가입 완료 수
```

내림차순으로 정렬해 어느 채널에서 가장 많은 가입이 발생했는지 한눈에 보여준다.

#### 채널별 전환율

```text
X축: 채널
Y축: 가입 전환율
```

가입 수와 전환율을 혼합하지 말고 별도 차트로 표시한다.

#### 기간별 가입 추이

```text
일자별 부모 가입 완료 수
채널별 series 선택 가능
```

#### 퍼널

```text
링크 클릭
→ 회원가입 페이지 조회
→ 회원가입 시작
→ 부모 가입 완료
→ 아이 등록
```

### 11.6 채널별 성과 표

컬럼:

```text
채널
고유 방문자
가입 시작
부모 가입
아이 등록
가입 전환율
First Touch 가입
Signup Touch 가입
최근 가입일
```

정렬:

- 부모 가입 수
- 전환율
- 고유 방문자
- 최근 가입일

---

## 12. 미확인·직접 유입 처리

UTM과 link_id 없이 가입한 부모는 아래처럼 분류한다.

```text
직접/미확인
```

구분 가능하면 아래처럼 세분화한다.

```text
direct
organic_search
unknown
admin_created
legacy
```

기존 가입자는 기본적으로:

```text
기존 가입자 · 유입 정보 없음
```

으로 표시한다.

기존 가입자에게 유입 채널을 추정해 소급 입력하지 않는다.

관리자가 근거를 가지고 수동 지정할 수 있는 기능은 후속 범위로 둔다.

---

## 13. 부모 계정 관리 연동

`사용자 관리 > 부모 계정 관리`의 전체 부모 목록에 아래 열을 추가한다.

```text
가입 채널
```

권장 표시:

```text
카카오톡
kakao / referral
```

또는:

```text
인스타그램
instagram · official_launch
```

기본 표시 기준은 `Signup Touch`다.

유입 정보가 없으면:

```text
미확인
```

기존 가입자는:

```text
기존 가입자
```

관리자 생성 계정은:

```text
관리자 생성
```

QA 계정은:

```text
내부 테스트
```

### 부모 목록 검색·필터 추가

- 가입 채널
- Source
- Medium
- Campaign
- 유입 정보 있음·없음
- 내부 테스트 포함·제외

### 부모 상세 화면

아래 섹션을 추가한다.

```text
회원가입 유입 정보
```

표시 항목:

```text
최초 유입 채널
최초 유입 링크
최초 방문일
가입 완료 채널
가입 완료 링크
가입 완료일
Source
Medium
Campaign
Content
Referrer 요약
Attribution 상태
```

원본 IP, 전체 user agent, 민감정보는 표시하지 않는다.

### 유입 현황에서 부모 목록 연결

대시보드의 채널 또는 가입 수를 클릭하면 해당 채널로 가입한 부모 목록으로 이동한다.

예시:

```text
/admin/users/parents?signup_source=kakao
```

---

## 14. 부모 계정 저장 구조

부모 프로필 테이블에 모든 UTM 필드를 직접 중복 저장하기보다 별도 attribution 테이블을 권장한다.

권장 테이블 예시:

```text
acquisition_links
acquisition_visits
acquisition_events
parent_attributions
```

### acquisition_links

```text
id
link_id
channel_name
utm_source
utm_medium
utm_campaign
utm_content
purpose
destination_path
status
starts_at
ends_at
created_at
created_by
updated_at
deleted_at
deleted_by
delete_reason
```

### parent_attributions

```text
parent_user_id
first_touch_link_id
first_touch_at
signup_link_id
signup_touch_at
attribution_window_days
created_at
updated_at
```

실제 DB 구조와 기존 이벤트 시스템을 먼저 확인한다.

이미 유사 테이블 또는 UTM 컬럼이 있으면 중복 생성하지 않고 재사용한다.

---

## 15. 중복 및 멱등성

- 같은 클릭 이벤트의 중복 저장 방지
- 같은 회원가입 완료 이벤트 중복 집계 방지
- 부모 1명은 부모 가입 완료 수에서 1회만 계산
- 회원가입 재시도나 페이지 새로고침으로 가입 완료가 중복 증가하지 않음
- link_id가 변조돼도 존재하지 않는 링크는 unknown으로 처리
- 링크 삭제 후 기존 attribution 관계는 보존
- 부모 탈퇴 후 재가입 정책은 기존 계정 정책 확인 후 처리

권장 고유 기준:

```text
event_type + parent_user_id
```

`PARENT_SIGNUP_COMPLETED`는 부모당 1건만 유효 집계한다.

---

## 16. 내부 테스트 계정 제외

기존 관리자 리텐션과 사용자 관리에서 사용하는 내부 테스트 계정 기준을 재사용한다.

기본 대시보드에서 제외:

- QA 부모
- QA 아이
- 내부 테스트 가족
- 관리자 생성 테스트 계정
- 자동화 E2E 계정

필터에서 `내부 테스트 포함`을 선택하면 별도로 확인 가능하게 한다.

---

## 17. 기존 사용자·기존 링크 호환

### 기존 부모

- 가입 유입 정보가 없으면 `기존 가입자` 표시
- 임의 source 추정 금지
- 통계의 `미확인/기존 가입자`에 포함 여부를 필터로 구분

### 기존 베타 링크

기존 베타 모집 링크와 UTM 데이터가 있다면 다음을 확인한다.

- 실제 정식 회원가입으로 연결됐는지
- 별도 베타 DB에만 저장됐는지
- 메인 앱 부모 계정과 연결 가능한 식별자가 있는지

연결 근거가 없으면 과거 데이터 소급 연결 금지.

새 정식 회원가입 유입 기능은 `app.k-bestie.com/signup` 기준으로 시작한다.

---

## 18. 공개 회원가입 URL

기본 목적지는 실제 Production 회원가입 경로를 확인한 후 사용한다.

예시:

```text
https://app.k-bestie.com/signup
```

현재 회원가입 라우트가 다르면 실제 라우트를 사용한다.

잘못된 경로를 하드코딩하지 않는다.

Development와 Production 도메인을 환경별로 분리한다.

---

## 19. API 요구사항

권장 예시:

```text
GET  /api/admin/acquisition/links
POST /api/admin/acquisition/links
PATCH /api/admin/acquisition/links/:id
DELETE /api/admin/acquisition/links/:id

GET /api/admin/acquisition/dashboard
GET /api/admin/acquisition/channels
GET /api/admin/acquisition/parents

POST /api/acquisition/click
POST /api/acquisition/event
```

실제 프로젝트 구조에 맞춰 구현한다.

### 공개 클릭·이벤트 API 보안

- 입력값 allowlist 검증
- 존재하지 않는 link_id 처리
- rate limit
- request size 제한
- bot·preview crawler 구분 가능하면 기록
- Service Role Key 클라이언트 노출 금지
- 원본 IP 로그 출력 금지
- 광고성 파라미터를 SQL에 직접 연결하지 않음

### 관리자 API 보안

- 관리자 인증
- 관리자 권한 검사
- 다운로드 감사 로그
- 소프트 삭제 정책
- 비밀정보 출력 금지

---

## 20. Bot·미리보기 트래픽

카카오톡, 페이스북, 검색엔진 등의 링크 미리보기 요청이 클릭 수를 부풀릴 수 있다.

가능한 경우 아래를 구분한다.

```text
human
bot
preview
unknown
```

관리자 기본 KPI는 human 트래픽 기준으로 표시한다.

구분이 불가능한 경우 `전체 요청`과 `분석 대상 클릭`을 분리한다.

---

## 21. 소프트 삭제 및 휴지통 연동

유입 링크는 기존 관리자 운영 데이터 소프트 삭제 정책을 적용한다.

- 물리 삭제 금지
- deleted_at
- deleted_by
- delete_reason
- 일반 목록에서 숨김
- 관리자 휴지통에서 30일 이내 복구
- 감사 로그 기록

링크를 삭제해도 기존 클릭·가입 attribution 기록은 보존한다.

---

## 22. 감사 로그

관리자 링크 생성·수정·비활성·삭제·복구·다운로드를 감사 로그에 기록한다.

필수 action 예시:

```text
ACQUISITION_LINK_CREATE
ACQUISITION_LINK_UPDATE
ACQUISITION_LINK_ACTIVATE
ACQUISITION_LINK_DEACTIVATE
ACQUISITION_LINK_SOFT_DELETE
ACQUISITION_LINK_RESTORE
ACQUISITION_EXPORT
```

민감정보, Token, Cookie 원문, IP 원문을 감사 로그에 저장하지 않는다.

---

## 23. 개인정보 및 보존 정책

- 유입 정보는 부모 회원가입 성과 분석 목적으로만 사용
- 아이 대화·미션·리포트 데이터와 결합하지 않음
- 원본 IP 장기 저장 금지
- visitor_id는 비식별 랜덤 식별자 사용
- Cookie 배너 또는 개인정보 처리방침 반영 필요 여부 검토
- 광고 추적 도구를 새로 도입하는 경우 별도 동의 필요 여부 확인
- 이번 작업에서는 외부 광고 SDK를 임의 추가하지 않음
- 자체 first-party attribution을 우선 구현

---

## 24. 화면 UX 기준

### 유입 링크 관리

- 링크 복사 성공 토스트
- QR 코드 미리보기
- 긴 URL 말줄임
- 상세 보기에서 전체 URL 제공
- 링크 상태 배지
- 클릭·가입·전환율 숫자 정렬
- 모바일 카드형 또는 가로 스크롤

### 유입 현황

- 가장 많은 가입 채널을 상단에서 강조
- 가입 수와 전환율을 별도 지표로 표시
- 차트 hover에 정확한 수치 표시
- 차트와 표의 합계 일치
- 빈 데이터 안내
- 기간 변경 시 로딩 상태
- 모바일에서도 KPI·차트·표 확인 가능

---

## 25. 테스트 요구사항

### 25.1 링크 생성

- 링크 생성
- link_id 중복 방지
- URL 생성
- 복사
- 비활성화
- 소프트 삭제
- 휴지통 복구

### 25.2 유입 추적

다음 채널별 QA 링크를 만든다.

```text
instagram
youtube
naver_cafe
kakao
direct
```

각 링크로 아래를 검증한다.

1. 링크 클릭
2. 방문 로그 생성
3. 회원가입 페이지 조회
4. 회원가입 시작
5. QA 부모 가입 완료
6. parent attribution 연결
7. 대시보드 가입 수 증가
8. 부모 계정 관리의 가입 채널 표시
9. 채널 클릭 시 해당 부모 목록 이동

### 25.3 First Touch·Signup Touch

예시 시나리오:

```text
첫 방문: instagram
최종 가입 방문: kakao
```

기대 결과:

```text
First Touch = instagram
Signup Touch = kakao
```

### 25.4 중복 검증

- 새로고침 반복
- 동일 링크 재클릭
- 회원가입 완료 API 재호출
- 브라우저 뒤로가기
- OAuth 리다이렉트
- PWA 설치 후 진입

부모 가입 완료 수가 중복 증가하지 않아야 한다.

### 25.5 내부 테스트 제외

- 기본 대시보드에서 QA 가입 제외
- `내부 테스트 포함` 선택 시 표시
- 실제 가입 통계와 테스트 통계 분리

---

## 26. Production 검증

Production 검증은 QA 부모 계정으로만 수행한다.

- 실제 부모 계정 신규 생성 금지
- 실제 사용자 유입 정보 변경 금지
- QA 검증 링크에 `internal_test=true` 또는 내부 테스트 식별 적용
- 검증 후 QA 데이터가 기본 통계에서 제외되는지 확인
- Production 도메인 회원가입 URL 확인
- 카카오톡·모바일 브라우저에서 링크 유지 확인

---

## 27. 완료 조건

아래 조건을 모두 만족해야 완료로 보고한다.

- 관리자 `회원가입 유입` 그룹 추가
- `유입 링크 관리` 메뉴 추가
- `유입 현황` 메뉴 추가
- 채널별 회원가입 링크 생성·복사 가능
- link_id + UTM 구조 적용
- 클릭 로그 저장
- 회원가입 퍼널 이벤트 저장
- 부모 가입 완료와 attribution 연결
- First Touch 저장
- Signup Touch 저장
- 채널별 가입 수 대시보드 제공
- 채널별 전환율 제공
- 가입 추이·퍼널 제공
- 부모 계정 관리에 `가입 채널` 표시
- 부모 상세에 유입 정보 표시
- 대시보드에서 부모 목록 드릴다운 가능
- 내부 테스트 기본 제외
- 기존 가입자 `기존 가입자/미확인` 처리
- 중복 가입 집계 0건
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production QA 스모크 테스트 PASS
- 비밀정보 노출 0건

---

## 28. 완료 보고 형식

완료 후 아래 내용을 보고한다.

1. 기존 UTM·링크·유입 관련 코드와 DB 감사 결과
2. 실제 회원가입 Production 라우트
3. 추가한 관리자 메뉴와 라우트
4. 추가·수정한 DB 테이블과 migration
5. link_id 생성 규칙
6. First Touch·Signup Touch 저장 방식
7. 30일 attribution 유지 방식
8. 클릭·고유 방문자·가입 수 정의
9. 내부 테스트 제외 방식
10. 부모 계정 관리 연동 결과
11. 대표 채널별 QA 결과
12. 중복·멱등성 테스트 결과
13. PWA·카카오톡 인앱 브라우저 테스트 결과
14. TypeScript·Build 결과
15. Dev E2E 결과
16. Production 배포 커밋
17. Production Deployment ID와 READY 상태
18. Production 스모크 테스트 결과
19. 개인정보·보존 관련 남은 확인 사항
20. 미완료 또는 남은 위험

---

## 29. 보안 및 작업 제한

- Production Service Role Key 평문 하드코딩 금지
- API Key, 비밀번호, Token, Cookie 로그 출력 금지
- Secret 임시 파일 저장 금지
- 원본 IP 장기 저장 금지
- 부모·아이 개인정보를 유입 로그에 중복 저장 금지
- 아이 대화·미션·리포트와 유입 데이터 결합 금지
- 외부 광고 SDK 임의 도입 금지
- 기존 부모 유입 채널 임의 추정 금지
- 실제 사용자 계정으로 Production 테스트 금지
- 기존 베타 신청 DB 또는 별도 저장소 임의 수정 금지
