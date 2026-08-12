# 060 — 미션 대화 화면 비주얼·레이아웃 전면 고도화

## 1. 작업 목적

현재 미션 대화 화면의 기능과 대화 로직은 그대로 유지하면서, 초등학생이 더 재미있고 직관적으로 사용할 수 있도록 화면의 시각적 완성도와 몰입감을 전면 개선한다.

현재 화면은 다음 특징을 가진다.

- 진행률: 연한 파란색 pill/원형 세그먼트
- 대화: 지지난 발화 → 지난 발화 → 현재 발화 3단계 구조
- 현재 발화: 흰색 + 오렌지 테두리 말풍선
- 케이 마스코트: 약 113×116px
- 받침대: 약 148×32px
- 좌우 상태 카드: 약 78×86px
- 자동/수동 버튼: 마스코트 아래 별도 행
- 마이크: 약 86×86px
- 배경: 단순 하늘색/크림색 중심

목표 화면은 기능은 그대로 유지하면서 다음과 같은 인상을 가져야 한다.

> “단순한 대화 도구”가 아니라 케이와 함께 진행하는 재미있는 미션 화면

핵심 변화:
1. 진행률을 별 아이콘 방식으로 변경
2. 대화 영역을 더 정돈되고 게임처럼 보이게 개선
3. 케이 마스코트를 화면의 중심으로 크게 확대
4. 받침대와 후광 효과 추가
5. 상태 컨트롤을 작고 가볍게 재배치
6. 자동/수동을 받침대와 연결된 토글처럼 구성
7. 마이크 버튼을 핵심 CTA로 강화
8. 하늘/별/구름/작은 장식 요소로 화면 분위기 개선

---

# 2. 기존 구현 위치

현재 실제 구현 파일:

- 미션 페이지:
  `app/child/missions/page.tsx`

- 메인 미션 대화 레이아웃:
  `components/MissionConversationLayout.tsx`

- 케이 마스코트 애니메이션:
  `components/KBestieMascotAnimation.tsx`

- 상단 공통 헤더:
  `components/AppTopHeader.tsx`

이번 UI 변경은 가능한 한 `MissionConversationLayout.tsx` 중심으로 진행한다.

기능 로직을 변경하기 위해 `page.tsx`를 대규모 수정하지 않는다.

---

# 3. 전체 레이아웃 구조

현재 구조:

```text
Row 1
상단 헤더
미션 진행률

Row 2
지지난 케이 발화
지난 케이 발화
현재 케이 발화

Row 3
소리 상태
케이 마스코트
음성 상태
받침대

Row 4
자동 / 수동
키보드
마이크
```

기본 Grid 구조는 유지해도 된다.

```css
grid
grid-cols-1
grid-rows-[auto_minmax(0,1fr)_auto_auto]
```

다만 각 Row의 시각적 구성은 아래 목표에 맞게 재배치한다.

---

# 4. 상단 헤더

현재 공통 헤더 구조를 그대로 유지한다.

```text
← 뒤로          미션          로그아웃
```

변경 금지:

- 뒤로가기 기능
- 가운데 `미션` 제목
- 로그아웃 기능
- Safe Area 처리

이번 작업에서는 헤더 디자인을 새로 만들지 않는다.

---

# 5. 미션 진행률 UI

## 현재

`MissionConversationLayout.tsx` line 201~218 부근

현재 컨테이너:

```text
top: 약 101px
left: 약 19.5px
width: 약 351px
height: 44px
```

현재 스타일:

```css
w-[90%]
max-w-[400px]
h-[44px]
bg-white
rounded-full
shadow-sm
px-4
```

현재 세그먼트:

- 완료: 오렌지 pill
- 미완료: `#D5ECFF`
- `progressCurrent`
- `progressTotal`
- 증가 시 `scale(1.3)` 애니메이션

## 목표

현재 pill/원형 세그먼트를 **별 아이콘 기반 진행 표시**로 변경한다.

예:

```text
★ ★ ★ ★ ☆ ☆ ☆ ☆ ☆ ☆
```

실제 별 개수는 절대 하드코딩하지 않는다.

반드시 기존:

```text
progressCurrent
progressTotal
```

값을 그대로 이용한다.

### 완료 별

- 색상: 케이 오렌지/골드 계열
- fill 적용
- 약한 골드 outline 가능

추천 시각값:

```text
크기: 26~30px
색상: #F6A21A 또는 현재 K Orange 계열
```

### 미완료 별

```text
색상: #DDE6EF 또는 #D5ECFF
```

### 진행률 컨테이너

현재 위치와 크기는 크게 변경하지 않는다.

390×844 기준 목표:

```text
top: 101px ±4px
left: 약 20px
width: 약 350px
height: 46~50px
```

