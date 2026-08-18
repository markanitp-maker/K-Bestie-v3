# 게임 참여 공통 생명주기 — 신규 놀이 타입 추가 가이드

작성일: 2026-07-25 (MBTI 네이티브 통합 직후 공통 인프라 리팩터링)

이 문서는 MBTI에서 실제로 검증된 놀이 생명주기(playSessionId 기반 인증, 황금열쇠
차감, progress_state 네임스페이스 저장, 이어하기, 완료 이벤트)를 comic_book/quiz/
hairstyle 등 다른 놀이 타입도 그대로 재사용할 수 있도록 정리한 것이다. **지금 이
저장소에 comic_book/quiz/hairstyle의 실제 게임 화면·콘텐츠는 아직 없다** —
`app/child/play/page.tsx`에서 이 세 타입은 여전히 "준비 중" placeholder만
보여준다. 이 문서는 그 셋을 지금 구현하는 것이 아니라, 나중에 구현할 때 따라야 할
**패턴**을 고정하는 것이 목적이다.

## 계층 구조 (이미 존재, 그대로 재사용)

```
[1] 세션 생성/재화 차감 계층 — 4종 놀이 공통, 이미 완성됨, 수정 불필요
    /api/play/consume   (POST) 신규 시작 또는 이어하기, 황금열쇠 차감
    /api/play/session   (GET)  canResume 여부 + progress_state 조회(모달 표시용)
    /api/play/restart   (POST) 기존 세션 폐기 후 재시작
    /api/play/progress  (POST) 루트 progressPercent만 기록(구 iframe 놀이용,
                                네이티브 놀이는 보통 [2]에서 자체 progressPercent를
                                같이 갱신하므로 이 라우트를 안 써도 됨)
    /api/play/callback/{complete,refund} (구 iframe 놀이 전용 콜백)
    /api/play/bug-report

[2] 놀이별 진행/완료 계층 — 게임마다 새로 만들어야 함, 이 문서의 대상
    /api/<playType>/progress  (POST) 문항/선택지 등 게임 고유 진행 상태 저장
    /api/<playType>/session   (GET)  이어하기 재수화(해당 게임의 상세 상태만)
    /api/<playType>/complete  (POST) 게임별 완료 판정 + 결과 저장

[3] 화면 계층 — 게임마다 새로 만들어야 함
    app/play/<playType>/page.tsx       엔트리 페이지
    components/<playType>/*            실제 게임 UI
```

`app/api/mbti/{progress,session,complete}/route.ts`가 [2] 계층의 참조 구현이다.

## [2] 계층에서 반드시 재사용할 공통 모듈

### `lib/play/sessionAuth.ts`

```ts
import { loadPlaySession } from "@/lib/play/sessionAuth";

const validity = await loadPlaySession(service, sessionId, "quiz");
// validity.valid === false 이면 validity.reason으로 분기해 라우트 고유의
// 상태코드/메시지를 스스로 정한다(진행저장/완료는 보통 409, 조회는 보통 404 —
// MBTI 세 라우트의 실제 분기를 그대로 참고할 것. 강제되는 규칙은 아니다).
```

- `id`+`play_type` 일치, `resume_expires_at`(6시간 이어하기 창) 미경과, `status
  ='in_progress'`를 확인한다. Supabase Auth 쿠키는 절대 확인하지 않는다 — 세션
  생성 시점([1] 계층)에 이미 쿠키+`requireChildAccess`로 인증이 끝났으므로,
  playSessionId 자체가 capability token 역할을 한다.
- 조회(GET)류 라우트에서 소유권(child_id) 검증이 필요하면 4번째 인자
  `expectedChildId`를 넘긴다 — 그러면 만료/상태 검사보다 **먼저** `forbidden`을
  반환한다(GET /api/mbti/session의 실제 계약과 동일한 순서).
- 진행저장/완료처럼 sessionId만으로 충분한 쓰기 라우트는 `expectedChildId`를
  넘기지 않는다(MBTI의 원래 설계 — 대표님이 2026-07-25 명시적으로 유지 지시).

### `lib/play/progressState.ts`

```ts
import {
  buildProgressState, readNamespace, saveProgressWithVersionCas,
} from "@/lib/play/progressState";

const existing = readNamespace(sessionRow.progress_state, "quiz"); // 이 게임의 기존 상세 상태
const stored = /* 이 게임이 정의한 파서로 existing을 검증/파싱 */;
const nextState = buildProgressState(sessionRow.progress_state, "quiz", nextQuizState, {
  progressPercent: /* 0~100 */,
});
const result = await saveProgressWithVersionCas(
  service, sessionId, "quiz", stored?.progressVersion ?? null, requestVersion, nextState,
);
```

