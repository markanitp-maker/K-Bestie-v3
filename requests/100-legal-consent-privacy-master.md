# 내친구 케이 Legal Master
# 서비스 이용약관 · 개인정보 동의 · 법정대리인 동의 · 개인정보 처리방침 · Legal Modal 통합 구현

## 0. Request 목적

내친구 케이(K-Bestie)의 회원가입, 아이 등록, 아이 시작하기, 설정 화면에서 사용되는 모든 약관·개인정보 동의·법정대리인 동의·개인정보 처리방침을 하나의 Legal Document System으로 통합한다.

이번 작업은 단순 UI 모달 추가가 아니다.

다음 전체 범위를 하나의 정책·문서·UI·동의이력 체계로 완성한다.

1. 서비스 이용약관
2. 보호자 개인정보 수집·이용 안내/동의
3. 아이 개인정보 수집·이용 동의
4. 만 14세 미만 아동의 법정대리인 동의
5. 법정대리인 또는 적법한 동의권한 보유 확인
6. 마케팅 정보 수신 동의(선택)
7. 이벤트·혜택 알림 동의(선택)
8. 개인정보 처리방침
9. 공통 Legal 상세보기 Modal
10. Legal Document Registry
11. 문서 version 관리
12. 기존 signup_consents 연동
13. /privacy 공개 문서
14. /terms 공개 문서
15. 아이 등록/아이 시작하기의 법정대리인 상세보기
16. 기존 회원가입 상태머신 비파괴
17. 모바일 Legal UX
18. Production 공개 승인 Gate

캐치시큐는 문서 항목 및 구조 검증용 참고자료로만 사용한다.

Catchsecu URL 또는 iframe에 런타임 의존하지 않는다.

최종 사용자에게 제공되는 Legal 문서는 K-Bestie-v3 내부의 단일 Source of Truth에서 직접 렌더링한다.

참고 Catchsecu 문서:
https://app.catchsecu.com/document/P/115a5c5cd3a915f

---

# 1. 구현 기준 사실 — 2026-08-11 READ-ONLY 감사 결과

이 아래 사실은 추측하지 말고 현재 구현 기준으로 사용한다.

## 1.1 회원가입 Legal UI

구현 위치:

`app/signup/page.tsx`

현재 consent_type 7개:

필수:
- `service_terms`
- `parent_pii`
- `child_pii`
- `guardian_u14`
- `guardian_authority`

선택:
- `marketing`
- `event_notice`

현재 필수 5개 모두 `agreed === true`일 때 다음 버튼이 활성화된다.

이 구조를 변경하지 않는다.

---

# 2. 기존 동의 DB 구조 — 반드시 재사용

현재:

`public.signup_consents`

주요 컬럼:

- id
- user_id
- consent_type
- document_version
- agreed
- agreed_at
- withdrawn_at
- ip_address
- user_agent
- auth_method
- is_reconsent

현재 동일 active 동의 중복 방지:

`(user_id, consent_type, document_version) WHERE withdrawn_at IS NULL`

현재 RPC:

`record_user_signup_consents(...)`

Advisory Lock 기반 멱등/원자 저장 구조가 이미 존재한다.

## 금지

이번 Legal UI 구현을 이유로 새로운 consent 테이블을 만들지 않는다.

DB migration을 만들지 않는다.

기존 RPC와 signup_consents 구조를 우선 재사용한다.

단, 구현 과정에서 기존 구조만으로 반드시 필요한 요건을 표현할 수 없다는 사실이 확인되면 임의 migration을 만들지 말고 BLOCKED로 보고한다.

---

# 3. 현재 Legal 문서 버전

현재 코드:

`lib/plan/consentDocument.ts`

현재 version:

`2026-07-16`

신규 Legal Master 후보 version은 기존 날짜 기반 convention을 유지하여:

`2026-08-11`

을 Dev 후보로 사용한다.

단:

Production active version 변경 및 기존 사용자 재동의 활성화는 대표님 최종 승인 전 금지한다.

문서 내용만 변경되었다고 기존 사용자의 document_version을 덮어쓰지 않는다.

---

# 4. 실제 보호자 개인정보

2026-08-11 감사 기준 실제 수집/저장:

- 이름
- 이메일
- 자녀와의 관계
- 법정대리인 확인일시
- 이메일 가입 시 비밀번호
- 인증 방식에 필요한 Auth 정보

현재 미수집:

- 휴대전화번호
- 주소
- 생년월일

