---
contract-version: 1.0.0
owner: k-bestie-v3
consumers: [k-toon]
status: active
created: 2026-08-20
---

# K-Bestie-v3 ↔ 독립 놀이 앱 통합 계약 (정본)

이 문서가 **유일한 정본**이다. 사본을 두는 리포는 상단 `contract-version:` 을 명시하고, 계약 변경은 **K-Bestie-v3 쪽 큐 작업으로만** 시작한다. 계약에 없는 필드를 워커가 임의로 추가하면 게이트 ①에서 실패 처리한다.

## 0. 작성 근거

전 항목이 **2026-08-20 READ-ONLY 실행 경로 조사**와 확정된 `K-Toon/.omc/plans/prd-k-toon.md`·`K-Toon/.omc/plans/test-spec-k-toon.md` 에 기반한다.

⛔ **다음 모듈은 저장소 전체에서 호출자 0건인 죽은 코드다. 계약 근거로 사용하지 않는다.**
- `lib/play/progressState.ts` (`buildProgressState`, `saveProgressWithVersionCas`)
- `lib/play/sessionAuth.ts` (`loadPlaySession`)
- `lib/play/completion.ts` (`completeInProgressSession`)

살아있는 경로는 `lib/play/internalEventHandler.ts` + `app/api/internal/play/*` 다.

---

## 1. 놀이 등록

| 항목 | 값 | 근거 |
|---|---|---|
| K-Toon Play ID | `comic_book` | `k_play_sessions.play_type` CHECK (`20260718100000:63`) |
| 등록 테이블 | `play_registry` | `20260760000000:36-47` |
| `keys_cost` **Source of Truth** | `play_registry.keys_cost`. `comic_book = 2` | `execution-ticket/route.ts:65,79` 가 레지스트리에서 읽는다 |
| resume TTL | `play_registry.resume_ttl_hours` — `mbti = 6`, `comic_book = 5`, 신규 놀이 DEFAULT `6` | 2026-08-20 승인 (D1) |

`play_registry` 에는 표시·운영 메타데이터만 둔다. **upstream URL·서명 비밀값은 저장하지 않는다** — 서버 전용 환경변수와 `next.config.ts` rewrite 에서만 관리한다.

⚠️ `play_execution_tickets.play_id` 가 `play_registry(play_id)` 를 참조한다. 레지스트리 행이 없으면 티켓 발급이 FK 위반으로 실패한다.

### resume TTL 계약

`resume_expires_at` 을 설정하는 지점은 **`exchange_play_execution_ticket` 의 `k_play_sessions` INSERT 하나뿐**이다. 값은 `now() + make_interval(hours => play_registry.resume_ttl_hours)` 다.

- `resume_expires_at IS NULL` 은 살아있는 코드에서 **"만료 없음"** 으로 해석된다 (`api/play/session/route.ts:81-84`, `20260805190000:139,155`). NULL 을 만료로 읽는 `sessionAuth.ts:69` 는 죽은 코드다.
- `expires_at` 은 `now() + interval '24 hours'` 다. 이어하기 판정에 쓰이는 값은 `resume_expires_at` 이다.
- `reserve_gold_keys_for_play`, `start_new_play_session`, `consume_play_access` 는 **티켓 경로에서 호출되지 않는다.** TTL 을 이유로 수정하지 않는다.

---

## 2. 인증 (Internal API)

모든 `/api/internal/play/*` 는 서버 대 서버 전용이다. 브라우저가 직접 호출할 수 없다.

| 헤더 | 값 |
|---|---|
| `Authorization` | `Bearer <놀이별 서버 전용 키>` |
| `X-Play-Id` | `comic_book` |
| `X-Timestamp` | ISO8601. 허용 오차 **±5분** |
| `Idempotency-Key` | `progress`/`complete`/`close`/`error` 에 **필수** |

