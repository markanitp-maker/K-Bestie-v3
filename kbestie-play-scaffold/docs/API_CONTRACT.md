# 메인 앱(K-Bestie-v3)과 K-Play 연동 API 계약

본 문서는 K-Bestie-v3(메인 앱)과 K-Play(분리된 놀이 앱) 간의 놀이 세션 및 황금열쇠 예약과 관련된 연동 규격을 정의합니다.

## 1. K-Bestie-v3 제공 API 명세

K-Bestie-v3는 놀이 세션을 통제하기 위해 다음의 4가지 API를 제공합니다. K-Play 앱 혹은 메인 앱의 클라이언트는 놀이 진입 전 이 API들을 호출하여 세션과 재화(황금열쇠)를 안전하게 관리합니다.

### 1.1. `POST /api/play/reserve`
새로운 놀이를 위한 황금열쇠를 예약(차감 대기)합니다.
- **Request Body**:
  ```json
  {
    "child_id": "uuid",
    "play_type": "comic_book | quiz | mbti | hairstyle"
  }
  ```
- **Response**:
  - `200 OK`: `{"reservation_id": "uuid", "reason": "ok"}`
  - `400 Bad Request`: 필수 파라미터 누락 등
  - `401 Unauthorized`: 로그인 필요
  - `402 Payment Required`: 황금열쇠 부족 (`{"error": "insufficient_balance"}`)
  - `403 Forbidden`: 아동 접근 권한 없음
  - `409 Conflict`: 이미 진행 중인 놀이 존재 (`{"error": "already_in_progress"}`)
  - `500 Internal Server Error`: DB 처리 실패

### 1.2. `POST /api/play/start`
발급받은 예약 ID를 기반으로 실제 놀이 세션을 시작하고 예약된 열쇠를 확정 차감합니다.
- **Request Body**:
  ```json
  {
    "child_id": "uuid",
    "play_type": "string",
    "reservation_id": "uuid"
  }
  ```
- **Response**:
  - `200 OK`: `{"session_id": "uuid", "reason": "ok"}`
  - `400 / 500 Error`: 세션 생성 실패 시 발급되었던 `reservation_id` 롤백(복구) 처리 후 에러 반환.

### 1.3. `POST /api/play/restart`
과거 완료되었거나 초기화가 필요한 놀이를 처음부터 다시 시작합니다(열쇠 재차감). `reserve`와 `start` 과정을 내부적으로 한 번에 처리합니다.
- **Request Body**:
  ```json
  {
    "child_id": "uuid",
    "play_type": "string"
  }
  ```
- **Response**:
  - `200 OK`: `{"session_id": "uuid", "reason": "ok"}`
  - 기타 에러는 `reserve` 및 `start`와 동일한 방식으로 처리/롤백됩니다.

### 1.4. `GET /api/play/session`
특정 놀이의 진행 중인 세션 상태를 조회하여 이어서 할 수 있는지(Resume) 확인합니다.
- **Query Params**: `?child_id={uuid}&play_type={string}`
- **Response**:
  - `200 OK`: 
    ```json
    {
      "canResume": true | false,
      "progressState": { ... } | null,
      "sessionId": "uuid" | null
    }
    ```

---

## 2. K-Play의 세션 진행상태(progress_state) 동기화 방안

K-Play 앱이 개별 게임의 진척도를 저장해야 할 때, 동일한 Supabase 프로젝트를 공유하므로 **직접 DB를 업데이트하는 방식을 권장**합니다. 또는 메인 앱에 진행상태 동기화 API를 추가할 수 있습니다.

### 제안: Supabase 클라이언트를 통한 직접 업데이트 (권장)
K-Play 앱은 인증된 유저 세션을 통해 `k_play_sessions` 테이블에 직접 접근할 수 있으므로, 별도의 API 없이 `progress_state` 컬럼을 업데이트합니다.

```typescript
// K-Play 앱 내부 동기화 로직 예시
const { error } = await supabase
  .from('k_play_sessions')
  .update({
    progress_state: { currentStep: 3, score: 100 },
    // 놀이가 완전히 끝났다면 상태를 업데이트
    // status: 'completed' 
  })
  .eq('id', currentSessionId);
```

> **대안**: 메인 앱(K-Bestie-v3) 측에 `PUT /api/play/session` 혹은 `PATCH /api/play/session` 엔드포인트를 신규 구축하여 K-Play에서 이를 호출하는 방식도 고려 가능합니다. 다만, 동일한 Supabase 인프라 내에서는 DB 직접 업데이트가 네트워크 홉(hop)을 줄이고 효율적입니다.

---

## 3. 메인 앱 ↔ K-Play 연동 진입점 (Entry Point)

- **위치**: 현재 메인 앱의 `app/child/play/page.tsx`
- **방식**: 해당 페이지 내의 "게임 진입 모달 (전체화면)" 부분이 향후 K-Play 앱으로 연동되는 **주요 진입점**이 됩니다.
- **동작**: 현재는 '준비중' 플레이스홀더 텍스트만 표시되지만, 분리가 완료된 시점에는 이 모달 영역이 `iframe`으로 K-Play URL을 띄우거나, K-Play 앱으로 외부 **URL 리다이렉트** (세션 토큰 및 쿼리 파라미터 포함) 되도록 변경될 예정입니다. (본 스캐폴드에서는 메인 앱 코드를 수정하지 않습니다.)