Legal 문서에 현재 미수집 필드를 임의 추가하지 않는다.

---

# 5. 실제 아이 개인정보

현재 실제 수집/저장:

- 성
- 이름
- 로그인 아이디
- 비밀번호
- 학년
- 성별
- 보호자-자녀 연결정보
- 내부 child 식별정보
- 서비스 이용 과정에서 생성되는 대화 데이터

현재 미수집:

- 관심사
- 생년월일
- 이메일
- 휴대전화번호

특히 `관심사`는 UI/API에서 완전히 제거된 상태다.

Legal 문서 어디에도 관심사를 다시 추가하지 않는다.

---

# 6. 실제 대화 데이터 처리 정책

## 음성 원본

현재 코드 기준:

- 저장하지 않음
- 음성 처리 과정에서 실시간 전달
- 음성 원본 보존기간 0초
- 처리 목적 달성 후 즉시 폐기

Legal 표현에서도:

`음성 원본을 별도 저장하지 않는다`

를 기준으로 한다.

---

## raw conversation

테이블:

`raw_daily_conversations_v3`

보존:

7일

실제 hard delete 배치가 존재한다.

---

## corrected conversation

테이블:

`corrected_daily_conversations_v3`

보존:

7일

raw retention과 연동하여 삭제된다.

---

# 7. 리포트·요약 인사이트 Retention 정책

대표 확정 정책:

## Care Start

6개월

## Care Insight

기본 3년

기존 연장팩 정책이 있는 경우 실제 extension 값을 적용한다.

## Care Premium

기본 5년

사용자가 `무제한 보존`을 선택할 수 있어야 한다.

---

# 8. Retention 구현 Dependency

2026-08-11 감사 결과:

- Care Start 6개월 계산/조회 제한: 구현됨
- Care Insight 기본 3년 계산/조회 제한: 구현됨
- Care Premium 기본 5년 계산/조회 제한: 구현됨
- Premium Unlimited: 기존 구현 없음
- 리포트 기간 만료 후 물리 hard delete: 별도 보완 작업 진행 중

Retention 보완은 별도 Claude Code 작업이다.

따라서 이번 Legal Request는 위 확정 정책 기준으로 문서를 작성한다.

단 다음 조건을 Production Legal 공개 Gate로 둔다.

### RELEASE BLOCKER

Retention 별도 작업이 다음을 PASS하기 전:

- Start 6개월 실제 파기
- Insight 3년/연장기간 실제 파기
- Premium 기본 5년 실제 파기
- Premium Unlimited 실제 파기 제외
- raw/corrected 7일 비간섭
- 회원탈퇴 30일 Purge 비간섭

신규 개인정보 처리방침과 신규 consent version을 Production에서 활성화하지 않는다.

Dev 구현 및 문서 QA는 진행 가능하다.

---

# 9. 회원탈퇴 정책

현재 실제 구현을 문서 기준으로 사용한다.

탈퇴 신청 즉시 hard delete가 아니다.

정책:

1. 회원탈퇴 신청
2. 계정 `WITHDRAWN_PENDING`
3. 30일 유예
4. 30일 경과 후 account-purge
5. 계정 및 관련 개인정보 영구 파기

따라서 Legal 문서에서:

`회원탈퇴 즉시 전체 파기`

라고 쓰지 않는다.

다음 기준을 사용한다.

`회원탈퇴 신청 후 30일의 유예기간을 두며, 유예기간 경과 후 관련 개인정보를 영구 파기합니다. 관계 법령에 따라 별도 보존이 필요한 정보가 있는 경우 해당 법령에서 정한 기간 동안 보존할 수 있습니다.`

---

# 10. 실제 외부 개인정보 처리업체

2026-08-11 감사 기준 실제 사용:

1. Supabase
2. Vercel
3. Google 계열 서비스

현재 미사용:

- ElevenLabs
- Microsoft Outlook

따라서 신규 개인정보 처리방침에서 ElevenLabs와 Microsoft Outlook을 제거한다.

---

# 11. Supabase 실제 역할

Supabase 사용 목적:

- Auth
- 데이터베이스
- 서비스 데이터 저장
- 사용자/아이 계정 데이터
- 대화 및 리포트 데이터

실제 처리될 수 있는 데이터:

- 보호자 이메일
- 인증정보
- 아이 성명
- 학년
- 성별
- 내부 식별정보
- 보호자-자녀 연결정보
- 대화 텍스트
- 리포트/메모리 데이터
- 기타 실제 DB에 저장되는 서비스 데이터