별은 동일 간격으로 한 줄 배치한다.

### 애니메이션

현재 `progressCurrent` 증가 시 사용 중인 scale 효과를 유지한다.

신규 완료 별:

```text
scale 1.0 → 1.25~1.3 → 1.0
```

정도의 짧은 bounce 효과 허용.

진행률 계산 로직은 변경 금지.

---

# 6. 대화 영역

기존 정책을 그대로 유지한다.

표시 우선순위:

```text
1. 현재 케이 발화
2. 지난 케이 발화
3. 지지난 케이 발화
```

아이 발화는 화면에 표시하지 않는다.

기존:

```text
getRecentKUtterances(allTurns)
```

구조를 변경하지 않는다.

---

# 7. 지지난 케이 발화

현재:

```css
text-gray-400
text-[clamp(14px,3.8vw,16px)]
leading-[1.45]
text-center
max-w-[85%]
font-medium
```

목표:

- 화면에서 가장 약한 대화 정보
- 작은 회색 텍스트 형태 유지
- 필요하면 아주 연한 배경 없이 텍스트만 표시

권장:

```text
font-size: 14~15px
opacity: 0.5~0.65
max-width: 80~84%
```

공간이 부족하면 가장 먼저 숨긴다.

---

# 8. 지난 케이 발화

현재:

```css
bg-white/70
px-[18px]
py-[14px]
rounded-[16px]
text-[clamp(15px,4vw,17px)]
max-w-[82%]
```

목표:

- 흰색 또는 반투명 흰색
- 현재 발화보다 시각적 중요도 낮음
- 카드 형태는 유지
- 그림자는 매우 약하게

권장:

```text
width: 최대 78~82%
font-size: 15~17px
padding-x: 16~18px
padding-y: 11~13px
border-radius: 16~18px
```

---

# 9. 현재 케이 발화 말풍선

현재 실제값:

```text
top: 약 380px
left: 약 27px
width: 약 335px
height: 약 105px
```

현재 CSS:

```css
w-[clamp(84%,86%,88%)]
max-w-[88%]
bg-white
rounded-[20px]
border-[2.5px]
border-[var(--color-k-orange)]
px-[20px]
py-[17px]
```

본문:

```css
text-[clamp(17px,4.7vw,20px)]
font-[700]
leading-[1.45]
```

## 목표

현재 케이 질문이 화면에서 가장 중요한 텍스트가 되어야 한다.

### 폭

현재 폭은 적절하므로 크게 변경하지 않는다.

```text
width: 화면의 84~88%
max-width: 350px 전후
```

### 글씨

현재보다 약간 더 크고 강하게 표시.

추천:

```text
font-size: clamp(18px, 5vw, 21px)
font-weight: 700
line-height: 1.4~1.45
```

### padding

```text
horizontal: 20~22px
vertical: 16~18px
```

### 테두리

```text
2~2.5px K Orange
```

### 위치

현재 말풍선은 마스코트와 너무 분리되어 보이지 않게 한다.

말풍선 꼬리와 확대된 마스코트 머리 사이:

```text
약 14~22px
```

을 목표로 한다.

현재 발화가 길어지면:

- 아래로 내려가지 말고 위쪽으로 확장
- 내부 스크롤 금지
- 글자 잘림 금지

공간 부족 시:

1. 지지난 발화 숨김
2. 지난 발화 축소/숨김
3. 현재 발화 전체 유지

---

# 10. 화면 장식 및 배경

현재 기본 색상:

- 상단: 연한 하늘색
- 하단: 크림색

기본 구조는 유지한다.

다만 화면이 지나치게 비어 보이지 않도록 장식을 추가한다.

### 상단

연한 구름:

```text
2~3개
opacity 0.15~0.3
```

### 대화 영역

작은 장식:

- 별
- 작은 종이조각
- 작은 점

최대 4~6개 정도.

색상:

```text
연한 오렌지
연한 노랑
연한 하늘색
```

주의:

- 텍스트 위에 배치 금지
- 클릭 영역 방해 금지
- 과도한 애니메이션 금지

CSS/pseudo element 또는 가벼운 SVG 사용 가능.

새로운 무거운 이미지 asset을 불필요하게 추가하지 않는다.

---

# 11. 케이 마스코트

현재 실제 렌더링:

```text
top: 약 485px
left: 약 138.5px
width: 약 113px
height: 약 116px
```

현재:

```tsx
size={116}
```

및

```css
!w-[clamp(100px,29vw,130px)]
!h-auto
object-contain
```

## 목표

케이를 화면의 가장 중요한 캐릭터 요소로 확대한다.

390×844 기준 실제 보이는 목표:

```text
width: 약 145~155px
height: 약 150~165px
```

즉 현재보다 약:

```text
1.3~1.4배
```

