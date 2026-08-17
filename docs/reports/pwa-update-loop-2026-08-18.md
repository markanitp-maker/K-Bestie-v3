# PWA 업데이트 무한 루프 — 원인과 수정 (2026-08-18)

## 증상

```
"새로운 버전이 준비됐어요"   → [업데이트] 클릭
"새 버전을 확인하지 못했어요" → [다시 업데이트] 클릭
"새로운 버전이 준비됐어요"   → 무한 반복
```

사용자가 새 버전을 **영영 받지 못한다.**

## 누가 걸리나 — 특수한 상황이 아니다

**업데이트 알림을 한 번 무시하고 앱을 껐다가, 그 사이 새 배포가 나간 뒤 다시 열면**
걸린다. 며칠 만에 여는 사용자도 같다. `registration.waiting` 이 낡은 채 남아 있기만
하면 된다.

잦은 배포는 이 버그를 **드러나게 했을 뿐 원인이 아니다.**

## 근본 원인

`lib/pwa/updateFlow.ts` `performRegistrationUpdate` 의 분기 1:

```ts
await registration.update();

if (registration.waiting && registration.waiting.state === "installed") {
  // 이 워커가 낡았으면(buildId 불일치) 곧바로 반환하고 끝
  return { result: "identity-mismatch", worker, identity };
}

if (registration.installing) { ... }   // ← 절대 도달 못 함
```

`registration.update()` 가 새 워커 설치를 시작했어도, 분기 1 이 낡은 대기 워커만
보고 즉시 실패로 끝내 **분기 2 를 아예 보지 않았다.** 그래서 몇 번을 눌러도
같은 낡은 워커, 같은 실패.

## 수정

낡은 대기 워커를 `staleWaitingWorker` 에 담아 두고 분기 2 로 넘어간다.
설치 중인 워커도 없을 때에만 최종적으로 `identity-mismatch` 를 반환한다.

| 상황 | 이전 | 지금 |
|---|---|---|
| 낡은 대기 + 새 워커 설치 중 | 실패 반복 | **installed-target** |
| 낡은 대기만 (설치 중 없음) | identity-mismatch | identity-mismatch (동일) |
| 일치하는 대기 워커 | installed-target | installed-target (불변) |
| 대기·설치 둘 다 없음 | no-update | no-update (불변) |

커밋 `c0a2562`. 프로덕션 01:38 KST (`dpl_HkGairaSPyPSuju7vbhFoonWDhJC`).

## 같은 날 함께 고친 것

이 루프를 쫓는 과정에서 나온 별개 결함들이다.

**모달이 막다른 길이었다** (`a02b7b2`)
`fixed inset-0` + `aria-modal` 로 화면을 막는데 버튼이 "다시 업데이트" 하나뿐이었다.
문구는 "현재 버전은 계속 사용할 수 있습니다" 라고 하면서 계속 쓸 방법을 안 줬다.
`offline`·`delayed`·`error` 세 상태에만 "계속 사용하기" 를 넣었다.
`update_available` 은 숨길 수 없도록 `canDismissPwaModal` 과 AND 로 묶었다.

**한 번 실패에 화면을 막았다** (`7fd242b`)
점검 실패 판정이 6가지인데 하나라도 걸리면 곧바로 차단이었다. 재시도가 없었다.
연속 3회째부터만 알리고 1·2회는 15초·45초 뒤 조용히 재시도한다.
사용자가 직접 누른 실패는 1회에도 즉시 알린다 — 삼키면 안 된다.

**Dev 에서 진단 로그가 안 나왔다** (`7edeea3`)
`debugLog` 가 `NODE_ENV !== "production"` 으로 막혀 있었는데 Dev 배포도 프로덕션
빌드다. 도메인 기준으로 바꿔 실사용 도메인에서만 끈다.

## 조사에서 배운 것

**서버를 먼저 배제하라.** `/api/client-version`·`/sw.js`·문서 마커 세 값이 모두
일치하는지부터 봤다. 전부 일치했으므로 클라이언트 문제로 좁혀졌다.

**깨끗한 세션은 증거가 안 된다.** 새 브라우저로는 세 번 다 정상이었다.
이 버그는 **상태가 쌓인 클라이언트**에서만 난다.

**재현 실패도 정보다.** 소스가 그대로면 Vercel 이 같은 배포를 재사용해 버전 변화가
없다. 재현 조건이 성립하지 않은 것을 모르고 "정상"으로 읽을 뻔했다.

## 남은 위험

서버 메타데이터만 갱신되고 `sw.js` 바이트가 구버전인 **비정상 배포**에서는 여전히
`identity-mismatch` 로 막힌다. 이건 의도된 차단이다 — 잘못된 워커를 활성화하느니
막는 편이 낫다. 정상 배포에서는 `sw.js` 에 deploymentId 가 들어가므로 발생하지 않는다.