비밀번호는 평문 저장으로 표현하지 않는다.

Supabase Auth에서 안전하게 처리되는 인증정보로 표현한다.

---

# 12. Vercel 실제 역할

Vercel:

- 웹 애플리케이션 호스팅
- 배포
- Serverless / API Runtime
- 요청 처리
- 운영 로그

Vercel을 통해 API request payload가 실시간 경유할 수 있다.

따라서 단순:

`회원 내부 식별값 / 접속기록`

만 처리한다고 제한적으로 기술하지 않는다.

실제 runtime을 경유하는:

- 계정 식별정보
- 서비스 요청 데이터
- 필요한 경우 대화 텍스트
- 요청/접속 관련 정보

등을 실제 코드 흐름 기준으로 표현한다.

Vercel 영구저장과 Vercel runtime 경유는 구분해서 문서화한다.

---

# 13. Google 실제 역할

현재 실제 사용:

- Gemini
- Google Cloud STT
- 기타 현재 코드에서 확인된 Google AI 호출

실제 처리:

- 대화 텍스트
- AI 요청 Context
- 음성 바이너리 스트림
- 음성 인식 결과 생성

음성 원본은 K-Bestie 서버에 별도 저장하지 않는다.

---

# 14. 맞춤형 광고 정책

2026-08-11 감사 결과:

맞춤형 광고/광고 타겟팅 코드:

`없음`

따라서 Catchsecu 자동문구:

`온라인 맞춤형 광고 등을 제공하기 위하여 행태정보를 수집·이용합니다.`

사용 금지.

개인정보 처리방침에는:

`회사는 온라인 맞춤형 광고 제공을 목적으로 이용자의 행태정보를 수집·이용하지 않습니다.`

를 기준으로 한다.

인증/서비스 기능/보안/품질 개선을 위한 cookie 또는 이용기록은 실제 코드 기준으로 별도 설명한다.

---

# 15. 법정대리인 확인 방식

실제 구현:

- 보호자 본인 계정으로 회원가입
- 보호자 정보 입력
- 자녀와의 관계 입력
- 회원가입 과정의 명시적 법정대리인 체크박스
- 법정대리인 확인시각 저장

실제 사용하지 않는:

- 카드인증
- FAX
- 전화 동의
- SMS 동의 확인
- 우편 동의

등을 Legal 문서에 일반 예시로 나열하지 않는다.

실제 서비스 방식만 설명한다.

---

# 16. 서비스 이용약관

Document key:

`service_terms`

제목:

`내친구 케이 서비스 이용약관`

다음 구조로 작성한다.

## 제1조 목적

본 약관은 이지웨이가 제공하는 내친구 케이 서비스의 이용조건, 회사와 이용자의 권리·의무 및 서비스 이용에 관한 기본 사항을 정한다.

## 제2조 서비스의 성격

내친구 케이는 아이가 AI 친구와 대화하고, 해당 대화를 바탕으로 보호자가 아이의 일상과 관심 흐름을 이해하고 대화를 시작할 수 있도록 돕는 부모-자녀 소통 지원 서비스다.

내친구 케이는 의료, 심리 진단 또는 치료를 제공하는 서비스가 아니다.

아이를 감시·통제·평가하기 위한 서비스로 운영하지 않는다.

## 제3조 이용자

보호자 계정과 보호자가 등록한 아이 계정을 기준으로 서비스를 제공한다.

만 14세 미만 아동의 서비스 이용에는 필요한 법정대리인 동의 절차를 적용한다.

## 제4조 계정

이용자는 정확한 정보를 제공해야 한다.

아이 로그인 정보와 보호자 계정을 타인에게 부정하게 제공하거나 양도해서는 안 된다.

## 제5조 서비스 제공

서비스에는 다음 기능이 포함될 수 있다.

- 케이와의 AI 대화
- 미션 및 자유대화
- 부모용 리포트
- 부모-케이 질의
- 놀이 및 이벤트
- 알림 기능
- 기타 회사가 제공하는 부가기능

기능의 구체적 구성은 서비스 업데이트에 따라 변경될 수 있다.

## 제6조 AI 서비스 특성

AI가 생성한 결과는 항상 정확하거나 완전하다고 보장되지 않는다.

부모용 리포트와 대화 가이드는 부모-자녀 대화를 돕기 위한 참고정보이다.

의료·심리·법률 등 전문적인 판단을 대체하지 않는다.

## 제7조 아이 대화 데이터