확대한다.

권장 CSS 시작값:

```css
!w-[clamp(135px,39vw,160px)]
!h-auto
```

단순히 CSS 박스만 키우지 말고 실제 스크린샷에서 보이는 마스코트 크기를 확인한다.

PNG 내부 투명 여백이 있을 수 있으므로 `getBoundingClientRect()`뿐 아니라 실제 시각 크기도 검증한다.

### 기능 보존

반드시 유지:

```text
voiceState === "speaking"
```

에 따른 입 모양 애니메이션.

`KBestieMascotAnimation`의 state prop을 변경하지 않는다.

---

# 12. 마스코트 Halo 효과

케이 뒤에 은은한 원형 후광을 추가한다.

구조 예:

```text
가장 바깥 원
중간 원
안쪽 원
K 마스코트
```

색상:

```text
연한 오렌지 / 연한 노랑
opacity 0.08~0.18
```

크기:

```text
마스코트보다 20~45% 크게
```

강한 glow 금지.

아이가 캐릭터를 쉽게 보는 정도의 은은한 효과만 적용한다.

---

# 13. 마스코트 받침대

현재:

```text
width: 약 148px
height: 약 32px
```

현재 CSS:

```css
w-[clamp(135px,38vw,175px)]
h-[clamp(24px,4.5dvh,36px)]
```

## 목표

마스코트 확대에 맞춰 받침대도 확대한다.

390×844 기준 목표:

```text
width: 185~205px
height: 38~46px
```

추천:

```css
w-[clamp(175px,49vw,205px)]
h-[clamp(34px,5.3dvh,46px)]
```

### 디자인

현재:

```text
상단 타원 #FFF5E8
하단 #f2e1cc
```

계열 유지.

다만:

- 상단 타원 입체감 강화
- 아주 약한 그림자
- 하단 원통 깊이감 표현

가능.

마스코트 발이 받침대 중앙에 자연스럽게 올라가야 한다.

---

# 14. 좌측 소리 상태 컨트롤

현재:

```text
width: 약 78px
height: 약 86px
```

현재 카드:

```css
bg-[#D5ECFF]/60
rounded-[16px]
```

## 목표

현재 큰 카드 형태보다 시각적 무게를 줄인다.

추천 목표:

```text
width: 64~72px
height: 72~82px
```

원형 아이콘:

```text
36~40px
```

라벨:

```text
14~16px
font-weight: 600~700
```

마스코트 왼쪽에 배치하되 마스코트를 중앙에서 밀어내면 안 된다.

### 기능

기존:

```text
isMuted
onToggleMute
```

그대로 사용.

---

# 15. 우측 Voice State 컨트롤

현재:

```text
width: 약 78px
height: 약 86px
```

목표:

좌측 상태 컨트롤과 동일한 시각 크기.

표시 내용은 기존 runtime 값을 그대로 사용한다.

예:

```text
듣고 있어
생각 중
말하는 중
연결 중
대기 중
```

시안 문구를 하드코딩하지 않는다.

기존 `voiceState` 조건을 그대로 사용한다.

---

# 16. 자동 / 수동 토글

현재 실제 위치:

```text
top: 약 615px
width: 약 136px
height: 약 46px
```

현재 별도의 큰 Row처럼 보인다.

## 목표

마스코트 받침대 바로 아래 또는 받침대 앞에 붙어 있는 하나의 pill toggle처럼 보이게 한다.

구조:

```text
[ 자동 ][ 수동 ]
```

### 크기

전체:

```text
width: 약 130~145px
height: 38~42px
```

버튼 하나:

```text
60~68px
```

### 선택 상태

선택:

```text
연한 오렌지 배경
오렌지 border
오렌지 글씨
```

비선택:

```text
흰색
네이비/회색 글씨
```

### 중요

기존:

```text
isAuto
onChangeMode('auto'|'manual')
disabled
```

로직 절대 변경 금지.

---

# 17. 마이크 버튼

현재 실제 크기:

```text
약 86×86px
```

현재:

```css
bg-[var(--color-k-orange)]
shadow-[0_4px_16px_rgba(224,90,63,0.3)]
```

## 목표

미션 화면의 가장 중요한 조작 CTA로 강화한다.

390×844 목표:

```text
88~96px
```

즉 현재보다 약 8~12% 확대.

### 디자인

- 오렌지 원
- 흰색 마이크
- 내부 하이라이트
- 얇은 밝은 오렌지 outer ring
- 약한 그림자

추천 구조:

```text
outer glow ring
inner orange circle
white microphone
```

녹음 중 기존:

```text
animate-ping
animate-pulse
```

효과는 유지한다.

기능:

```text
isRecording
isMicDisabled
onMicClick
```

절대 변경 금지.

---

# 18. 키보드 버튼

