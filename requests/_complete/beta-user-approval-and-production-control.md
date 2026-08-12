# 베타 사용자 승인 및 서비스 플랜 관리 시스템 구축 요청

## 목적

내친구 케이 서비스는 베타 운영 기간 동안 아무나 회원가입 후 AI 기능을 사용할 수 없도록 제한한다.

회원가입 사용자는 설문조사 및 베타 신청 완료 후 관리자가 승인한 사용자만 서비스를 사용할 수 있어야 한다.

또한 관리자는 승인 시 사용자별 서비스 플랜(Care Start / Care Insight / Care Premium)을 지정할 수 있어야 한다.

목표:
- 무분별한 Gemini API 비용 발생 방지
- 베타 대상 사용자만 서비스 제공
- 향후 유료 플랜 구조 확장 기반 마련


# 1. 사용자 가입 및 승인 흐름 변경

## 현재

회원가입
→ 바로 서비스 사용 가능


## 변경

회원가입
→ 설문조사 완료
→ 베타 신청 완료
→ 관리자 승인 대기
→ 관리자 승인
→ 서비스 사용 가능


## 승인 전 사용자 상태

승인 전 사용자는:

가능:
- 회원가입
- 로그인
- 본인 정보 확인
- 승인 대기 화면 확인

불가능:
- 케이 대화 실행
- Gemini API 호출
- 음성 대화 실행
- 미션 실행
- 놀이 실행


# 2. 사용자 승인 상태 관리

사용자 계정에 승인 상태 관리 추가


approval_status

값:

- pending
  - 회원가입 완료
  - 관리자 승인 대기

- approved
  - 승인 완료
  - 서비스 사용 가능

- rejected
  - 승인 거절


# 3. 관리자 베타 신청 관리 화면 추가

관리자 페이지에 "베타 신청 관리" 메뉴 추가


## 목록 화면

표시 정보:

- 사용자명
- 이메일
- 신청일
- 승인 상태
- 서비스 플랜
- 관리 버튼


예:

| 사용자 | 이메일 | 상태 | 플랜 | 관리 |
|---|---|---|---|---|
| 홍길동 | user@email.com | 대기 | - | 승인 |
| 김철수 | user@email.com | 승인 | Care Start | 변경 |


# 4. 관리자 승인 기능

관리자가 신청자를 선택 후 승인 가능


승인 과정:

사용자 선택
→ 승인 버튼 클릭
→ 서비스 플랜 선택
→ 승인 완료


플랜 선택:

- Care Start
- Care Insight
- Care Premium


승인 완료 시 저장:

- approval_status = approved
- subscription_plan = 선택한 플랜


# 5. 서비스 플랜 관리

사용자별 현재 플랜 저장 필요


초기 구조 검토:

방법 A:
users 테이블

추가 컬럼:

- approval_status
- subscription_plan


방법 B:
별도 테이블

user_subscriptions

필드 예:

- id
- user_id
- plan_type
- start_date
- end_date
- status


향후:
- 무료 체험
- 유료 전환
- 플랜 변경
- 결제 연동

확장성을 고려하여 적절한 구조 선택


# 6. API 비용 보호 정책

모든 AI 기능 실행 전에 승인 상태 검증


검증 대상:

- Gemini API 호출
- Gemini Live 음성 대화
- STT
- TTS
- 미션 실행
- 놀이 실행


조건:

approval_status != approved

이면:

API 호출 차단

사용자에게:

"현재 베타 승인 대기 중입니다. 승인 완료 후 서비스를 이용할 수 있습니다."

표시


# 7. 기존 테스트 사용자 처리

현재 개발 및 테스트 계정 영향 확인


확인:

- 기존 테스트 계정 유지 가능 여부
- 관리자 승인 없이 테스트 가능한 방법
- Production 전환 시 초기 관리자 계정 처리


# 8. Production 배포 구조 확인

현재 구조 점검:


## 내친구 케이

- Vercel Dev 프로젝트
- Vercel Production 프로젝트
- Supabase Dev
- Supabase Production


## KY 놀이

- MBTI Vercel 프로젝트
- 퀴즈마스터 Vercel 프로젝트


확인 요청:

MBTI와 퀴즈마스터는 별도 Dev Vercel 프로젝트 생성 없이

현재 프로젝트 기준:

Preview
→ Dev Supabase

Production
→ Production Supabase

구조가 가능한지 검토


# 9. 환경변수 확인

Preview 환경:

- 개발 Supabase 연결


Production 환경:

- Production Supabase 연결


확인:

- Supabase URL
- Supabase Key
- API Secret
- Redirect URL
- 서비스 호출 URL


하드코딩된 개발 URL 존재 여부 확인


# 10. Supabase Migration 확인

Production 배포 전 확인:

- 신규 테이블
- 신규 컬럼
- RLS 정책
- 함수
- Trigger

Migration 파일 기준으로 Production 반영 가능 여부 확인


# 11. 검증 항목

완료 후 결과 보고:


## 사용자 승인

- 회원가입
- 베타 신청
- 승인 대기 표시
- 관리자 승인
- 승인 완료 후 서비스 접근


## 플랜 관리

- Care Start 선택
- Care Insight 선택
- Care Premium 선택
- 사용자별 플랜 저장


## 비용 보호

- 미승인 사용자 API 차단
- 승인 사용자 API 정상 호출


## Production 준비

- Vercel 환경 분리 확인
- Supabase 연결 확인
- Migration 적용 가능 여부 확인


# 최종 결과물

아래 내용을 정리해서 보고한다.

1. 현재 구조 분석
2. 변경 필요 DB 구조
3. 관리자 기능 구현 계획
4. API 보호 적용 위치
5. Production 배포 가능 여부
6. 추가 작업 목록