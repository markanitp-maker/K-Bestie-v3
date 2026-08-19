# Discord 문의·건의·버그 알림 내용 표시 길이 1024자 확장

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- Discord 신규 문의·건의·버그 알림의 `내용`이 현재 20자에서 최대 1024 Unicode 코드포인트까지 표시된다.
- 내용이 1024자 이하이면 원문이 잘리지 않고 그대로 표시된다.
- 내용이 1024자를 초과하면 `앞 1023자 + …`로 표시되어 최종 길이가 1024자를 넘지 않는다.
- 기존 `유형`, `제목`, 관리자 페이지 링크 및 Discord Embed 구조는 그대로 유지된다.
- 기존 제목 최대 100자 정책은 변경되지 않는다.
- 문의·건의·버그 접수 자체와 관리자 화면에는 변화가 없다.

### 대표님 테스트 정상 프로세스
1. Dev 환경에서 20자를 초과하는 문의·건의 또는 버그 내용을 접수한다.
2. Discord 신규 접수 알림을 확인한다.
3. 기존처럼 20자에서 내용이 잘리지 않는지 확인한다.
4. 일반적인 긴 문의 내용이 Discord에서 충분히 표시되는지 확인한다.
5. 1024자 이하 내용이 말줄임 없이 전체 표시되는지 확인한다.
6. 1024자를 초과하는 테스트 데이터는 최대 1024자까지만 표시되는지 확인한다.
7. Discord 알림에서 기존 유형·제목·관리자 페이지 이동 기능이 그대로 동작하는지 확인한다.

PASS 기준:
- 20자 제한이 완전히 제거된다.
- 1024자 이하 내용은 원문 그대로 표시된다.
- 1024자 초과 내용은 `1023자 + …`로 정확히 제한된다.
- 기존 Discord 알림 구조와 CS 기능에 회귀가 없다.

## 1. 상태 / 우선순위 / 대상

- 상태: TODO
- 우선순위: LOW
- 대상 프로젝트: K-Bestie-v3
- 개발 주체: Claude Code / Codex
- 적용 대상: Discord 신규 문의·건의·버그 Webhook 알림의 `내용` field
- 제외 대상:
  - 문의·건의·버그 입력 UI
  - 관리자 UI
  - DB Schema
  - Supabase
  - Discord Webhook URL 및 환경변수
  - 제목 최대 길이 정책
  - Discord 알림의 유형·URL 구조

## 2. 목표

현재 Discord 신규 문의·건의·버그 알림의 `내용`은 `truncateContent()`에서 20 Unicode 코드포인트까지만 표시되고 이후 `…`로 잘린다.

운영자가 Discord만 보고도 문의 내용을 충분히 파악할 수 있도록 Discord Embed `field.value`에서 사용할 내용 표시 길이를 최대 1024 코드포인트까지 확장한다.

정상 구조:

```text
내용 길이 <= 1024
→ 내용 전체 표시

내용 길이 > 1024
→ 앞 1023 Unicode 코드포인트 + …
→ 최종 최대 1024 코드포인트
```

이번 수정은 Discord 내용 표시 길이만 변경하는 최소 수정이다.

## 3. 요구사항

### 3-1. `truncateContent()` 제한 변경

실제 구현 파일의 `truncateContent()` 기본 최대 길이를 현재 `20`에서 `1024`로 변경한다.

현재 확인된 구조:

```ts
truncateContent(content, maxChars = 20)
```

변경 목표:

```ts
truncateContent(content, maxChars = 1024)
```

### 3-2. 1024자 이하 처리

`Array.from(content).length <= 1024`인 경우:

- 원문 전체를 그대로 반환한다.
- `…`를 추가하지 않는다.
- 불필요한 substring/slice 처리를 하지 않는다.

### 3-3. 1024자 초과 처리

1024 Unicode 코드포인트를 초과하는 경우:

```text
앞 1023 코드포인트 + …
```

방식으로 처리한다.

최종 결과:

```ts
Array.from(result).length === 1024
```

를 만족해야 한다.

말줄임표 `…` 자체도 1 코드포인트로 계산한다.

### 3-4. Unicode 처리 유지

현재 `Array.from()` 기반 Unicode 코드포인트 처리 방식을 유지한다.

다음을 정상 처리해야 한다.

- 한글
- 영문
- 숫자
- 이모지
- 혼합 문자열

이번 요청에서 별도의 grapheme segmentation 라이브러리는 추가하지 않는다.

### 3-5. 기존 Discord 구조 유지

다음은 변경하지 않는다.

- `유형` field
- `제목` field
- Discord Embed field name
- 관리자 페이지 URL
- Discord Embed 클릭 링크
- Webhook 호출 방식
- Discord 메시지 디자인

### 3-6. 기존 입력 제한 유지

기존 제목 DB/API 제한:

```text
최대 100자
```

를 그대로 유지한다.

문의 내용 DB/API 최대 입력 제한도 이번 작업에서 변경하지 않는다.

## 4. 기존 구조 확인

작업 전 반드시 실제 코드에서 다음을 다시 확인한다.

- `lib/support/discord.ts`
- `truncateContent()` 실제 구현 위치
- `buildSupportDiscordPayload()` 호출 구조
- `내용` field가 실제로 `truncateContent()`를 사용하는지
- `lib/support/discord.test.ts`
- 문의·건의·버그 신규 접수 후 Discord Webhook까지 이어지는 호출 흐름

현재 확인된 Source of Truth:

```text
lib/support/discord.ts
```

현재 문제 발생 경로:

