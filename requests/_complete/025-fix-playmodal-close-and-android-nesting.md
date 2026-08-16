025-fix-playmodal-close-and-android-nesting.md

# PlayModal 닫기 동작 통일 및 Android 중첩 모달 방지

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- 놀이 실행 화면 상단 좌측의 `← 뒤로` 버튼이 `X 닫기` 버튼으로 변경된다.
- `X 닫기`는 브라우저 히스토리 이동이 아니라 현재 열려 있는 PlayModal 자체만 종료한다.
- Android에서 놀이를 열고 닫은 뒤 다시 열어도 모달/iframe/WebView가 중첩되지 않는다.
- MBTI와 퀴즈마스터 모두 동일한 PlayModal 종료 규칙을 사용한다.
- 놀이 종료 후 `/child/play` 화면으로 안전하게 복귀한다.
- 모달 종료·재실행 과정에서 황금열쇠가 중복 차감되지 않는다.
- completion/refund callback과 각 독립 놀이 앱의 내부 기능에는 영향이 없다.

### 대표님 테스트 정상 프로세스
1. Android에서 K-Bestie 앱의 `놀이` 화면으로 이동한다.
2. MBTI 또는 퀴즈마스터를 실행한다.
3. 상단 좌측에 `← 뒤로`가 아닌 `X 닫기`가 보이는지 확인한다.
4. `X 닫기`를 누른다.
5. 현재 놀이 PlayModal만 닫히고 `/child/play` 화면으로 돌아오는지 확인한다.
6. 같은 놀이를 다시 실행하고 다시 `X 닫기`를 누른다.
7. 위 과정을 최소 3회 반복한다.
8. 모달 안에 또 다른 모달/iframe/WebView가 겹쳐 나타나지 않는지 확인한다.
9. 황금열쇠가 놀이 시작 정책 외에 추가로 차감되지 않는지 확인한다.
10. MBTI와 퀴즈마스터 각각 동일하게 반복한다.
11. iPhone과 PC에서도 동일한 닫기 동작이 정상인지 확인한다.

PASS 기준:
- 모든 환경에서 PlayModal이 한 번에 하나만 존재한다.
- `X 닫기` 시 히스토리 이동 없이 현재 PlayModal만 종료된다.
- Android 중첩 창 문제가 재현되지 않는다.
- 황금열쇠 중복 차감이 없다.
- MBTI/퀴즈마스터 완료 callback에 회귀가 없다.

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 요청
- 우선순위: HIGH
- 대상 프로젝트: `/mnt/e/VibeCoding/K-Bestie-v3`
- 개발 주체: K-Bestie-v3 메인 앱 Claude Code
- 적용 대상: 공통 PlayModal / 놀이 실행 컨테이너
- 적용 놀이: MBTI, 퀴즈마스터, 향후 동일 PlayModal을 사용하는 독립 놀이 앱
- 제외: MBTI 독립 프로젝트 내부 UI/로직, 퀴즈마스터 독립 프로젝트 내부 UI/로직

## 2. 목표
현재 PlayModal 상단 좌측의 `← 뒤로` 동작을 제거하고 `X 닫기`로 통일한다. 특히 Android에서 `뒤로` 동작이 브라우저/라우터 히스토리를 타면서 모달 내부에 또 다른 화면·모달·iframe이 중첩되는 문제를 방지한다.

최종 목표:

```text
K-Bestie /child/play
  → 놀이 실행
  → PlayModal 1개 오픈
  → X 닫기
  → 현재 PlayModal 완전 unmount
  → /child/play 상태 유지
```

## 3. 요구사항

### 3-1. 상단 좌측 버튼 변경
기존:
- `← 뒤로`

변경:
- `X 닫기`

요구:
- 기존 디자인 시스템에 맞는 아이콘/버튼 스타일 사용
- 모바일 터치 영역 충분히 확보
- 접근성 label은 `닫기`

### 3-2. 닫기 동작
다음 방식 사용 금지:
- `history.back()`
- `window.history.back()`
- `router.back()`
- 브라우저 뒤로가기 의존
- iframe 내부 history 이동

닫기 동작은 반드시:
1. 현재 PlayModal open state를 false로 변경
2. iframe 또는 놀이 컨테이너 unmount
3. 관련 transient state 정리
4. `/child/play` 화면 상태 유지

### 3-3. 단일 PlayModal 보장
Android에서 반복 실행 시 다음 문제가 없어야 한다.
- PlayModal 위에 또 다른 PlayModal 생성
- iframe 중복 mount
- WebView 중첩
- 배경에 이전 놀이 화면 잔존
- 닫은 뒤 이전 iframe 이벤트 계속 수신

필요 시:
- open guard
- modal instance key
- cleanup effect
- iframe src 초기화
- event listener cleanup
- postMessage listener cleanup

적용.

