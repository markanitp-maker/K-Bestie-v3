# Claude Code Ralph Mode 인수인계 패키지 (Production 전환)

작성일: 2026-07-27 (KST)  
작성자: AntiGravity (검증 전담 워커)  
목적: Claude Code(Ralph Mode)가 읽고 즉시 실행할 수 있는 Production 환경 전환 Final Handoff 문서  
주의사항: 본 문서는 읽기 전용으로 수집된 팩트이며, 실제 환경 변경은 Ralph Mode에서 사용자의 최종 인가 후 단계별로 진행해야 합니다.

---

## 1. 메인 앱 Vercel & Supabase 매핑표

| 속성 | Production (목표 상태) | Development (현재 로컬 연결 상태) |
| --- | --- | --- |
| Vercel Project Name | `k-bestie-v3` | `k-bestie-v3-dev` |
| Vercel Project ID | `[Ralph 확인 요망]` | `prj_I9nJJTE0EwJut9M4uHLDaJntXGW0` |
| Domain | `app.k-bestie.com` | `k-bestie-v3-dev.vercel.app` |
| Git Repository | `markanitp-maker/K-Bestie-v3` | `markanitp-maker/K-Bestie-v3` |
| Deploy Branch | `production` 또는 `main` | `feat/family-backend` |
| Supabase Project Ref | `fetvnhhjicndmxvhrffk` | `mkrsaaedxqrcrktapaus` |

---

## 2. 놀이 앱(MBTI, 퀴즈마스터) Vercel 설정 명세

현재 Vercel 콘솔에서 `Connect Git Repository` 상태일 때 입력하거나 확인해야 할 정확한 값입니다.

### MBTI Production (`k-bestie-mbti` 예상)

- Git Repository: `markanitp-maker/mbti`
- Root Directory: `./`
- Production Branch: `production`
- 기존 `master`는 Dev용이므로 분리 필수
- Build Command: 기본값 `npm run build`
- 도메인: `mbti.k-bestie.com` 예상

### 퀴즈마스터 Production (`k-bestie-quiz` 예상)

- Git Repository: `markanitp-maker/Quiz`
- Root Directory: `./`
- Production Branch: `production`
- 기존 `master`는 Dev용이므로 분리 필수
- Build Command: 기본값 `npm run build`
- 도메인: `quiz.k-bestie.com` 예상

---

## 3. 환경변수 대조표

실제 값은 출력하지 않고 환경별 역할만 구분합니다.