키는 `lib/play/internalApiAuth.ts` 의 `INTERNAL_API_KEYS_BY_PLAY_ID` 맵에 놀이를 추가해야 인식된다. 값은 서버 전용 환경변수로만 존재한다 (K-Toon: `COMIC_BOOK_INTERNAL_API_KEY`).

### 인증 실패 코드

| reason | HTTP |
|---|---|
| `missing_play_id` | 401 |
| `unknown_play_id` (미등록 놀이 또는 env 키 누락) | 401 |
| `invalid_credentials` | 401 |
| `missing_timestamp` | 401 |
| `timestamp_out_of_range` | 401 |

---

## 3. 실행 흐름

```
K-Bestie  app/child/play/page.tsx
   │  startTicketBasedPlay(childId, playId)
   ▼
POST /api/play/execution-ticket   { childId, playId, mode: start|restart|resume }
   │   ├─ start/restart → reserve_gold_keys_for_play  (예약만. 세션 없음)
   │   └─ resume        → 기존 in_progress 세션 확인. 예약 없음 = 추가 차감 없음
   │   → issue_play_execution_ticket → ticketToken (1회용) + 쿠키
   ▼
독립 놀이 앱
POST /api/internal/play/exchange-ticket  { ticketToken }
   │   → exchange_play_execution_ticket
   │     · 기존 in_progress 세션이 있으면 재사용
   │     · 없으면 INSERT (여기서 resume_expires_at 설정)
   │   ← { playSessionId, childId, progressState }
   ▼
POST /api/internal/play/ready  { ticketToken }
   │   ★ 이 시점에만 황금열쇠를 confirm(확정 차감)한다
   ▼
POST /api/internal/play/progress  (반복)
   │
   ├─ POST /api/internal/play/close     중도 종료. 세션 in_progress 유지
   ├─ POST /api/internal/play/error     오류 보고. 상태 전환 없음
   └─ POST /api/internal/play/complete  terminal. status → 'completed'
```

### 차감 시점 (중요)

- **exchange 는 confirm 하지 않는다.** ready 호출이 오지 않으면 이후 다른 티켓 조작 시 lazy restore 된다.
- `mode=resume` 은 예약을 만들지 않는다 → **이어하기·재열람은 추가 차감 0**.
- `mode=restart` 는 기존 활성 세션을 `expired` 로 만들고 새 예약을 만든다 → 정상 차감.

---

## 4. Progress 봉투 (공통)

플랫폼이 이해하는 필드는 5개뿐이다. 나머지는 `opaquePayload` 안에 넣는다.

```ts
{
  playSessionId: string,
  currentStep?: number,     // 놀이별 의미. K-Toon = 현재 페이지(1-based)
  totalSteps?: number,      // K-Toon = 전체 페이지 수
  payloadVersion?: number,
  revision?: number,        // 단조 증가. 역순/동일이면 409 stale_revision
  opaquePayload?: unknown   // 플랫폼이 해석하지 않고 저장·반환
}
```

### ⚠️ 병합 의미가 엔드포인트마다 다르다

| 엔드포인트 | `opaquePayload` 처리 | 결과 |
|---|---|---|
| `progress` | `mergeOpaquePayload(existing, incoming)` — **plain object shallow merge** | 부분 전송 가능. 기존 키 보존 |
| `complete` | 동일 shallow merge | 부분 전송 가능 |
| `close` | `body.opaquePayload ?? existing` — **치환** | **부분 전송 시 기존 키 소실** |
| `error` | 동일 치환 | **부분 전송 시 기존 키 소실** |

→ **`close` / `error` 에서는 `opaquePayload` 를 아예 보내지 않거나(기존 값 유지), 전체 상태를 보낸다.** 일부만 보내면 안 된다.

### 동시성

`revision` 단조 증가 가드 + `Idempotency-Key` 캐시로 방어한다. **원자적 CAS 가 아니다** — `internalEventHandler.ts` 는 read-modify-write 이며 동일 세션 동시 쓰기 경합 창이 있다. 세션당 단일 클라이언트를 전제로 한다.

