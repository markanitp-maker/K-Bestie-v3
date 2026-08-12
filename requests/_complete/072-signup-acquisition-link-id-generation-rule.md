# Request: 회원가입 유입 링크 `link_id` 생성 규칙 수정

## 1. 작업 목적

현재 관리자 `회원가입 유입 링크 관리`에서 신규 링크를 생성할 때 관리자 표시용 `채널명`이 `link_id`에 포함되어 한글이 들어가는 문제가 있다.

예시:

```text
카카오톡프로필_202608_kprofile_sokj
```

`채널명`은 관리자 화면 표시용 값이고, `link_id`는 URL·DB·로그·가입 유입 연결에 사용되는 시스템 식별자이므로 서로 분리해야 한다.

앞으로 `link_id`에는 채널명을 포함하지 않고, 영문 소문자·숫자·언더스코어만 사용하도록 수정한다.

## 2. 확정 생성 규칙

```text
link_id = utm_source + "_" + utm_campaign + "_" + random_suffix
```

예시:

```text
kakao_official_launch_a7f3
instagram_official_launch_b2k9
naver_cafe_official_launch_m4x1
youtube_official_launch_q8d2
direct_official_launch_z3p6
```

허용 정규식:

```regex
^[a-z0-9_]+$
```

허용:
- 영문 소문자
- 숫자
- 언더스코어 `_`

금지:
- 한글
- 공백
- 대문자
- 하이픈
- 특수문자
- 이모지

## 3. 채널명과 link_id 분리

채널명은 관리자 UI 표시용으로만 사용한다.

예시:

```text
카카오톡 프로필
인스타그램
네이버 카페
직접 공유
```

`link_id`는 시스템 식별자로만 사용한다.

예시:

```text
kakao_official_launch_a7f3
instagram_official_launch_b2k9
naver_cafe_official_launch_m4x1
direct_official_launch_z3p6
```

채널명을 `link_id` 생성 입력값으로 사용하지 않는다.

## 4. 생성 위치

`link_id`는 클라이언트에서 만들지 말고 서버에서 생성한다.

필수 조건:

- 클라이언트가 임의 `link_id`를 전달해도 그대로 신뢰하지 않음
- 서버에서 `utm_source`, `utm_campaign` 정규화
- 랜덤 suffix 생성
- 중복 검사
- DB unique 제약 또는 재시도 로직 적용
- 생성 완료 후 최종 `link_id` 반환

## 5. 정규화 규칙

예시:

```text
Instagram Ads
→ instagram_ads

Official Launch
→ official_launch
```

정규화 기준:

- 소문자 변환
- 공백은 `_`로 변환
- 연속 `_`는 하나로 축소
- 앞뒤 `_` 제거
- 허용되지 않은 문자는 제거
- 빈 값이 되면 생성 실패

기존 `utm_source`, `utm_campaign` 원본 데이터는 변경하지 않고, `link_id` 생성용 정규화 값만 사용할 수 있다.

## 6. 랜덤 suffix

- 4~6자리
- 허용 문자: `a-z`, `0-9`
- 충돌 시 재생성
- 최대 재시도 횟수 지정

예시:

```text
a7f3
b2k9
m4x1
```

## 7. 중복 방지

- `link_id` unique index 또는 unique constraint 적용 검토
- insert 충돌 시 suffix 재생성
- 동일 `utm_source + utm_campaign` 조합으로 여러 링크 생성 가능

예시:

```text
instagram_official_launch_a7f3
instagram_official_launch_b2k9
```

## 8. 기존 한글 link_id 처리

기존 한글 `link_id`는 즉시 일괄 변경하지 않는다.

먼저 아래 의존성을 읽기 전용으로 점검한다.

- 클릭 로그
- 회원가입 유입 이벤트
- 부모 attribution
- 관리자 통계
- 이미 외부에 배포된 홍보 URL
- QR 코드
- 복사된 링크
- redirect 또는 alias
- 관련 API·RPC·foreign key

### 사용되지 않은 링크

아래 조건을 모두 만족하면 새 규칙으로 재생성 가능하다.

- 클릭 수 0
- 가입 수 0
- 외부 배포 증거 없음
- attribution 연결 없음
- QA 또는 테스트 링크임이 확인됨

### 이미 사용된 링크

기존 `link_id`를 변경하지 않는다.

변경이 필요하면:

- 기존 link_id alias 유지
- 기존 URL redirect 유지
- 클릭·가입 attribution 보존
- 기존 통계 보존
- 마이그레이션 전 대상 건수와 영향 범위 보고

## 9. 관리자 UI 변경

