# Request: 카카오톡 유입 → 외부 브라우저 회원가입 → 가입 완료 후 PWA 설치 전환 구현

## 작업 정보

- 우선순위: 높음
- 대상: 부모용 / 아이용 신규 사용자 유입
- 주요 유입 채널: 카카오톡
- Development: `https://k-bestie-v3-dev.vercel.app`
- Production: `https://app.k-bestie.com`
- Dev 우선 구현 및 검증
- Production 반영: Dev QA 완료 후 진행
- 기존 회원가입 / 로그인 / 가족연결 정책 자체는 변경하지 않는다.

---

# 1. 목적

현재 카카오톡으로 내친구 케이 서비스 링크를 전달하면 사용자가 링크를 눌렀을 때 카카오톡 인앱브라우저가 열린다.

카카오톡 인앱브라우저에서는 PWA 설치가 정상적으로 제공되지 않거나 브라우저별 제약이 존재할 수 있다.

이 문제를 해결하기 위해 PWA 설치를 첫 단계로 강제하지 않는다.

최종 사용자 흐름은 다음으로 변경한다.

```text
카카오톡 링크 클릭
→ 카카오톡 인앱브라우저 감지
→ "브라우저에서 계속하기"
→ Safari / Chrome 등 외부 브라우저
→ 회원가입 / 로그인
→ 부모 정보 / 아이 연결 등 필수 온보딩 완료
→ PWA 설치 제안
→ 설치 또는 나중에
→ 서비스 이용
→ 설치된 PWA 첫 실행 시 알림 권한 온보딩
```

핵심 원칙:

> 외부 브라우저 전환은 회원가입 전에 한다.
> PWA 설치는 회원가입과 필수 온보딩 완료 후 제안한다.

PWA 설치 실패 때문에 회원가입 자체가 발생하지 않는 구조를 만들지 않는다.

---

# 2. 반드시 먼저 현재 구조 분석

구현 전에 다음을 확인한다.

## 2.1 카카오톡 유입 URL

현재 카카오톡으로 사용자에게 보내고 있는 URL의 구조를 확인한다.

확인 항목:

- 랜딩 URL
- 회원가입 URL
- 초대 URL
- 부모/아이 구분 방식
- family invite token 전달 방식
- referral / campaign 정보 전달 여부
- 로그인 후 redirect 구조

현재 URL 구조를 무조건 새로 만들지 말고 기존 초대/회원가입 흐름을 최대한 재사용한다.

---

## 2.2 OAuth / 인증 흐름

카카오 인앱브라우저에서 회원가입을 끝내도록 구현하지 않는다.

외부 Safari / Chrome으로 이동한 뒤 현재 인증 흐름을 진행한다.

특히 다음을 확인한다.

- Google OAuth
- Supabase Auth callback
- redirect URL
- 가입 후 onboarding redirect
- 부모/아이 역할 복원
- invite token 복원

외부 브라우저로 이동하면서 가입 문맥이 사라지지 않아야 한다.

---

# 3. 카카오톡 인앱브라우저 감지

카카오톡 인앱브라우저에서 서비스 링크가 열린 경우 일반 회원가입 화면을 바로 보여주지 않는다.

User-Agent 등 현재 프로젝트에서 안전하게 사용할 수 있는 방법으로 KakaoTalk in-app browser를 감지한다.

감지 결과는 다음 세 가지 정도로 구분한다.

```text
KAKAO_IN_APP
NORMAL_BROWSER
PWA_STANDALONE
```

브라우저 판별 실패가 서비스 이용 차단으로 이어지지 않게 한다.

---

# 4. 카카오톡 브리지 화면

카카오톡 인앱브라우저에서는 설치 화면이 아니라 외부 브라우저 이동 안내 화면을 표시한다.

## 화면 제목

`브라우저에서 계속해 주세요`

## 설명

부모용 예시:

```text
내친구 케이는 Safari 또는 Chrome에서
회원가입하면 더 안정적으로 이용할 수 있어요.

브라우저에서 가입을 완료한 뒤
앱 설치도 간단하게 도와드릴게요.
```