---

## 5. K-Toon `opaquePayload` 스키마

```ts
{
  selectedBookId: string,        // 확정된 책. 서버 검증 값
  selectedBookVersion: number,   // 시작 당시 버전. 세션 내 불변
  completedOnce?: boolean,       // 최초 완독 시 true. 이후 변경 금지
  completedAt?: string           // ISO8601. completedOnce와 함께 1회만 기록
}
```

- `selectedBookId` / `selectedBookVersion` 은 클라이언트가 임의 변경할 수 없다. 서버가 검증한다.
- `completedOnce` 가 이미 true 면 `completedAt` 을 덮어쓰지 않는다.
- 현재 페이지는 `opaquePayload` 가 아니라 봉투의 `currentStep` 에 넣는다.

---

## 6. terminal Complete 의 의미

`POST /api/internal/play/complete` 는 `k_play_sessions.status` 를 `'completed'` 로 전환하는 **terminal** 호출이다. `completed` 세션은 `exchange_play_execution_ticket` 의 `in_progress` 전용 조회에 걸리지 않아 **재사용되지 않으며**, `execution-ticket` 의 resume 분기도 404 를 낸다.

### K-Toon 은 완독 시 Complete 를 호출하지 않는다

만화책은 "완독"과 "이용권 종료"가 다르다. 5시간 안에는 같은 책을 다시 읽을 수 있어야 하므로:

| K-Toon 이벤트 | 호출 | 세션 상태 |
|---|---|---|
| 마지막 페이지 최초 도달 | `progress` (`completedOnce`/`completedAt` 기록) | `in_progress` 유지 |
| 아이가 나가기 / X | `close` | `in_progress` 유지 |
| 5시간 만료 | 호출 없음 | 기존 lazy 만료 경로로 `expired` |
| 다른 책으로 전환 | `execution-ticket mode=restart` | 기존 세션 `expired` + 신규 |

**MBTI·Quiz 의 기존 Complete 의미는 변경하지 않는다.**

---

## 7. 회원·아이 식별

- 부모/아이 인증과 `child_id` 확정은 **K-Bestie 책임**이다. 독립 놀이 앱은 부모/아이 인증 쿠키를 직접 사용하지 않는다.
- `childId` 는 `exchange-ticket` 응답으로만 전달된다. 놀이 앱은 이 값을 세션 스코프 식별자로만 쓴다.
- 놀이 앱에 **플랫폼 Service Role Key 를 전달하지 않는다.**

## 8. K-Toon 의 Supabase 직접 접근 금지

K-Toon 런타임은 Supabase 자격증명을 보유하지 않고 직접 조회하지 않는다. 아래는 K-Toon 에 절대 노출하지 않는다.

```
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
parent access token
gold key 원장 직접 접근
```

콘텐츠도 세션도 **Internal API 를 통해서만** 접근한다. 관리자 쓰기는 K-Bestie-v3 server-side Admin API 만 수행한다.

---

## 9. Content API (K-Toon 전용, 신규)

인증은 §2 와 동일한 `verifyInternalPlayRequest` 를 재사용한다.

### `GET /api/internal/play/comic/catalog`

```ts
// 200
{
  books: Array<{
    bookId: string,
    title: string,
    synopsis: string,
    coverUrl: string,      // signed URL. 응답 시점 발급
    pageCount: number,
    version: number        // 현재 published 버전
  }>
}
```

공개(`is_published`)이고 `deleted_at IS NULL` 인 책만 반환한다.

### `GET /api/internal/play/comic/book/{bookId}?version={n}`

```ts
// 200
{
  bookId: string,
  version: number,
  title: string,
  synopsis: string,
  pages: Array<{ pageNumber: number, url: string }>,  // 0 = 표지
  pageCount: number
}
```