| 환경변수명 | 메인 앱 Dev/Prod | MBTI Prod | 퀴즈 Prod | 비고 |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_TARGET` | `dev` / `prod` | `prod` | `prod` | 환경 분기 스위치 |
| `NEXT_PUBLIC_SUPABASE_URL` | Dev DB / Prod DB URL | Prod DB URL | Prod DB URL | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev / Prod Anon Key | Prod Anon Key | Prod Anon Key | |
| `SUPABASE_SERVICE_ROLE_KEY` | Dev / Prod Service Role Key | - | - | Edge Function / 서버 전용 |
| `NEXT_PUBLIC_MAIN_APP_ORIGIN` | - | `app.k-bestie.com` | `app.k-bestie.com` | 메인 앱 복귀 URL |
| `NEXT_PUBLIC_MBTI_APP_URL` | `mbti.k-bestie.com` | - | - | 메인 앱에서 MBTI 진입 |
| `NEXT_PUBLIC_QUIZ_APP_URL` | `quiz.k-bestie.com` | - | - | 메인 앱에서 퀴즈 진입 |
| `BATCH_SECRET` | Dev / Prod 발급 | - | - | Edge Function Cron 인증 |
| `GCP_STT_API_KEY` | Dev / Prod 발급 | - | - | |
| `GCP_TTS_API_KEY` | Dev / Prod 발급 | - | - | |
| `GCP_VERTEX_SA_KEY_JSON` | Dev / Prod 발급 | - | - | |
| `VERTEX_LIVE_RELAY_URL` | Cloud Run URL | - | - | 무상태 중계 서버 |
| `VERTEX_LIVE_RELAY_SECRET` | 일치 시 통과 | - | - | 중계 서버 인증 |

---

## 4. Supabase DB Migration 적용 이력 검증 계획

- Dev 최신 상태: 총 114개 Migration
- 최신 Migration 기준:
  `20260760000000_mbti_platform_bridge.sql`
- Ralph 검증 명령:

```bash
npx supabase migration list --db-url <PROD_DB_URL>
```

주의사항:

- `db push` 사용 금지
- `repair` 사용 금지
- `reset` 사용 금지
- Production에 누락된 Migration만 확인
- 필요한 경우 Ralph가 안전한 `supabase migration up`만 수행
- 기존 Production 데이터에 영향을 주는 파괴적 Migration은 실행 중단 후 보고

---

## 5. 하드코딩 교정 대상 목록

Production으로 릴리즈할 때 버그를 유발할 수 있는 하드코딩 지점입니다.

### 1. 가족 초대 URL

파일:

```text
app/api/families/[id]/invite-parent/route.ts:68
```

현재 내용:

```typescript
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
```

조치:

- Production Vercel 환경변수에 `NEXT_PUBLIC_APP_URL` 설정 여부 확인
- Production 값은 `https://app.k-bestie.com`
- 가능하면 localhost fallback이 Production에서 사용되지 않도록 검증

### 2. 퀴즈 보상 Callback URL

파일:

```text
lib/quiz/play/rewardsCallback.ts:51
```

현재 내용:

```typescript
return "http://localhost:3000";
```

조치:

- Vercel 환경에서 동적으로 Origin을 가져오도록 수정
- 또는 `NEXT_PUBLIC_MAIN_APP_ORIGIN` 환경변수 사용
- Production 값은 `https://app.k-bestie.com`

참고:

```text
lib/supabase/env.ts
```

여기에 정의된 `DEV_PROJECT_REF`, `PROD_PROJECT_REF`는 환경 분기를 위한 상수이므로 교정 대상이 아닙니다.

---

## 6. 서버 사이드 보안 점검 결과

다음 주요 API Route에서 관리자 승인 여부를 서버 사이드에서 검사하는 로직이 확인되었습니다.

```text
app/api/chat/messages/route.ts
app/api/voice/tts/route.ts
app/api/mission/respond/route.ts
```

확인된 검증 함수:

```text
checkApprovalForChild
checkApprovalForSession
```

현재 코드 기준으로 미승인 사용자가 API를 직접 호출해 다음 기능을 실행하는 행위는 서버 레벨에서 차단됩니다.

- Gemini
- STT
- TTS
- 미션 응답
- 채팅 메시지
- 비용 발생 가능 기능

예상 차단 응답:

```text
403 Forbidden
```

---

## 7. Auth·CORS·Cron 분리 확인

### Supabase Auth Redirect 및 CORS

Production Supabase에 다음 도메인을 등록해야 합니다.

```text
https://app.k-bestie.com
https://mbti.k-bestie.com
https://quiz.k-bestie.com
```

확인 대상:

- Site URL
- Additional Redirect URLs
- 이메일 인증 Redirect
- 비밀번호 재설정 Redirect
- OAuth Callback
- CORS Allowed Origins
- Callback URL
- Return URL

### Cron 및 Edge Function 분리

Dev DB의 `pg_cron`은 Dev Edge Function URL을 호출해야 합니다.

```text
mkrsaaedxqrcrktapaus
```

Production DB의 `pg_cron`은 Production Edge Function URL을 호출해야 합니다.

```text
fetvnhhjicndmxvhrffk
```

URL 매핑이 정확하면 다음 문제는 발생하지 않습니다.