```text
문의/건의/버그 접수
→ Discord payload 생성
→ truncateContent(content, 20)
→ 앞 20자 + …
→ Discord Webhook 전송
```

현재 확인된 실질 문제:

```text
내용 최대 20 Unicode 코드포인트
```

조사 결과 실제 구현 위치나 함수명이 달라져 있다면 현재 코드의 Source of Truth를 기준으로 최소 수정한다.

## 5. 금지사항

- DB Migration 생성 금지
- Supabase Schema 변경 금지
- Discord Webhook URL 변경 금지
- 환경변수 변경 금지
- Discord Embed 전체 구조 재설계 금지
- 신규 Discord Bot 구현 금지
- 제목 최대 100자 정책 변경 금지
- 문의·건의·버그 입력 최대 길이 변경 금지
- 관리자 UI 변경 금지
- 사용자 UI 변경 금지
- 관련 없는 리팩터링 금지
- 새로운 문자열 처리 라이브러리 도입 금지
- Production 실사용 문의 데이터를 테스트 데이터로 사용 금지

## 6. 모호성 처리

- 실제 `truncateContent()` 구현이 현재 조사 결과와 다르면 최신 코드의 실제 호출 경로를 Source of Truth로 사용한다.
- 이미 다른 작업으로 최대 길이가 1024로 변경되어 있다면 중복 수정하지 말고 현재 상태와 테스트 결과만 보고한다.
- Discord 내용 field 외 다른 field에서 별도의 길이 문제가 발견되더라도 이번 Request 범위에 포함하지 않는다.
- Discord 플랫폼 제한과 우리 코드 자체 제한이 다를 경우 이번 Request에서는 `내용 field 최대 1024` 요구사항만 적용한다.
- 예상과 다른 구조가 발견되어도 CS 전체 구조를 재설계하지 말고 가장 작은 변경으로 목표를 달성한다.
- 다른 프로젝트 또는 별도 Discord 모듈의 문제라면 이번 작업과 분리하여 보고한다.

## 7. QA

### 7-1. 1024자 미만 테스트

1000 Unicode 코드포인트의 내용을 입력한다.

PASS:
- 원문 전체가 그대로 반환된다.
- 말줄임표가 추가되지 않는다.

### 7-2. 정확히 1024자 테스트

정확히 1024 Unicode 코드포인트의 내용을 입력한다.

PASS:
- 전체 1024자가 표시된다.
- `…`가 추가되지 않는다.
- 최종 길이가 정확히 1024다.

### 7-3. 1025자 테스트

1025 Unicode 코드포인트의 내용을 입력한다.

PASS:
- 앞 1023 코드포인트만 유지된다.
- 마지막에 `…`가 추가된다.
- 최종 결과가 정확히 1024 코드포인트다.

### 7-4. 한글 테스트

한글로 1024자와 1025자 경계값을 각각 검증한다.

PASS:
- 1024자는 미잘림
- 1025자는 `1023 + …`
- 문자열 손상 없음

### 7-5. 이모지 테스트

이모지를 포함한 문자열로 경계값을 검증한다.

PASS:
- 기존 `Array.from()` 기준 동작 유지
- 최종 결과가 1024 코드포인트를 초과하지 않음

### 7-6. Discord Payload 회귀 테스트

기존 Discord payload 테스트를 실행한다.

PASS:
- 유형 정상
- 제목 정상
- 내용 정상
- 관리자 URL 정상
- 기존 payload 구조 변화 없음

### 7-7. 정적 검사

다음을 실행한다.

```text
관련 discord unit test
npx tsc --noEmit
```

PASS:
- 관련 테스트 전부 PASS
- TypeScript error 0건

### 7-8. Dev 실동작 확인

Dev에서 테스트 문의 또는 건의를 1건 접수하여 Discord 알림을 확인한다.

PASS:
- 20자를 넘는 내용이 더 이상 20자에서 잘리지 않음
- Discord 메시지 정상 전송
- 기존 유형·제목·링크 정상

불필요한 전체 E2E 확대 검증은 하지 않는다.

## 8. 완료조건

- `truncateContent` 20자 제한 제거
- 최대 1024 Unicode 코드포인트 지원
- 1024자 이하 원문 유지
- 1024자 초과 시 `1023 + …`
- 한글 경계값 테스트 PASS
- 이모지 포함 테스트 PASS
- 기존 Discord Payload 테스트 PASS
- TypeScript PASS
- Dev Discord 실제 알림 확인 PASS
- 기존 문의·건의·버그 접수 기능 회귀 없음
- 관련 없는 파일 변경 없음
- Dev 검증 완료 후 현재 프로젝트의 정상 배포 절차에 따라 Production 반영
- Production 반영 후 Discord 신규 접수 알림 정상 여부 확인

## 9. 완료보고

완료 후 반드시 다음을 보고한다.

- 최종 원인
  - 기존 Discord `내용` field가 20 Unicode 코드포인트로 제한되어 있었는지
- 변경 파일
- 기존 제한 값
- 변경된 제한 값
- 구현 방식
- 1000자 테스트 결과
- 1024자 테스트 결과
- 1025자 테스트 결과
- 한글 테스트 결과
- 이모지 테스트 결과
- Discord payload 회귀 테스트 결과
- TypeScript 검사 결과
- Dev 실제 Discord 알림 검증 결과
- 기존 CS 기능 회귀 결과
- Dev 배포 정보
- Production 배포 정보
- 배포 커밋 SHA
- 최종 판정: PASS / BLOCKED