아이와 케이의 대화 데이터는 서비스 제공과 리포트 생성에 필요한 범위에서 처리한다.

처리와 보존에 관한 구체적인 사항은 개인정보 처리방침 및 아이 개인정보 수집·이용 동의서에서 확인할 수 있다.

## 제8조 이용자의 의무

서비스 부정사용, 타인 계정 도용, 시스템 공격, 불법적 콘텐츠 생성 등 서비스 운영을 방해하는 행위를 금지한다.

## 제9조 서비스 변경 및 중단

안정적 서비스 운영, 점검, 보안, 기술적 사유 등으로 기능이 변경·중단될 수 있다.

중대한 변경은 가능한 범위에서 사전 안내한다.

## 제10조 회원탈퇴

회원은 서비스에서 제공하는 방법으로 탈퇴를 신청할 수 있다.

탈퇴 신청 후 30일 유예기간을 두며, 유예기간 경과 후 계정과 관련 데이터를 영구 파기한다.

## 제11조 지식재산권

서비스의 UI, 브랜드, 콘텐츠 및 시스템에 관한 권리는 회사 또는 정당한 권리자에게 귀속된다.

이용자가 직접 생성한 콘텐츠의 권리는 관련 법령과 별도 정책에 따른다.

## 제12조 책임

회사는 합리적인 수준에서 안정적인 서비스를 제공하기 위해 노력한다.

이용자의 귀책사유 또는 회사가 합리적으로 통제하기 어려운 사유로 발생한 장애 등에 대해서는 관련 법령에서 정한 범위 내에서 책임을 부담한다.

## 제13조 약관 변경

약관 변경 시 시행일과 변경내용을 서비스 또는 적절한 방법으로 안내한다.

## 제14조 문의

서비스 관련 문의는 서비스 내 고객지원 또는 개인정보 보호책임자 연락처를 이용할 수 있다.

---

# 17. 보호자 개인정보 수집·이용 안내/동의

Document key:

`parent_pii`

제목:

`보호자 개인정보 수집·이용 안내`

필수 표시:

### 처리 목적

- 보호자 회원가입 및 이용자 식별
- 보호자 계정 관리
- 자녀와의 관계 확인 및 보호자-자녀 연결
- 서비스 제공
- 중요 서비스 안내

### 처리 항목

필수:

- 이름
- 이메일
- 자녀와의 관계
- 인증에 필요한 계정정보
- 법정대리인 확인정보

이메일 방식 가입 시 비밀번호는 인증 시스템을 통해 처리하며 평문 저장하지 않는다.

현재 수집하지 않는 휴대전화번호, 주소, 생년월일은 포함하지 않는다.

### 보유기간

계정 유지기간 동안 보유한다.

회원탈퇴 신청 시 30일의 유예기간 이후 영구 파기한다.

관계 법령에서 별도 보존을 요구하는 정보는 해당 기간 동안 보존할 수 있다.

### 거부권

필수정보 처리에 동의하지 않는 경우 보호자 계정 생성 및 서비스 이용이 제한될 수 있다.

---

# 18. 아이 개인정보 수집·이용 동의

Document key:

`child_pii`

제목:

`아이 개인정보 수집·이용 동의`

### 처리 목적

- 아이 계정 생성
- 보호자-자녀 연결
- AI 친구 케이와의 대화 서비스
- 음성 인식
- 일일/주간 등 부모 리포트 생성
- 서비스 이용 및 운영
- 서비스 품질 및 안정성 확보

### 계정정보

- 성
- 이름
- 로그인 아이디
- 비밀번호
- 학년
- 성별
- 보호자-자녀 연결정보

### 대화 데이터

- 아이가 케이와 나눈 대화 텍스트
- 대화 관련 서비스 이용정보
- 리포트 생성을 위해 필요한 대화 맥락

### 음성

음성 기반 대화 과정에서 음성 데이터가 음성 인식 서비스를 통해 처리될 수 있다.

음성 원본은 K-Bestie 서버에 별도 저장하지 않으며 음성 인식 목적 달성 후 즉시 폐기한다.

### 보존

계정 기본정보:
회원탈퇴 30일 유예 후 영구 파기

raw/corrected 대화:
7일 후 파기

요약 인사이트/리포트:
- Care Start: 6개월
- Care Insight: 기본 3년 및 선택된 연장기간
- Care Premium: 기본 5년
- Care Premium 무제한 보존 선택 시 해당 이용자가 무제한 설정을 유지하는 기간

### 선택 수집

현재 없음.