아이용 또는 공통 문구가 필요하면 연령과 화면 문맥에 맞게 자연스럽게 작성한다.

## Primary CTA

`브라우저에서 계속하기`

## Secondary 안내

Android:

```text
버튼으로 이동되지 않으면
카카오톡 메뉴에서 '다른 브라우저로 열기'를 선택해 주세요.
```

iPhone/iPad:

```text
카카오톡 메뉴에서 Safari로 열어 주세요.
```

---

# 5. 비공식 Kakao Scheme 의존 금지

다음과 같은 비공식/비보장 Kakao scheme을 핵심 서비스 흐름으로 사용하지 않는다.

```text
kakaotalk://web/openExternal
kakaotalk://inappbrowser/close
```

사용 가능 여부를 확인해 보조 기능으로 활용할 수는 있으나, 해당 방식이 실패해도 사용자가 진행할 수 있는 공식 UI 안내가 반드시 존재해야 한다.

즉:

```text
자동 외부 브라우저 전환 성공
→ 그대로 진행

자동 외부 브라우저 전환 실패
→ 수동 "다른 브라우저로 열기" 안내
```

가 되어야 한다.

---

# 6. 외부 브라우저로 가입 문맥 전달

카카오톡 → Safari/Chrome으로 이동할 때 회원가입 문맥이 사라지지 않아야 한다.

URL에 다음 개인정보를 직접 넣지 않는다.

- 아이 이름
- 부모 이름
- 이메일
- 전화번호
- 가족 정보
- 기타 개인정보

권장 방식:

```text
/start/{opaque-token}
```

예:

```text
https://app.k-bestie.com/start/A7xK92
```

token은 서버에서 다음 정보와 연결한다.

예시:

```text
role
invite_id
family_invite_id
campaign
referrer
intended_redirect
created_at
expires_at
consumed_at
```

필요한 기존 invite token 구조가 이미 있다면 새 구조를 중복 생성하지 않고 기존 구조를 확장한다.

---

# 7. Token 보안

브라우저 전환용 token은 다음 조건을 만족해야 한다.

- 추측하기 어려운 opaque token
- 개인정보 직접 포함 금지
- HTTPS 전용
- 제한된 TTL
- 필요한 경우 1회성 또는 상태 기반 사용
- 서버 검증 필수
- 로그에서 전체 token 마스킹
- 만료 token 처리
- 잘못된 token 처리
- 다른 가족 invite로 변조 불가

Service Role Key 또는 Secret을 클라이언트에 노출하지 않는다.

---

# 8. 외부 브라우저 도착 후 흐름

Safari / Chrome으로 이동하면 정상 회원가입 흐름을 시작한다.

```text
외부 브라우저 도착
→ token 복원
→ 부모/아이 역할 복원
→ 회원가입 또는 로그인
→ invite 복원
→ 가족 연결
→ 필수 정보 입력
→ 가입/온보딩 완료
```

회원가입 도중에는 PWA 설치 modal을 강제로 띄우지 않는다.

---

# 9. PWA 설치 제안 시점

PWA 설치는 최소 다음 상태가 완료된 이후 제안한다.

부모:

```text
로그인/회원가입 완료
+
부모 기본 정보 완료
+
아이 등록 또는 가족 연결 완료
```

아이:

```text
로그인 완료
+
가족 연결 완료
+
아이 프로필 확인 완료
```

즉 사용자가 실제로 내친구 케이 서비스를 사용할 수 있는 상태가 된 뒤 설치를 제안한다.

---

# 10. 설치 완료 화면

가입/온보딩 완료 직후 설치 제안 화면을 표시한다.

## 부모용

제목:

`내친구 케이를 앱으로 사용해 보세요`

설명:

```text
홈 화면에 설치하면
매일 아침 아이 리포트가 준비됐을 때 알려드려요.
```

Primary:

`앱 설치하기`

Secondary:

`나중에`

---

## 아이용

제목:

`케이를 홈 화면에 추가해 볼까?`

설명:

```text
앱으로 설치하면
미션이 시작될 때 케이가 알려줄 수 있어.
```

Primary:

