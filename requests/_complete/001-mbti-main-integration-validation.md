# MBTI 실제 앱 메인 케이 Dev 통합 검증 및 마무리

## 작업 정보

- 우선순위: 긴급
- 선행 작업: MBTI 단독 앱 Dev 배포 완료
- 병렬 처리: 불가
- 이유: 메인 놀이 진입·황금열쇠 차감·iframe 메시지 처리가 동일한 공유 경로를 사용함
- 예상 충돌 파일:
  - `app/child/play/page.tsx`
  - 기존 MBTI 놀이 세션·차감·환불 API 파일

## 범위

작업 전 반드시 `docs/conventions.md`를 먼저 읽고 현재 코드 상태를 확인한다.

다음 경로 안에서 MBTI 통합과 직접 관련된 파일만 생성·수정할 수 있다.

- `app/child/play/`
- `app/api/play/`
- `components/play/`
- `lib/play/`
- 프로젝트의 기존 테스트 디렉터리 중 MBTI 통합 테스트 파일
- Vercel 프로젝트 `k-bestie-v3-dev`의 Dev용 환경변수

읽기 전용 참고 자료:

- 저장소 내 `handoff-mbti-module.md`의 실제 위치를 검색해 읽는다.
- MBTI 앱 Dev URL: `https://k-bestie-mbti-dev.vercel.app`
- 메인 케이 Dev origin: `https://k-bestie-v3-dev.vercel.app`

수정 금지:

- MBTI 단독 앱 저장소
- `app.k-bestie.com`
- Production 프로젝트 `k-bestie-v3`
- Production DB
- 김서아·김서현의 비밀번호·인증정보
- MBTI와 무관한 미션·리포트·리텐션 기능
- Mock MBTI 페이지 및 Mock fallback 신규 생성

## 현재 상태

MBTI 단독 앱은 다음 상태로 완료됐다.

- Dev URL: `https://k-bestie-mbti-dev.vercel.app`
- Vercel 프로젝트: `k-bestie-mbti-dev`
- Commit SHA: `b18543b77f4a2e0e933db6a35cdf3be329224524`
- 리전: `icn1`
- 허용 parent origin:
  - `https://k-bestie-v3-dev.vercel.app`
- CSP:
  - `frame-ancestors https://k-bestie-v3-dev.vercel.app`
- CSP·postMessage allowlist·임베드 가드는 `getMainAppOrigin()` 단일 함수에서 origin을 읽는다.
- Production 영향 없음

메인 케이 앱에서는 이전 작업으로 실제 MBTI URL 연결과 첫 문항 렌더링까지 확인된 보고가 있으나, 다음 항목은 통합 완료 근거가 부족하거나 실제 재현이 끝나지 않았다.

- iframe 밖 직접 접속 시 클라이언트 임베드 가드 차단
- 아이폰 PWA 정상 origin 허용
- 전체 handshake 순서와 멱등성
- INIT timeout 발생 시 1회 환불
- `MBTI_COMPLETED` 수신
- `PLAY_BUG_REPORT` 수신
- 닫기·오류·완료 후 세션 및 황금열쇠 원장 정합성

이미 구현된 기능을 다시 만들지 말고 현재 코드를 먼저 읽은 뒤 완료된 부분은 건너뛴다.

## 요구사항

### 1. 실제 URL 및 Mock 제거 상태 확인

- `NEXT_PUBLIC_MBTI_APP_URL`이 정확히 다음 값인지 확인한다.

  `https://k-bestie-mbti-dev.vercel.app`

- 코드·환경변수·기본값·fallback 전체에서 Mock MBTI URL을 검색한다.
- 실제 사용자 경로에서는 Mock 페이지가 절대 열리지 않아야 한다.
- 실제 URL이 없거나 유효하지 않으면 황금열쇠 차감 전에 진입을 차단해야 한다.
- 실제 URL 실패 시 Mock으로 자동 전환하는 처리는 금지한다.

### 2. iframe 및 임베드 가드 검증

다음을 실제 브라우저로 검증한다.

- 메인 케이 Dev 앱의 iframe 안에서는 MBTI 앱이 정상 렌더링됨
- iframe 내부 첫 질문 화면이 표시됨
- `https://k-bestie-mbti-dev.vercel.app/play/mbti`를 최상위 페이지로 직접 열면 임베드 차단 화면이 표시됨
- 허용되지 않은 origin의 iframe에서는 차단됨
- 정상 메인 origin이 fail-closed 가드에 잘못 차단되지 않음
- iframe `src`, `event.origin`, `event.source`, `targetOrigin` 검증을 우회하지 않음

### 3. handshake 전체 검증

`handoff-mbti-module.md`의 규격을 그대로 사용하고 새 메시지 규격을 만들지 않는다.