- Dev와 Prod 데이터 혼합
- 배치 중복 실행
- Dev Cron이 Prod 데이터를 처리
- Prod Cron이 Dev 데이터를 처리

---

## 8. 릴리즈 커밋 후보 및 미커밋 상태

현재 브랜치:

```text
feat/family-backend
```

현재 상태:

```text
legacy-origin 대비 222 Commits Ahead
```

확인된 미커밋 변경 파일 예시:

```text
middleware.ts
app/chat/page.tsx
components/KChatbotWidget.tsx
app/api/quiz-play/submit/route.ts
```

Ralph Mode 실행 전 필수 조치:

1. 현재 변경사항 전수 확인
2. 작업 중인 코드와 완료된 코드 구분
3. Production에 포함할 변경사항 커밋
4. Production 기준 Commit Hash 확정
5. 필요 시 `main` 또는 `production` 브랜치로 병합
6. Production 배포에서 제외해야 할 임시 파일 제거
7. 다른 Claude Code 또는 작업자가 같은 저장소를 수정 중인지 확인

---

## 9. Ralph Mode 실행 단계

### 1단계. 사전 백업 및 기준점 고정

수행 항목:

- Git 상태 확인
- 미커밋 변경사항 정리
- Production 대상 Commit Hash 확정
- 현재 Vercel 환경변수 스냅샷 저장
- 현재 Vercel Deployment ID 기록
- Production Supabase Migration 이력 저장
- 기존 Production 데이터 백업 가능 여부 확인

GO 조건:

- Production에 올릴 코드가 하나의 Commit으로 고정됨
- 동시에 수정 중인 작업자가 없음

STOP 조건:

- 미완료 코드와 완료 코드가 구분되지 않음
- 다른 작업자가 같은 파일을 수정 중임

---

### 2단계. Migration 검증 및 적용

검증 명령:

```bash
npx supabase migration list --db-url <PROD_DB_URL>
```

수행 항목:

- Dev Migration 목록 확인
- Production 적용 목록 확인
- 누락 Migration 식별
- 선행 Migration 의존성 확인
- 데이터 손상 가능성 확인
- 누락분만 순차 적용

금지 명령:

```text
supabase db reset
supabase migration repair
무조건적인 supabase db push
```

STOP 조건:

- Migration 이력 불일치
- 같은 버전 번호의 다른 SQL 존재
- 기존 Production 데이터 삭제 위험
- Column Drop 또는 Type 변경 발생
- Foreign Key 충돌
- RLS 정책 충돌

---

### 3단계. 메인 앱 Production 환경변수 정리

대상 Vercel 프로젝트:

```text
k-bestie-v3
```

대상 도메인:

```text
https://app.k-bestie.com
```

확인 항목:

- Production Supabase URL
- Production Anon Key
- Production Service Role Key
- `NEXT_PUBLIC_SUPABASE_TARGET=prod`
- Production GCP Key
- Cloud Run Relay URL
- Relay Secret
- Batch Secret
- MBTI Production URL
- Quiz Production URL
- Callback URL
- App URL
- Dev Supabase Key 혼입 여부
- Dev 도메인 혼입 여부

STOP 조건:

- Production Vercel이 Dev Supabase를 참조
- Dev Service Role Key가 존재
- localhost URL이 존재
- Dev Vercel URL이 존재

---

### 4단계. MBTI Production 연결 및 배포

대상 프로젝트:

```text
k-bestie-mbti
```

Git 저장소:

```text
markanitp-maker/mbti
```

Production Branch:

```text
production
```

환경변수:

```text
NEXT_PUBLIC_SUPABASE_TARGET=prod
NEXT_PUBLIC_SUPABASE_URL=<PROD_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PROD_ANON_KEY>
NEXT_PUBLIC_MAIN_APP_ORIGIN=https://app.k-bestie.com
```

검증 항목:

- Build 성공
- Production Supabase 연결
- 메인 앱 복귀 URL
- 토큰 검증
- 세션 생성
- 결과 저장
- 이어하기
- 황금열쇠 처리
- 중복 보상 방지
- 잘못된 Token 차단
- 만료 Token 차단

메인 앱에는 아직 연결하지 않고 먼저 다크 배포 상태로 검증합니다.

---

### 5단계. 퀴즈마스터 Production 연결 및 배포

대상 프로젝트:

```text
k-bestie-quiz
```

Git 저장소:

```text
markanitp-maker/Quiz
```

Production Branch:

```text
production
```

환경변수:

```text
NEXT_PUBLIC_SUPABASE_TARGET=prod
NEXT_PUBLIC_SUPABASE_URL=<PROD_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PROD_ANON_KEY>
NEXT_PUBLIC_MAIN_APP_ORIGIN=https://app.k-bestie.com
```

검증 항목:

- Build 성공
- Production Supabase 연결
- 토큰 검증
- 문제 로드
- 정답 저장
- 진행 위치 저장
- 중단 후 이어하기
- 완료 Callback
- 황금열쇠 보상
- 중복 보상 차단
- 메인 앱 복귀
- 잘못된 Token 차단
- 만료 Token 차단

메인 앱에는 아직 연결하지 않고 먼저 다크 배포 상태로 검증합니다.

---

### 6단계. 메인 앱 놀이 URL 전환

MBTI와 퀴즈마스터 Production 앱이 정상 동작한 뒤 메인 앱 환경변수를 변경합니다.

```text
NEXT_PUBLIC_MBTI_APP_URL=https://mbti.k-bestie.com
NEXT_PUBLIC_QUIZ_APP_URL=https://quiz.k-bestie.com
```

커스텀 도메인을 아직 연결하지 않았다면 Vercel Production URL을 사용합니다.

예시:

```text
https://k-bestie-mbti.vercel.app
https://k-bestie-quiz.vercel.app
```

수행 항목:

- 메인 앱 환경변수 변경
- 메인 앱 Production 재배포
- 변경 후 Deployment ID 기록
- Dev 환경변수에 영향이 없는지 확인

STOP 조건:

- 놀이 Production 앱 단독 테스트 실패
- Callback 실패
- 결과 저장 실패
- 황금열쇠 차감 또는 환불 실패
- 메인 앱 복귀 실패

---

### 7단계. Auth·CORS·Callback 반영

Production Supabase에 등록할 도메인:

```text
https://app.k-bestie.com
https://k-bestie-mbti.vercel.app
https://k-bestie-quiz.vercel.app
```

향후 커스텀 도메인 연결 시 추가:

```text
https://mbti.k-bestie.com
https://quiz.k-bestie.com
```

검증 항목:

- 로그인 유지
- 메인 앱에서 놀이 앱 이동
- 놀이 앱에서 메인 앱 복귀
- 세션 유지
- Callback 성공
- CORS 오류 없음
- Cookie SameSite 문제 없음
- 이메일 인증 Redirect
- 비밀번호 재설정 Redirect

---

### 8단계. 전체 Production 스모크 테스트

#### 계정 및 승인

- 신규 회원가입
- 승인 대기 화면
- 관리자 신청자 목록
- 승인
- 거절
- 플랜 할당
- 미승인 사용자의 비용 API 차단

#### 메인 앱

- 로그인
- 아이 프로필 생성
- 아이 전환
- 홈 화면
- 미션 진입
- 자유대화 진입
- 관리자 화면

#### 음성 기능

- STT
- TTS
- Gemini 응답
- Live Relay
- 듣는 중
- 생각하는 중
- 말하는 중
- Barge-in
- 연결 종료
- 재접속

#### MBTI

- 토큰 발급
- 황금열쇠 차감
- 20문항 진행
- 중단 후 이어하기
- 결과 저장
- 동물 결과 이미지
- 메인 앱 복귀
- 중복 보상 방지