`앱 설치하기`

Secondary:

`나중에`

---

# 11. 설치를 회원가입 완료 조건으로 사용하지 않음

사용자가 `나중에`를 선택해도 서비스 이용이 가능해야 한다.

절대로 다음 구조로 만들지 않는다.

```text
PWA 설치 안 함
→ 서비스 이용 불가
```

올바른 구조:

```text
설치
→ PWA 이용

나중에
→ 브라우저에서 서비스 이용 가능
→ 홈에서 다시 설치 안내 가능
```

---

# 12. Android PWA 설치

Chrome/Edge 등에서 `beforeinstallprompt`가 실제 제공되는 경우 기존 프로젝트 패턴에 맞게 custom install CTA와 연결한다.

이미 프로젝트에 `useInstallPrompt`가 존재하므로 우선 재사용 가능 여부를 확인한다.

예:

```text
앱 설치하기
→ 저장된 beforeinstallprompt 실행
→ 사용자 Install
→ 설치 완료
```

이벤트가 없는 경우 무한 로딩이나 오류로 처리하지 않는다.

대체 설치 가이드를 표시한다.

---

# 13. iPhone / iPad 설치

iOS Safari에서는 일반적으로 Android와 같은 설치 prompt를 전제로 구현하지 않는다.

설치 방법 안내:

```text
Safari 하단/상단 공유 버튼
→ 홈 화면에 추가
→ 추가
```

실제 현재 지원되는 iOS UI에 맞게 안내한다.

iOS 버전에 따라 메뉴 명칭 또는 위치 차이가 있을 수 있으므로 실제 기기 QA를 진행한다.

---

# 14. 이미 설치된 사용자

PWA standalone으로 실행 중인 경우 설치 안내를 다시 표시하지 않는다.

가능한 감지 기준을 사용한다.

예:

```text
display-mode: standalone
navigator.standalone (필요한 iOS 대응)
```

이미 설치된 사용자는 바로 정상 서비스로 진입한다.

---

# 15. 설치를 미룬 사용자

`나중에`를 선택한 사용자에게 매 화면 이동마다 modal을 띄우지 않는다.

권장:

- 가입 완료 직후 1회 설치 제안
- `나중에` 선택 시 modal 닫기
- 이후 홈에 작은 `앱 설치하기` 배너 또는 카드 제공
- 사용자가 직접 다시 실행 가능

과도한 강제 노출 금지.

---

# 16. PWA 설치 후 첫 실행

설치된 PWA를 처음 실행하면 기존 Notification Onboarding 정책과 연결한다.

흐름:

```text
PWA 첫 실행
→ 로그인 세션 복원
→ 사용자 역할 복원
→ 홈 진입
→ 알림 필요성 자체 안내
→ 사용자가 "알림 받기" 클릭
→ OS Notification permission 요청
```

알림 권한 요청을 PWA 설치와 동시에 강제로 실행하지 않는다.

---

# 17. 알림 가치 메시지

부모:

```text
매일 아침 아이 리포트가 준비되면 알려드려요.
```

아이:

```text
오늘의 미션을 시작할 수 있을 때 케이가 알려줄게.
```

알림 허용을 기술적인 `알림 권한` 문제가 아니라 서비스 가치로 설명한다.

---

# 18. 기존 사용자

이미 가입했지만 PWA를 설치하지 않은 기존 사용자는 서비스 홈 진입 시 설치 가능 여부를 판단한다.

조건 예:

```text
not standalone
AND install suggestion not permanently dismissed
AND supported/guideable environment
```

설치하지 않았다고 로그인 또는 서비스 이용을 제한하지 않는다.

---

# 19. 설치 퍼널 계측

최소 다음 이벤트를 기록한다.

```text
kakao_link_open
kakao_inapp_detected
external_browser_cta_view
external_browser_cta_click
external_browser_arrived
signup_started
signup_completed
family_link_completed
pwa_install_offer_view
pwa_install_click
pwa_install_dismiss
pwa_installed
pwa_first_launch
notification_onboarding_view
notification_permission_granted
notification_permission_denied
```