다음 순서를 실제 메시지 로그로 확인한다.

1. MBTI 앱이 `MBTI_READY`를 1초 간격으로 재전송
2. 메인 앱이 유효한 `MBTI_READY`를 수신
3. 메인 앱이 동일한 `playSessionId`로 `MBTI_INIT` 전송
4. 중복된 `MBTI_READY`에도 동일 세션의 `MBTI_INIT`이 멱등 처리됨
5. MBTI 앱이 `MBTI_INIT_ACK` 전송
6. 실제 첫 질문 화면 진입

동일한 `playSessionId`에 대해 다음이 중복 발생하면 안 된다.

- 황금열쇠 추가 차감
- 새 놀이 세션 생성
- INIT 처리
- 질문 진행 상태 초기화

### 4. INIT timeout 및 자동 환불

유효한 INIT을 받지 못하는 테스트 조건을 별도로 구성해 다음을 확인한다.

- 15초 내 유효한 `MBTI_INIT` 미수신
- MBTI 앱이 다음 오류를 정확히 1회 전송

  - type: `MBTI_ERROR`
  - refundable: `true`
  - stage: `init_timeout`

- 메인 앱이 해당 오류를 수신
- 황금열쇠가 이미 차감됐다면 기존 원장·환불 RPC를 사용해 정확히 1회 환불
- 같은 오류가 재전송돼도 중복 환불되지 않음
- 환불 후 화면 보유량이 즉시 갱신됨
- 세션 상태가 재진입 가능한 일관된 상태로 정리됨

### 5. 완료·오류·닫기·버그 신고

실제 MBTI 앱에서 16개 문항을 진행할 수 있는 자동화 방식을 먼저 코드와 DOM을 읽어 구성한다. 무작위 좌표 클릭은 금지한다.

다음을 검증한다.

- 마지막 문항 완료 후 `MBTI_COMPLETED` 수신
- 완료 세션이 `completed`로 저장됨
- 완료 결과와 진행 상태가 중복 저장되지 않음
- 완료 후 다시 진입하면 기존 완료 세션을 잘못 이어하지 않음
- 도중 닫기 후 6시간 이내 재진입 시 이어하기 가능
- 이어하기 시 황금열쇠 재차감 없음
- 6시간 초과 세션은 이어하기 대상으로 노출되지 않음
- 앱 내부 오류 발생 시 `PLAY_BUG_REPORT`가 메인 앱에 전달됨
- 버그 신고에 원문 대화·민감정보·인증정보가 포함되지 않음
- 닫기·오류·완료 시 iframe과 메시지 리스너가 중복으로 남지 않음

### 6. 황금열쇠 정합성

MBTI 필요 황금열쇠는 기존 정책인 3개를 유지한다.

검증 항목:

- 신규 유료 진입: 22개 → 19개
- 이어하기: 추가 차감 없음
- INIT timeout 환불: 19개 → 22개
- 동일 오류 재전송: 추가 환불 없음
- 완료 후 재진입 정책이 기존 무료체험·유료정책과 일치
- balance 숫자를 직접 덮어쓰지 않고 기존 원장과 RPC를 사용
- 무료체험 쿠폰 사용 여부에 따라 실제 차감 결과를 구분해 기록

## 데이터·환경변수·배포

- DB 스키마 변경: 원칙적으로 없음
- 마이그레이션: 없음
- 환경변수:
  - `NEXT_PUBLIC_MBTI_APP_URL=https://k-bestie-mbti-dev.vercel.app`
- Dev 배포: 필요
- Production 변경: 절대 금지
- 자동 테스트 계정:
  - 부모 `QA테스트`
  - 자녀 `QA테스트(5학년)`
- D/F 회귀 계정 `testi01`, `testi02`는 이번 작업에 사용하지 않는다.
- 김서아·김서현은 자동 로그인·세션 초기화·비밀번호 변경·자동 차감을 금지한다.
- 김서아·김서현은 모든 자동 검증 완료 후 대표님 수동 확인용으로만 남긴다.

## 완료조건

- `docs/conventions.md` 규약 준수
- 실제 MBTI URL 적용 확인
- 사용자 경로 Mock URL 0건
- iframe 내부 정상 렌더링
- iframe 밖 직접 접속 차단
- 허용되지 않은 origin 차단
- `MBTI_READY → MBTI_INIT → MBTI_INIT_ACK → 첫 질문` 검증
- 같은 `playSessionId` 멱등성 검증
- 15초 INIT timeout 오류 1회 발신 검증
- 차감 후 INIT 실패 시 자동 환불 검증
- 중복 환불 0건
- `MBTI_COMPLETED` 수신 검증
- `PLAY_BUG_REPORT` 수신 검증
- 6시간 이어하기 및 재차감 방지 검증
- `npx tsc --noEmit` 통과
- `npx next build` 성공
- 관련 자동테스트 통과
- `git diff`로 허용 범위 밖 변경이 없는지 확인
- 임시 테스트 스크립트·로그·비밀번호·인증정보가 저장소에 남지 않음
- 메인 케이 Dev 재배포 완료
- Production 프로젝트와 Production DB 미변경 확인
- 커밋 SHA와 Dev URL 보고