### 3-4. 우측 종료 버튼 정리
현재 상단 우측에도 종료 아이콘이 존재하는 경우 기능 중복 여부를 확인한다.
- 종료 컨트롤은 하나의 명확한 UX로 통일
- 대표님 의도는 상단 좌측 `X 닫기`를 기본 종료 컨트롤로 사용하는 것
- 우측 종료 아이콘이 완전히 중복이면 제거 또는 비활성화 여부 판단
- 별도 네비게이션 기능이 있다면 임의 삭제 금지

### 3-5. 공통 적용
- MBTI와 퀴즈마스터 모두 동일한 PlayModal 종료 정책 사용
- 놀이별 별도 닫기 로직을 만들지 않고 가능한 범위에서 공통 PlayModal 단일 책임으로 처리

## 4. 기존 구조 확인
작업 전 반드시 확인:
- PlayModal 실제 구현 파일
- `/child/play`에서 놀이를 여는 state/handler
- MBTI PlayModal open/close 흐름
- 퀴즈마스터 PlayModal open/close 흐름
- iframe mount/unmount 방식
- postMessage listener 등록/해제
- route/history 사용 여부
- Android에서 중첩이 발생하는 실제 호출 순서
- iPhone에서 정상처럼 보이는 이유와 Android 차이

특히 현재 `뒤로` 버튼이 router navigation인지 browser history인지 내부 iframe navigation인지 근거를 확인한 뒤 수정한다.

## 5. 금지사항
- MBTI 독립 프로젝트 코드 수정 금지
- 퀴즈마스터 독립 프로젝트 코드 수정 금지
- 놀이 앱 UI/게임로직을 K-Bestie-v3로 이식 금지
- `history.back()` 계열을 닫기 동작으로 유지 금지
- iframe을 닫지 않고 display만 숨겨 재사용하는 방식 금지
- 중복 modal instance 허용 금지
- completion/refund callback 계약 변경 금지
- 황금열쇠 차감 로직 변경 금지
- 실제 가족 계정 자동화 테스트 금지
- QA 테스트 계정만 자동화 테스트에 사용

## 6. 모호성 처리
- 기존 우측 종료 아이콘이 별도 필수 기능을 가진 경우 임의 삭제하지 말고 기능 차이를 보고
- PlayModal이 놀이별로 서로 다른 구현이면 공통화 가능 범위를 먼저 보고하고 최소 수정
- Android 중첩 원인이 PlayModal이 아니라 브라우저/PWA history stack이면 근거를 제시하고 동일 목표를 만족하는 방식으로 수정
- 외부 독립 놀이 앱 내부 문제로 확인되면 K-Bestie-v3에서 임의 수정하지 말고 해당 프로젝트 이슈로 분리 보고

## 7. QA

### 7-1. Android
MBTI:
1. 실행
2. X 닫기
3. 재실행
4. X 닫기
5. 재실행
6. X 닫기

퀴즈마스터도 동일하게 3회 반복.

확인:
- 항상 모달 1개
- iframe 1개
- 중첩 없음
- 이전 화면 잔존 없음

### 7-2. iPhone
- MBTI/퀴즈마스터 각각 열기→닫기→재열기 3회
- 기존 정상 동작 회귀 없음

### 7-3. PC/PWA
- 열기→닫기→재열기 반복
- browser history stack 비정상 증가 없음
- 주소/라우트 이상 이동 없음

### 7-4. 황금열쇠
- 닫기 자체로 황금열쇠 추가 차감 없음
- 재실행 시 기존 신규 시작/이어하기 정책대로만 처리
- 중복 차감 없음

### 7-5. callback
- 정상 완료 후 completion callback 유지
- 실패 시 refund callback 유지
- X 닫기로 단순 종료한 경우 기존 정책 외 callback 중복 호출 없음

## 8. 완료조건
- 상단 좌측 `← 뒤로` 제거
- `X 닫기` 적용
- X 클릭 시 현재 PlayModal만 종료
- Android 모달/iframe/WebView 중첩 문제 해결
- iframe 정상 unmount 확인
- postMessage/listener cleanup 확인
- MBTI 회귀 없음
- 퀴즈마스터 회귀 없음
- 황금열쇠 중복 차감 없음
- completion/refund callback 영향 없음
- Android/iPhone/PC QA 통과
- Dev 배포 검증 완료
- Production 반영 후 실기기 확인 완료

## 9. 완료보고
완료 후 다음을 보고한다.
- 최종 원인
- 변경 파일 목록
- 기존 `뒤로` 동작이 무엇을 호출하고 있었는지
- 새 `X 닫기` 처리 방식
- PlayModal 단일 instance 보장 방식
- iframe unmount 방식
- listener cleanup 방식
- Android 3회 반복 테스트 결과
- iPhone 3회 반복 테스트 결과
- PC/PWA 테스트 결과
- 황금열쇠 회귀 테스트 결과
- completion/refund callback 테스트 결과
- Dev 배포 URL
- Production 배포 URL
- 배포 커밋