현재:

```text
약 43×43px
```

목표:

```text
46~50px
```

정도로만 소폭 확대 가능.

위치는 화면 좌하단 유지.

기존:

```text
isTextMode
onToggleTextMode
```

기능 유지.

---

# 19. 목표 세로 배치 — iPhone 390×844 기준

헤더와 진행률을 제외한 대화/마스코트 영역은 아래 흐름을 목표로 한다.

```text
약 y=150
지지난 케이 발화

약 y=185~250
지난 케이 발화

약 y=255~360
현재 케이 질문

약 y=375~530
확대된 K 마스코트

약 y=500~555
확대된 받침대

약 y=545~590
자동 / 수동 pill

약 y=630~730
메인 마이크

키보드 버튼은 좌하단
```

위 값은 QA 기준이며 모든 기기에 absolute px로 하드코딩하지 않는다.

실제 구현은 Grid/Flex와 clamp를 이용한다.

---

# 20. Responsive 정책

검증 기기:

```text
iPhone 390×844
Android 360×800
Android 412×915
```

### 필수 조건

- 가로 스크롤 없음
- 오른쪽 잘림 없음
- 말풍선 내부 스크롤 없음
- 마스코트와 상태 카드 겹침 없음
- 자동/수동 버튼 겹침 없음
- 마이크가 Safe Area에 가려지지 않음
- 긴 질문에서도 현재 발화 전체 표시
- 작은 화면에서는 오래된 히스토리부터 제거

---

# 21. 절대 변경하지 않을 기능

이번 작업에서 다음은 수정 금지.

- 미션 질문 생성
- 질문 순서
- `progressCurrent`
- `progressTotal`
- 미션 완료 판정
- 유효 답변 판정
- 자동/수동 동작
- 음성 STT
- TTS
- microphone state
- voiceState
- mute 처리
- 키보드 입력
- DB 저장
- API
- RPC
- 미션 보상
- 황금열쇠
- 부모 리포트

---

# 22. 구현 전 현재값 기록

수정 직전에 390×844에서 다음 `getBoundingClientRect()` 값을 저장한다.

- progress
- olderKText
- prevKText
- current bubble
- mascot
- platform
- left state
- right state
- auto/manual group
- keyboard
- microphone

수정 후 동일하게 다시 측정한다.

---

# 23. QA 완료 조건

다음 항목을 모두 통과해야 완료로 본다.

- [ ] 기존 pill 진행률이 별 진행률로 변경
- [ ] 완료 별과 미완료 별이 명확히 구분
- [ ] 기존 progress 데이터 정상
- [ ] 최근 케이 발화 최대 3단계 정상
- [ ] 현재 케이 질문이 가장 강하게 강조
- [ ] 긴 질문 전체 표시
- [ ] 케이 마스코트 약 1.3~1.4배 확대
- [ ] 마스코트 음성 애니메이션 정상
- [ ] 받침대 확대
- [ ] Halo 효과 적용
- [ ] 좌우 상태 카드가 마스코트 중앙 정렬을 방해하지 않음
- [ ] 자동/수동이 받침대와 연결된 pill 형태로 보임
- [ ] 마이크 약 8~12% 확대 및 시각 강조
- [ ] 키보드 정상
- [ ] iPhone 정상
- [ ] Android 정상
- [ ] 가로 잘림 없음
- [ ] 전체 페이지 불필요한 스크롤 없음
- [ ] 기존 미션 기능 회귀 없음

---

# 24. 작업 순서

1. 현재 코드/좌표 기록
2. 진행률 별 UI 구현
3. 대화 히스토리 스타일 정리
4. 현재 발화 말풍선 개선
5. 배경 장식 추가
6. 마스코트 1.3~1.4배 확대
7. Halo 구현
8. 받침대 확대
9. 좌우 상태 컨트롤 경량화
10. 자동/수동 pill UI 적용
11. 마이크 CTA 강화
12. 반응형 조정
13. `tsc`
14. 테스트
15. 빌드
16. Dev 배포
17. iPhone/Android QA
18. Dev QA 통과 후 Production 배포
19. Production Smoke Test

Dev QA에서 레이아웃 또는 기능 문제가 있으면 Production에 배포하지 않는다.

---

# 25. 완료 보고

완료 후 다음을 보고한다.

- 수정 파일
- 각 주요 요소 현재값 → 변경값
- 진행률 변경 결과
- 마스코트 실제 전/후 크기
- 받침대 전/후 크기
- 자동/수동 전/후 구조
- 마이크 전/후 크기
- iPhone 스크린샷
- Android 스크린샷
- 타입 검사 결과
- 테스트 결과
- 빌드 결과
- Dev 배포 URL
- Production 배포 결과
- Production Smoke Test
- 남은 이슈