## 검증 시나리오

### 시나리오 A — 정상 신규 진입

1. QA 자녀의 황금열쇠를 기존 원장 기준 22개로 준비
2. 메인 케이 Dev에서 MBTI 카드 선택
3. 3개 차감 확인
4. iframe 실제 MBTI 앱 로드 확인
5. READY·INIT·ACK 순서 확인
6. 첫 질문 `0/16` 렌더링 확인
7. Mock 제목·디버그 payload 미노출 확인

### 시나리오 B — 중복 READY 및 INIT

1. 동일 세션에서 `MBTI_READY`를 반복 수신
2. 동일 `playSessionId` 사용 확인
3. 신규 세션 추가 생성 0건
4. 추가 황금열쇠 차감 0건
5. 질문 상태 초기화 0건

### 시나리오 C — INIT timeout 환불

1. INIT 전달을 차단한 테스트 조건 구성
2. 15초 후 `MBTI_ERROR` 확인
3. `refundable=true`, `stage=init_timeout` 확인
4. 환불 후 잔액 복구 확인
5. 같은 오류 재전송 후 중복 환불 0건 확인

### 시나리오 D — 이어하기

1. 문항 일부 진행
2. 놀이 화면 종료
3. 6시간 이내 재진입
4. 이어하기 안내 확인
5. 기존 문항 위치 복원
6. 황금열쇠 재차감 없음

### 시나리오 E — 완료

1. 16문항 전체 진행
2. `MBTI_COMPLETED` 수신
3. 세션 `completed` 저장
4. 결과 화면 표시
5. 완료 이벤트·결과 저장 중복 0건

### 시나리오 F — 버그 신고

1. 안전한 테스트 오류 조건 구성
2. `PLAY_BUG_REPORT` 수신
3. 세션·stage·오류 분류 확인
4. 민감정보 미포함 확인

### 시나리오 G — 임베드 차단

1. MBTI URL 직접 접속
2. 임베드 차단 화면 확인
3. 허용되지 않은 origin iframe 차단 확인
4. 정상 메인 Dev iframe에서는 허용 확인

## 공유파일 수정

공유파일 수정 허용:

- `app/child/play/page.tsx`
  - MBTI URL 선택
  - iframe 메시지 송수신
  - 세션·차감·환불·완료 처리
  - MBTI 관련 코드 범위만 수정
  - 다른 놀이 카드와 공통 놀이 정책을 임의로 변경하지 않는다.

그 외 `docs/conventions.md`의 공유파일목록에 포함된 파일은 수정 금지한다. 추가 공유파일 수정이 반드시 필요하면 임의 수정하지 말고 `requests/_blocked.md`에 파일 경로·수정 이유·보류 지점을 기록한다.

## 작업 및 리뷰 방식

- 1차 개발·자동화 테스트 작성: 안티그래비티
- 오케스트레이션·코드 리뷰·통합·환경변수·Dev 배포: 메인 Claude Code
- 메인 Claude Code가 직접 코드를 수정한 경우:
  - 별도 `claude-review` Claude Code 인스턴스가 읽기 전용 검증
- Codex:
  - 사용 가능한 경우에만 추가 검증
  - 한도 초과로 작업을 중단하지 않는다.
- 이미 완료된 구현은 다시 작성하지 않는다.
- Mock 앱·새 통신 규격·새 차감 시스템을 만들지 않는다.
- 테스트가 완료된 트랙은 다른 작업을 기다리지 말고 즉시 커밋·Dev 배포한다.

## 최종 보고 형식

- 실제 MBTI URL 적용 상태
- Mock URL 잔존 검색 결과
- iframe 내부 로딩 결과
- iframe 밖 차단 결과
- READY·INIT·ACK 실측 순서
- 첫 질문 화면 확인 결과
- INIT timeout 및 자동 환불 결과
- 이어하기 및 재차감 방지 결과
- `MBTI_COMPLETED` 결과
- `PLAY_BUG_REPORT` 결과
- 황금열쇠 원장 변화
- 자동테스트·타입체크·빌드 결과
- 리뷰 결과
- 변경 파일 목록
- 메인 앱 커밋 SHA
- MBTI 앱 커밋 SHA
- Dev URL
- 대표님 실기기 확인이 필요한 항목
- 남은 문제 또는 차단 사항