관심사를 추가하지 않는다.

### 거부권

법정대리인은 아이 개인정보 처리에 대한 동의를 거부할 수 있다.

필수 개인정보 처리에 동의하지 않을 경우 아이 계정 생성 및 서비스 이용이 제한될 수 있다.

---

# 19. 만 14세 미만 아동 법정대리인 동의

Document key:

`guardian_u14`

제목:

`만 14세 미만 아동 법정대리인 동의`

본문은 다음 사실을 명확하게 안내한다.

- 해당 아이가 만 14세 미만임
- 서비스 이용을 위해 법정대리인의 동의가 필요함
- 법정대리인이 아이 개인정보 처리내용을 확인하고 동의함
- 아이 계정정보
- 아이 대화 데이터
- 음성처리
- 리포트 생성
- 보존/파기 정책
- 외부 AI/클라우드 처리
- 동의 철회 가능
- 동의 철회 또는 회원탈퇴 시 처리 정책

법정대리인 확인 방식:

`보호자 계정 가입 + 명시적 체크박스 동의`

실제 사용하지 않는 카드/SMS/FAX/전화 등의 방식을 작성하지 않는다.

---

# 20. 법정대리인 권한 확인

Document key:

`guardian_authority`

제목:

`법정대리인 또는 적법한 동의 권한 보유 확인`

내용:

사용자는 자신이 해당 아이의 법정대리인이거나 아이 개인정보 처리에 적법하게 동의할 권한을 보유하고 있음을 확인한다.

타인의 아이를 권한 없이 등록하거나 허위 정보를 입력해서는 안 된다.

서비스는 필요한 경우 보호자-자녀 관계 및 동의권한 확인을 요청할 수 있다.

---

# 21. 마케팅 정보 수신 동의

Document key:

`marketing`

선택 동의.

미동의해도 기본 서비스 이용 가능.

현재 실제 제공 중인 마케팅 채널만 표시한다.

실제 구현되지 않은 SMS/전화 등을 임의 추가하지 않는다.

Legal Registry는 채널 정보를 실제 코드/config에서 가져올 수 있는 구조로 둔다.

---

# 22. 이벤트·혜택 알림 동의

Document key:

`event_notice`

선택 동의.

이벤트, 혜택, 프로모션 성격의 알림을 위한 동의다.

필수 서비스 안내와 혼합하지 않는다.

미동의해도 기본 서비스 이용 가능.

---

# 23. 개인정보 처리방침

Document key:

`privacy_policy`

기존:

`/privacy`

route가 존재하므로 재사용한다.

신규 `/privacy`는 중앙 Legal Registry의 개인정보 처리방침 문서를 렌더링한다.

---

# 24. 개인정보 처리방침 기본 구조

다음 구조로 작성한다.

## 제1조 처리하는 개인정보의 항목과 목적

보호자:
- 이름
- 이메일
- 자녀와의 관계
- 인증/계정정보

아이:
- 성/이름
- 로그인 아이디
- 학년
- 성별
- 보호자-자녀 연결정보
- 인증정보

서비스 과정:
- 대화 텍스트
- 서비스 이용기록
- 접속/요청 관련 정보
- 리포트 및 요약 인사이트

음성:
- 음성 인식을 위해 실시간 처리
- 원본 미저장

---

# 25. 민감정보 관련 문구

Catchsecu의:

`회사는 이용자의 민감한 개인정보를 수집하지 않습니다.`

문구를 그대로 사용하지 않는다.

내친구 케이는 자유대화 서비스이므로 이용자가 건강, 고민, 학교·친구 관계 등 사적인 내용을 자발적으로 입력할 수 있다.

사용자-facing 문구는 과도한 단정을 피한다.

예시 방향:

`회사는 이용자에게 민감정보 입력을 요구하지 않습니다. 다만 이용자가 자유대화 과정에서 자신의 이야기를 자발적으로 포함할 수 있으며, 회사는 서비스 제공에 필요한 범위를 넘어 해당 정보를 별도의 목적으로 이용하지 않습니다.`

이 조항은:

`LEGAL_REVIEW_REQUIRED`

로 표시하고 Production 공개 전 최종 법률검토 대상으로 보고한다.

---

# 26. 만 14세 미만 아동

실제 법정대리인 동의 절차만 설명한다.

- 보호자 계정 생성
- 보호자 정보 입력
- 자녀와의 관계 확인
- 회원가입 단계의 명시적 동의
- 동의 확인시각 저장