#### 퀴즈마스터

- 토큰 발급
- 학년 적용
- 문제 로드
- 정답 저장
- 자동 다음 문제
- 중단 후 이어하기
- 완료 저장
- 리더보드
- 황금열쇠
- 메인 앱 복귀

#### 리포트 및 배치

- Daily Batch
- Weekly Batch
- Memory Batch
- Production DB만 처리하는지 확인
- 중복 실행 방지
- 실패 로그 확인

---

### 9단계. 실패 시 롤백

#### Vercel 롤백

- 이전 Production Deployment ID 확인
- 이전 배포로 Rollback
- 환경변수 원복
- 메인 앱 놀이 URL 원복
- 실패한 놀이 앱 연결 해제

#### Supabase 롤백

DB Rollback은 자동으로 처리하지 않습니다.

STOP 후 다음을 수행합니다.

- 실행한 Migration 파일 식별
- 영향받은 Table 확인
- 데이터 손실 여부 확인
- Rollback SQL 별도 작성
- 대표님 승인 후 수동 실행

#### 놀이 앱 롤백

메인 앱 환경변수를 기존 Dev 또는 이전 URL로 되돌립니다.

```text
NEXT_PUBLIC_MBTI_APP_URL=<이전 URL>
NEXT_PUBLIC_QUIZ_APP_URL=<이전 URL>
```

주의:

- Dev Vercel 삭제 금지
- Dev Supabase 삭제 금지
- Dev 데이터 삭제 금지
- Production 장애를 해결하기 위해 Dev 값을 Production에 덮어쓰지 않음

---

## 10. GO / STOP 조건

### GO 조건

다음 항목이 모두 충족되어야 합니다.

1. 미커밋 작업이 정리됨
2. Production 기준 Commit Hash가 고정됨
3. `localhost:3000` 하드코딩이 교정됨
4. Dev URL 하드코딩이 제거되거나 환경변수로 분리됨
5. Production Vercel 접근 가능
6. Production Supabase 접근 가능
7. Production Supabase Project Ref 확인
8. Production Migration 이력 확인
9. MBTI Production Vercel Git 연결
10. Quiz Production Vercel Git 연결
11. Production 환경변수 등록
12. Auth Redirect와 CORS 등록
13. Rollback 기준점 확보
14. 다른 작업자의 동시 수정 없음

### STOP 조건

다음 중 하나라도 발생하면 즉시 중단합니다.

1. Production Supabase Project Ref 불일치
2. Production Vercel이 Dev DB를 참조
3. Dev Service Role Key가 Production에 등록됨
4. Migration 이력 충돌
5. 데이터 삭제 가능성
6. Build 실패
7. Callback 인증 실패
8. 황금열쇠 중복 차감
9. 황금열쇠 환불 실패
10. 결과 저장 실패
11. 메인 앱 복귀 실패
12. Auth Redirect 실패
13. Vercel 또는 Supabase 권한 부족
14. Production Secret 누락
15. 다른 작업자가 같은 파일을 수정 중임

---

## 최종 판정

```text
조건부 가능 (CONDITIONAL GO)
```

사유:

- 현재 코드베이스에 미커밋 변경사항이 다수 존재
- `localhost:3000` 하드코딩이 남아 있음
- MBTI와 퀴즈마스터 Production Vercel의 Git 연결 및 환경변수 설정이 필요
- Production 인프라 접근 권한과 실제 매핑을 Ralph Mode 시작 시 최종 확인해야 함

다음 선결 조건이 해결되면 Production 전환을 시작할 수 있습니다.

```text
미커밋 변경 정리
→ Production 기준 Commit 고정
→ localhost 및 Dev URL 하드코딩 교정
→ MBTI·퀴즈 Production Git 연결
→ Production 환경변수 등록
→ Migration 차이 검증
→ GO 조건 재확인
→ Production 전환 시작
```