- `version` 을 지정하면 **그 버전을 반환한다.** 진행 중 세션은 `selectedBookVersion` 을 항상 명시한다.
- 삭제 요청(`deleted_at`)된 책이라도 **활성 세션이 참조하는 버전은 정상 제공**한다.
- 존재하지 않는 버전 → 404.

### signed URL 정책

- URL 은 **응답 시점에 서버가 발급**한다. DB·`progress_state` 어디에도 URL 문자열을 저장하지 않는다. 저장하는 것은 asset identifier/path 다.
- 만료된 URL 로 이미지 로딩이 실패하면 K-Toon 은 **재발급을 요청**한다. 세션이 5시간이므로 URL TTL 보다 길 수 있다.

### 저장소 규칙

- 메타데이터: K-Bestie-v3 Supabase (`game_comic_*`, RLS 필수)
- 이미지 원본: **K-Toon 전용 Storage 버킷**(private). 경로 `comic/{bookId}/{version}/{NN}.{ext}`
- 기존 `feedback-attachments` 버킷을 재사용하지 않는다
- 같은 경로를 **overwrite 하지 않는다.** 이미지 변경은 새 버전 경로를 만든다

---

## 10. 에러 코드

### 티켓 발급 (`/api/play/execution-ticket`)

| 코드 | HTTP | 의미 |
|---|---|---|
| `play_not_available` | 404 | 레지스트리에 없거나 `is_active=false` |
| `already_in_progress` | 409 | 활성 세션 존재 (start 시도) |
| `insufficient_balance` | 402 | 황금열쇠 부족 |
| `no_session_to_resume` | 404 | resume 대상 없음 또는 만료 |
| `reserve_failed` | 500 | 예약 RPC 실패 |

### 티켓 교환 (`/api/internal/play/exchange-ticket`)

| 코드 | HTTP |
|---|---|
| `invalid_json` | 400 |
| `ticketToken required` | 400 |
| `expired` / `not_found` | 410 |
| 그 외 `reason` | 409 |
| `exchange_failed` | 500 |

### 이벤트 공통

| 코드 | HTTP |
|---|---|
| `stale_revision` | 409 |
| `play_id_mismatch` | 403 |
| `update_failed` | 500 |

동일 `Idempotency-Key` 재요청은 최초 응답 본문을 그대로 반환하고 부작용을 재실행하지 않는다 (`play_internal_event_idempotency`).

---

## 11. 임베드 방식

- 독립 놀이 앱은 K-Bestie 도메인의 **경로 마운트 리버스 프록시**로 노출한다. MBTI 기준 구현은 `app/play/mbti/[[...path]]/route.ts` 다.
- ⚠️ 단순 rewrite 는 실패한 적이 있다. 업스트림의 CSP `frame-ancestors 'none'` 때문에 **2026-08-03 Production 장애**(빈 화면)가 발생했다. 신규 놀이 프록시는 그 대응을 반드시 포함한다.
- 아이용 진입 래퍼는 `app/child/play/<playId>/page.tsx` 에 둔다.
- `app/child/play/page.tsx` 의 시작·이어하기·새로 시작 분기는 현재 놀이 ID 별 하드코딩이다. 티켓 기반 놀이는 `startTicketBasedPlay` 경로로 넣어야 하며, 카드의 `comingSoon` 만 해제하면 레거시 경로로 떨어진다.

---

## 12. 버전 정책

- `contract-version` 은 semver 를 따른다. 소비 리포는 사본 상단에 자신이 맞춘 버전을 적는다.
- 필드 추가는 minor, 의미 변경·필드 제거는 major.
- 계약 변경은 K-Bestie-v3 쪽 큐 작업으로만 시작한다. 놀이 리포에서 계약 파일을 먼저 고치지 않는다.

## 13. 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| 1.0.0 | 2026-08-20 | 최초 작성. K-Toon(`comic_book`) 통합을 위해 기존 MBTI 실행 경로를 실측해 명문화. `resume_ttl_hours` play별 TTL, Content API, `close`/`error` 치환 의미 경고 포함 |