Catchsecu의 카드/FAX/전화/SMS 일반 예시는 제거한다.

---

# 27. 쿠키 및 행태정보

맞춤형 광고는 하지 않는다.

명시:

`회사는 온라인 맞춤형 광고 제공을 목적으로 이용자의 행태정보를 수집·이용하지 않습니다.`

서비스 운영 과정에서 실제 사용하는:

- 인증/로그인 유지
- 기능 제공
- 보안
- 서비스 품질

관련 cookie/storage/log가 있는 경우 실제 구현에 맞춰 안내한다.

---

# 28. 개인정보 보유 및 파기

다음 표 구조로 표시한다.

| 데이터 | 보존기간 |
|---|---|
| 보호자/아이 계정정보 | 회원탈퇴 신청 후 30일 유예 후 파기 |
| 음성 원본 | 저장하지 않음 / 처리 후 즉시 폐기 |
| raw 대화 | 7일 |
| corrected 대화 | 7일 |
| Care Start 리포트/요약 | 6개월 |
| Care Insight 리포트/요약 | 기본 3년 + 선택 연장기간 |
| Care Premium 리포트/요약 | 기본 5년 |
| Care Premium 무제한 선택 | 설정 유지기간 동안 무제한 |
| 기타 법정보존정보 | 관련 법령에서 정한 기간 |

Retention 구현 PASS 전 Production 공개 금지.

---

# 29. 개인정보 처리위탁

최종 처리업체:

## Supabase

업무:
- 인증
- DB 운영
- 서비스 데이터 저장·관리

## Vercel

업무:
- 웹 호스팅
- 배포
- Serverless/API Runtime
- 운영 요청 처리

## Google

업무:
- AI 대화 생성
- 음성인식
- AI 처리

ElevenLabs 제외.

Microsoft Outlook 제외.

---

# 30. 개인정보 국외이전

국외이전 정보는 processor 별 하나의 Source of Truth에서 관리한다.

구조:

```ts
type OverseasProcessor = {
  id: string;
  name: string;
  country: string;
  contact: string;
  purpose: string[];
  dataCategories: string[];
  transferTiming: string;
  transferMethod: string;
  retention: string;
  legalBasis: string;
  subprocessorsUrl?: string;
};
```

동일 processor를 여러 문서에서 다시 하드코딩하지 않는다.

Supabase / Vercel / Google 각각 1개 config만 존재해야 한다.

공식 법인명·국가·연락처·재수탁사 URL은 구현 시 현재 공식 DPA와 실제 계약 기준으로 확인한다.

추측 금지.

---

# 31. 안전성 확보조치

현재 실제 구현 범위를 벗어난 기술을 법률문서에 허위로 추가하지 않는다.

다음 범주 중심:

- 접근권한 관리
- 인증 및 접근통제
- 전송구간 보호
- 비밀정보 환경변수 관리
- 로그 접근 제한
- 개인정보 최소처리
- 개인정보 파기

실제 사용하지 않는 보안제품이나 암호화 알고리즘을 임의로 작성하지 않는다.

---

# 32. 이용자/법정대리인의 권리

다음 권리를 안내할 수 있는 구조로 작성한다.

- 개인정보 열람
- 정정
- 삭제
- 처리정지
- 동의 철회
- 회원탈퇴

실제 앱 경로를 코드 기준으로 연결한다.

존재하지 않는 설정 메뉴를 문서에 쓰지 않는다.

---

# 33. 개인정보 보호책임자

현재:

성명: 안형진
직책: 대표 또는 실제 운영주체 기준 직책
이메일: hjan21@outlook.com

현재 실제 회사 형태와 직책을 코드/config 또는 대표 확정값에 맞춘다.

임의로 `대표이사`로 변경하지 않는다.

---

# 34. /terms 공개 페이지

현재 `/terms`가 없으므로 신규 공개 route를 생성한다.

로그인 없이 접근 가능해야 한다.

`service_terms` Registry 문서를 렌더링한다.

회원가입 Modal과 /terms가 동일 문서를 사용해야 한다.

---

# 35. 회원가입 1/4 상세보기

현재 7개 항목 UI를 유지한다.

각 항목 오른쪽에:

`상세보기 >`

추가.

대상:

- service_terms
- parent_pii
- child_pii
- guardian_u14
- guardian_authority
- marketing
- event_notice

---

# 36. Legal Modal

공통 Component 사용.

예:

`LegalDocumentModal`

기존 Dialog가 있다면 재사용 우선.

모바일 요구:

- 390~430px 최적화
- max-height 85~90dvh
- 내부 vertical scroll
- sticky header
- sticky footer
- X 닫기
- 확인 버튼
- background scroll lock
- focus trap
- ESC close
- aria-modal
- aria-labelledby
- modal 종료 후 기존 focus restore

---

# 37. 상세보기는 동의가 아님

절대 규칙:

`모달 열기/스크롤/확인/닫기 != 동의`

모달 `확인` 버튼으로 checkbox를 자동 체크하지 않는다.

사용자가 원래 consent checkbox를 직접 선택해야 `agreed=true`이다.

---

# 38. 아이 등록 4/4

현재 법정대리인 checkbox 옆에:

`상세보기 >`

추가.

guardian_u14 상세 문서를 사용한다.

회원가입 Step 1에서 기록한 signup_consents를 동일 version으로 중복 INSERT하지 않는다.

현재:

`child_profiles.guardian_consent`

및 기존 version 저장 구조를 유지한다.

---

# 39. 아이 시작하기 화면

현재 긴:

`법정대리인 개인정보 수집·이용 동의`

본문을 모바일에서 축약한다.

예:

`아이 계정 생성과 서비스 이용에 필요한 개인정보 처리내용을 확인해 주세요.`

`상세보기 >`

를 제공한다.

기존 승인 checkbox와 승인 요청 로직은 유지한다.

상세보기만으로 승인/동의 상태가 변경되어서는 안 된다.

---

# 40. Central Legal Document Registry

현재 `lib/plan/consentDocument.ts`를 확장하거나 기존 convention에 맞게 분리한다.

권장:

`lib/legal/legalDocuments.ts`

단 기존 구조와 중복 시스템을 만들지 않는다.

구조 예시:

```ts
type LegalDocumentKey =
  | "service_terms"
  | "parent_pii"
  | "child_pii"
  | "guardian_u14"
  | "guardian_authority"
  | "marketing"
  | "event_notice"
  | "privacy_policy";

interface LegalDocument {
  key: LegalDocumentKey;
  title: string;
  version: string;
  effectiveDate: string;
  required: boolean;
  sections: LegalSection[];
}
```

---

# 41. 문서의 단일 Source of Truth

다음 금지:

- signup/page.tsx 안에 약관 전문 하드코딩
- child registration 안에 별도 guardian 전문 복사
- /privacy에 또 다른 개인정보처리방침 복사
- /terms 별도 text 복사

하나의 Registry 문서를 여러 화면에서 렌더링한다.

---

# 42. consent_type mapping

기존 값 그대로:

```text
service_terms
parent_pii
child_pii
guardian_u14
guardian_authority
marketing
event_notice
```

신규 명칭으로 DB 값을 바꾸지 않는다.

---

# 43. Reconsent 정책

document version 변경 시 기존 consent 기록을 덮어쓰지 않는다.

현재 RPC의 reconsent/withdrawal 동작을 재사용한다.

Production에서 신규 version을 활성화하는 시점은 대표님 최종 승인 이후다.

---

# 44. Production 공개 Gate

다음 모두 PASS 전 Production 신규 Legal version 활성화 금지.

1. Legal UI QA
2. 신규 문서 본문 대표 승인
3. Retention 별도 구현 PASS
4. Premium Unlimited PASS
5. report hard delete PASS
6. raw/corrected 7일 비간섭
7. account withdrawal 30일 purge 비간섭
8. tsc PASS
9. tests PASS
10. build PASS

---

# 45. 이번 Request 비범위

하지 않는다:

- 회원가입 1~4 단계 변경
- 새로운 개인정보 입력필드 추가
- 관심사 재추가
- 생년월일 추가
- 휴대전화번호 추가
- 인증 구조 변경
- OAuth 구조 변경
- signup_consents migration
- 기존 state machine 변경
- Premium 출시 gate 해제
- Retention 로직 자체 구현
- Production deployment
- Production 데이터 수정

Retention은 별도 작업에서 진행한다.

---

# 46. QA — 회원가입 Step 1

검증:

- 필수 5개 정상
- 선택 2개 정상
- 상세보기 7개 정상
- 모달 상세보기만으로 checkbox 변경 없음
- 필수 5개 미동의 시 다음 비활성
- 필수 5개 동의 시 다음 활성
- 선택 미동의 진행 가능
- 전체 동의 정상
- 전체 동의 후 선택 동의 해제 가능

---

# 47. QA — Legal Modal

검증:

- 긴 약관 정상 스크롤
- 개인정보 처리방침 정상 스크롤
- 모바일 viewport overflow 없음
- header/footer 정상
- 닫기 정상
- 확인 정상
- ESC 정상
- focus trap
- focus restore
- background scroll lock

---

# 48. QA — 아이 등록 4/4

검증:

- guardian 상세보기 정상
- 동일 guardian_u14 version 표시
- 상세보기만으로 동의되지 않음
- 기존 checkbox 제출 조건 유지
- signup_consents 중복 생성 없음

---

# 49. QA — 아이 시작하기

검증:

- 긴 inline 약관 제거/축약
- 상세보기 정상
- checkbox 유지
- 승인 요청 기존 로직 정상
- 상세보기만으로 승인되지 않음

---

# 50. QA — /terms /privacy

로그인하지 않은 상태:

- /terms HTTP 200
- /privacy HTTP 200

동일 Registry 내용 표시.

모바일 정상.

---

# 51. QA — 기존 사용자

기존 consent version 사용자의 로그인 및 membership state를 깨뜨리지 않는다.

신규 version 후보를 Dev에서 추가했다고 기존 사용자를 즉시 재동의 화면으로 강제하지 않는다.

대표 승인 전 Production active version 변경 금지.

---

# 52. 정적 검증

필수:

`npx tsc --noEmit`

관련 tests

`npm run build`

기존 signup/onboarding E2E가 있다면 실행.

---

# 53. 보안

다음 Secret 평문 출력 금지:

- Supabase Service Role Key
- Google API Credential
- Vercel Token
- Password
- JWT
- 기타 Secret

로그/스크립트/임시파일에 남기지 않는다.

---

# 54. Request 완료 기준

다음 모두 완료:

- Legal Registry
- 7개 consent 문서
- Privacy Policy
- Terms
- Legal Modal
- Signup Step 1 상세보기
- Child Step 4 상세보기
- 아이 시작하기 상세보기
- /terms
- /privacy
- 기존 signup_consents 재사용
- version 구조 유지
- DB Migration 0건
- tsc PASS
- tests PASS
- build PASS

단 Retention 별도 Request가 아직 진행 중이면:

`IMPLEMENTATION COMPLETE / PRODUCTION RELEASE BLOCKED BY RETENTION`

상태로 종료한다.

녹색 완료 처리 금지.

---

# 55. 최종 보고 형식

## A. 변경 파일

모든 신규/수정 파일.

## B. Legal Registry

각 key / title / version.

## C. Modal 적용

- Signup Step 1
- Child Step 4
- 아이 시작하기

## D. 공개 route

- /terms
- /privacy

## E. DB

- Migration: 0건 여부
- signup_consents 재사용 확인
- RPC 재사용 확인

## F. 기존 상태머신 영향

resolveMembershipState 영향 여부.

## G. QA

- tsc
- tests
- build
- mobile
- consent regression

## H. Production Gate

Retention 작업 현재 상태.

## I. 법률 검토 필요

특히:

- 자유대화 중 우발적 민감정보 처리 문구
- 국외 수탁사 최종 법인명/국가/연락처
- Processor별 실제 전송 데이터
- Premium Unlimited 정책 최종 구현 결과

---

# 56. 대표님 최종 승인 규칙

구현 완료, code review PASS, tsc PASS, build PASS만으로 Request를 완료 처리하지 않는다.

대표님이 Production에서 다음을 직접 확인해야 한다.

1. Signup Step 1 Legal Modal
2. 각 동의서 본문
3. 법정대리인 Modal
4. 아이 시작하기 Modal
5. /terms
6. /privacy
7. 모바일 화면
8. 필수/선택 checkbox 동작

대표님 최종 PASS 전까지 `_done` 이동 및 녹색 표시 금지.

---

# 57. 최종 실행 원칙

1. 먼저 현재 코드를 다시 확인한다.
2. 기존 구조를 최대한 재사용한다.
3. DB Migration은 만들지 않는다.
4. Legal 본문은 이 Request를 기준으로 작성한다.
5. 실제 코드와 문서가 충돌하면 임의로 문서를 맞추지 말고 BLOCKED로 보고한다.
6. Catchsecu 자동 문구를 그대로 복사하지 않는다.
7. 실제 Production data flow가 Legal 문서의 기준이다.
8. Retention 별도 구현 PASS 전 Production Legal version 활성화 금지.
9. Production 배포 금지.
10. 모든 구현/검증 완료 후 대표님 승인 대기 상태로 종료한다.