- **네임스페이스 규칙(반드시 지킬 것)**: 게임의 상세 상태는 항상
  `progress_state.<playType>` 아래에만 쓴다. 루트 레벨에는 `progressPercent`
  하나만 두고, 다른 놀이 타입의 네임스페이스나 이 필드를 직접 건드리지 않는다.
  이 규칙을 어기면 MBTI에서 실제로 겪었던 "progress_state 통째 덮어쓰기로 다른
  놀이의 진행 상태가 사라지는" 버그가 재발한다.
- `buildProgressState`의 세 번째 인자(`namespaceValue`)를 "완전 교체"로 줄지
  "기존 필드와 병합"으로 줄지는 게임이 결정한다(진행 저장은 보통 교체, 완료
  처리는 보통 병합 — MBTI의 progress/complete 라우트가 각각의 예시다).
- `saveProgressWithVersionCas`는 `progressVersion` 기반 CAS를 수행한다 —
  게임마다 이 버전 개념(단조 증가 카운터)을 그대로 채택해야 동시 저장 경쟁을
  안전하게 막을 수 있다.

### `lib/play/completion.ts`

```ts
import { completeInProgressSession } from "@/lib/play/completion";

const completedAt = new Date().toISOString();
const nextState = buildProgressState(sessionRow.progress_state, "quiz", {...}, { progressPercent: 100 });
const { isWinner, error } = await completeInProgressSession(service, sessionId, nextState, completedAt);
// isWinner === true 일 때만 이 게임의 완료 후속 처리(리포트 이벤트 기록 등)를 실행한다.
```

- `status: 'in_progress' → 'completed'` CAS 전이. 두 완료 요청이 동시에 와도
  하나만 `isWinner: true`가 된다 — 진 쪽은 오류가 아니라 idempotent 결과다.
- **완료 후속 이벤트(부모 리포트 등)는 공통 모듈에 넣지 않는다.** MBTI는
  `mbti_completion_events` 테이블 + `recordMbtiCompletionEvent()`를 쓰지만, 이건
  MBTI 전용 스키마다. 새 게임이 비슷한 리포트 이벤트가 필요하면, 그 게임 전용
  테이블(예: `quiz_completion_events`)과 기록 함수를 새로 만들고 `isWinner`
  분기에서 호출하면 된다 — 아직 두 번째 실제 소비자가 없는 상태에서 공용 이벤트
  테이블 스키마를 미리 설계하는 것은 이번 리팩터링 범위 밖으로 판단했다(YAGNI).

## 새 놀이 타입을 추가하는 절차 (요약)

1. `lib/data/<playType>*.ts` — 그 게임 고유 콘텐츠/타입 정의.
2. `lib/<playType>/*.ts` — 그 게임 고유 로직(채점 등, MBTI의 `scoreResult.ts`처럼
   AI 무관 순수 함수 권장).
3. `lib/api/<playType>*.ts` — 클라이언트 fetch 계약(요청/응답 타입, 에러 클래스) —
   MBTI의 `lib/api/mbtiProgress.ts`/`mbtiComplete.ts`/`fetchMbtiSessionProgress.ts`
   형태를 그대로 복제.
4. `app/api/<playType>/{progress,session,complete}/route.ts` — 위 공통 3모듈만
   조합. 새로운 인증 방식·새로운 CAS 로직을 만들지 않는다.
5. `components/<playType>/*.tsx` + `app/play/<playType>/page.tsx` — 화면. 세션
   생성은 `app/child/play/page.tsx`의 기존 모달 흐름(`/api/play/consume` →
   `sessionStorage` 핸드오프 → `router.push("/play/<playType>")`)을 그대로
   재사용한다(`lib/play/mbtiSessionHandoff.ts` 패턴 참고 — 필요하면 playType을
   매개변수로 받는 범용 핸드오프 헬퍼로 일반화해도 되지만, 현재는 소비자가 하나뿐이라
   그대로 두었다).
6. `app/child/play/page.tsx`의 `GAMES` 배열 + `handleStart`/`handleResume`에 그
   놀이 타입 분기를 추가한다(현재 mbti 분기를 그대로 참고).

## 이번 리팩터링에서 의도적으로 하지 않은 것

- comic_book/quiz/hairstyle의 실제 게임 구현 — 콘텐츠·기획이 없는 상태라 범위 밖.
- 공용 완료 이벤트 테이블 신설 — 소비자가 MBTI 하나뿐이라 시기상조.
- `app/api/play/consume`/`reserve`/`start`/`restart` 등 [1] 계층 수정 — 이미 4종
  놀이가 공유하는 완성된 인프라라 손대지 않았다.
- `lib/play/mbtiSessionHandoff.ts`의 범용화(playType 매개변수 추가) — 현재
  소비자가 MBTI 하나뿐이라 이름 그대로 두고, 두 번째 네이티브 게임이 실제로
  생길 때 일반화하는 편이 과설계를 피할 수 있다고 판단했다.