가능하면 동일 onboarding token 또는 acquisition identifier를 통해 한 유입 흐름으로 분석할 수 있게 한다.

PII를 analytics 이벤트에 저장하지 않는다.

---

# 20. 핵심 퍼널

운영에서 최소 다음 전환율을 확인할 수 있어야 한다.

```text
카카오 링크 클릭
↓
외부 브라우저 전환
↓
회원가입 시작
↓
회원가입 완료
↓
가족/아이 연결 완료
↓
PWA 설치 제안
↓
PWA 설치
↓
알림 허용
↓
첫 실제 서비스 이용
```

특히 다음 수치를 구분할 수 있어야 한다.

1. 카카오 → 외부 브라우저 전환율
2. 외부 브라우저 → 회원가입 완료율
3. 가입 완료 → PWA 설치율
4. PWA 설치 → 알림 허용률

PWA 설치 실패를 회원가입 실패와 섞어서 측정하지 않는다.

---

# 21. UX 중요 원칙

## 가입 전

사용자에게:

`앱을 설치하세요`

라고 요구하지 않는다.

대신:

`브라우저에서 계속하기`

라고 안내한다.

---

## 가입 후

서비스 가치를 설명한 후:

`앱 설치하기`

를 제안한다.

---

## 설치 후

기능의 이유를 설명한 뒤:

`알림 받기`

를 요청한다.

따라서 사용자가 받는 요청은 한 번에 하나씩이다.

```text
1. 브라우저 이동
2. 가입
3. 앱 설치
4. 알림 허용
```

한 화면에서 모두 요구하지 않는다.

---

# 22. 오류 처리

## 카카오 감지 실패

정상 웹 서비스 이용 가능해야 한다.

## 외부 브라우저 이동 실패

OS별 수동 안내를 제공한다.

## token 만료

명확한 안내 후 일반 회원가입 또는 재초대 흐름으로 연결한다.

## OAuth 실패

기존 인증 오류 흐름 사용.

## PWA 설치 불가

웹 서비스 이용 유지.

## Notification 미지원

서비스 이용 유지.

어떤 경우에도 단순 설치/브라우저 오류 때문에 사용자를 강제 로그아웃하지 않는다.

---

# 23. Development / Production

Development와 Production은 동일 정책으로 구현한다.

다만 실제 redirect URL / OAuth callback / domain / token origin은 환경별 설정을 사용한다.

하드코딩 금지.

예:

```text
Development
https://k-bestie-v3-dev.vercel.app

Production
https://app.k-bestie.com
```

Production Secret, Service Role Key, OAuth Secret을 코드 또는 로그에 출력하지 않는다.

---

# 24. 테스트 시나리오

## A. Android + KakaoTalk 신규 부모

1. 카카오톡 링크 클릭
2. Kakao in-app 감지
3. 브라우저 계속하기 화면
4. Chrome으로 이동
5. token 유지 확인
6. 회원가입
7. 아이 연결
8. 가입 완료
9. 앱 설치 제안
10. PWA 설치
11. PWA 실행
12. 로그인 유지
13. 알림 온보딩
14. 알림 허용
15. 정상 홈 진입

PASS 필수.

---

## B. iPhone + KakaoTalk 신규 부모

1. 카카오톡 링크
2. Kakao in-app 감지
3. Safari 이동 안내
4. Safari에서 동일 가입 문맥 복원
5. 가입
6. 아이 연결
7. PWA 설치 제안
8. 홈 화면에 추가 안내
9. PWA 실행
10. 로그인 복원
11. 알림 허용
12. 정상 이용

PASS 필수.

---

## C. 설치 거절

1. 회원가입 완료
2. 설치 제안
3. `나중에`
4. 정상 서비스 사용
5. 홈 설치 배너 확인
6. 다시 설치 가능

---

## D. 카카오 → 외부 브라우저 token

1. 카카오에서 링크 진입
2. 외부 브라우저 이동
3. role 유지
4. family invite 유지
5. intended redirect 유지
6. 다른 가족 정보로 변경 불가

---

## E. 이미 가입한 사용자