신규 링크 생성 모달에서 `link_id` 직접 입력란은 제공하지 않는다.

입력 항목:

```text
채널명
utm_source
utm_medium
utm_campaign
용도
```

생성 후 결과 영역에 서버가 생성한 `link_id`를 표시한다.

예시:

```text
생성된 link_id
kakao_official_launch_a7f3
```

## 10. URL 생성

실제 회원가입 URL은 서버에서 생성된 `link_id`를 사용한다.

예시:

```text
https://app.k-bestie.com/signup?link_id=kakao_official_launch_a7f3&utm_source=kakao&utm_medium=social&utm_campaign=official_launch
```

주의:

- 실제 Production 회원가입 라우트 확인
- Development와 Production 도메인 분리
- 추측 경로 하드코딩 금지
- URL 인코딩 정상 처리
- 한글 `link_id` 생성 0건 보장

## 11. DB 요구사항

실제 링크 테이블의 `link_id`에 unique 제약이 없으면 추가를 검토한다.

예시:

```sql
create unique index if not exists idx_acquisition_links_link_id
on acquisition_links (link_id)
where deleted_at is null;
```

실제 테이블과 soft-delete 정책을 확인한 뒤 적용한다.

기존 pending migration 전체를 일괄 적용하지 않는다.

## 12. API 검증

신규 링크 생성 API는 아래를 검증한다.

- `utm_source` 필수
- `utm_campaign` 필수
- 정규화 후 빈 값 금지
- 생성된 `link_id` 정규식 검증
- 중복 검사
- 관리자 인증·권한
- Service Role Key 클라이언트 노출 금지
- 민감정보 로그 출력 금지

## 13. 테스트 요구사항

### 단위 테스트

- 한글 채널명
- 영문 source
- 공백 포함 campaign
- 특수문자
- 대문자
- 동일 source·campaign 중복 생성
- suffix 충돌 재시도
- 빈 source
- 빈 campaign
- 정규화 후 빈 문자열

예시 입력:

```text
채널명: 카카오톡 프로필
utm_source: Kakao Profile
utm_campaign: Official Launch
```

기대 결과:

```text
kakao_profile_official_launch_xxxx
```

`link_id`에 한글이 없어야 한다.

### E2E 테스트

Dev에서 신규 링크 최소 5건 생성:

```text
instagram
youtube
kakao
naver_cafe
direct
```

검증:

- 한글 link_id 0건
- 중복 link_id 0건
- URL 정상 생성
- 링크 복사 정상
- 클릭 로그 정상
- 가입 attribution 정상
- 관리자 목록 표시 정상

## 14. Production 적용

Production에서는 QA용 링크로만 검증한다.

- 실제 홍보 중인 링크 수정·삭제 금지
- 신규 생성 link_id 정규식 통과
- 한글 미포함
- 클릭 로그 연결
- 회원가입 URL 정상
- 기존 링크 영향 없음
- 기존 가입 attribution 영향 없음

## 15. 완료 조건

- 채널명과 link_id 생성 로직 분리
- 채널명 미포함
- 서버 생성
- `[a-z0-9_]`만 허용
- 랜덤 suffix 적용
- unique 충돌 방지
- 기존 한글 link_id 영향 감사
- 사용되지 않은 테스트 링크만 안전하게 재생성
- 사용 중 링크 보존
- Dev 신규 5건 테스트 PASS
- Production QA 스모크 테스트 PASS
- TypeScript 오류 0건
- Build 성공
- 비밀정보 노출 0건

## 16. 완료 보고 형식

1. 기존 link_id 생성 로직
2. 한글이 포함된 정확한 원인
3. 변경한 생성 규칙
4. 정규화 함수
5. 랜덤 suffix 규칙
6. 중복 방지 방식
7. 수정·추가한 파일
8. DB migration 또는 unique 제약
9. 기존 한글 link_id 건수
10. 기존 링크 사용 여부 감사 결과
11. 재생성한 테스트 링크
12. 보존한 운영 링크
13. Dev 테스트 결과
14. Production 배포 커밋
15. Production Deployment ID와 READY 상태
16. Production 스모크 테스트 결과
17. 미완료 또는 남은 위험

## 17. 보안 및 작업 제한

- Production Service Role Key 평문 하드코딩 금지
- API Key, 비밀번호, Token 로그 출력 금지
- Secret 임시 파일 저장 금지
- 기존 운영 link_id 무단 변경 금지
- 클릭·가입 attribution 삭제 금지
- 외부 배포 URL을 확인 없이 변경 금지
- 클라이언트 생성 link_id 신뢰 금지