1. 카카오 링크 클릭
2. 외부 브라우저
3. 기존 세션 또는 로그인
4. PWA 미설치이면 설치 제안
5. 이미 standalone이면 설치 안내 없음

---

## F. PWA 미지원 환경

1. 회원가입 완료
2. 설치 기능 미지원
3. 오류 없이 웹에서 서비스 이용

---

# 25. 완료 조건

- 카카오 인앱브라우저 감지 구현
- 카카오용 브라우저 전환 화면 구현
- Android / iOS 별도 안내 구현
- 브라우저 전환 후 onboarding context 유지
- 가입 전에 PWA 설치 강제 없음
- 회원가입/가족연결 완료 후 PWA 설치 제안
- 설치 `나중에` 지원
- 설치하지 않아도 웹 서비스 이용 가능
- 이미 설치된 PWA에서는 설치 안내 제거
- 설치 후 Notification Onboarding 연결
- 부모/아이 각각 적절한 메시지 적용
- 퍼널 analytics 적용
- 개인정보 없는 token 구조 확인
- Dev Android Kakao QA PASS
- Dev iPhone Kakao QA PASS
- OAuth callback PASS
- PWA 설치 PASS
- 기존 회원가입 회귀 없음
- 기존 자동로그인 회귀 없음

---

# 26. 완료 보고

작업 완료 후 다음 순서로 보고한다.

1. 기존 카카오 유입 구조
2. 기존 문제 원인
3. 변경한 사용자 흐름
4. Kakao in-app 감지 방식
5. 외부 브라우저 이동 방식
6. Android 처리
7. iPhone/iPad 처리
8. onboarding token 구조
9. 가입 문맥 복원 방식
10. 회원가입 완료 후 설치 제안 방식
11. 설치 거절 처리
12. PWA 설치 후 로그인 복원 결과
13. Notification Onboarding 연결 결과
14. analytics 이벤트 목록
15. 변경 파일
16. DB/migration 변경
17. 보안 검토
18. Android Kakao 실제 테스트 결과
19. iPhone Kakao 실제 테스트 결과
20. Development URL
21. Production 반영 여부
22. 남아 있는 플랫폼 제한사항
```

[Claude Code]

```text
위 Request.md를 기준으로 카카오톡 유입 사용자의 전체 가입·설치 퍼널을 수정하라; 핵심 정책은 카카오 인앱브라우저에서는 PWA 설치를 요구하지 않고 먼저 Safari/Chrome 등 외부 브라우저로 이동시킨 뒤 회원가입·로그인·가족 및 아이 연결 등 필수 온보딩을 완료하게 하고, 실제 서비스를 사용할 수 있는 상태가 된 이후에만 PWA 설치를 제안하는 것이다; 카카오→외부 브라우저 전환 과정에서 role·invite·family context·intended redirect가 사라지지 않도록 기존 초대 구조를 우선 재사용하고 필요 시 짧은 TTL의 opaque token 방식으로 보완하되 개인정보를 URL이나 로그에 노출하지 마라; 설치는 절대 회원가입 완료 조건으로 만들지 말고 사용자가 ‘나중에’를 선택해도 정상 서비스 이용이 가능하게 하며, 이후 홈에서 설치를 다시 시작할 수 있게 하라; Android와 iPhone/iPad의 설치 방식을 분리하고 비공식 Kakao scheme을 필수 경로로 의존하지 말며, 이미 standalone PWA인 사용자는 설치 안내를 보지 않게 하라; PWA 첫 실행 후 기존 NotificationOnboarding과 연결하여 부모는 리포트 알림, 아이는 미션 알림의 가치를 설명한 뒤 사용자 클릭으로 알림 권한을 요청하라; kakao_link_open→external_browser→signup→family_link→pwa_install→notification_permission 퍼널을 개인정보 없이 계측하고 Development에서 Android KakaoTalk 및 iPhone KakaoTalk 실제 기기 흐름, OAuth callback, 가입 문맥 복원, 설치 거절, 기존 사용자, PWA 설치 및 첫 실행을 검증한 뒤 수정 파일·DB 변경·테스트 결과·플랫폼 제한사항을 보고하라.
```