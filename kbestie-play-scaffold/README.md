# K-Play (kbestie-play)

## 프로젝트 목적
K-Play는 K-Bestie-v3 앱과 동일한 Supabase 프로젝트를 공유하며, 황금열쇠 원장과 놀이 세션 관리를 연동하여 4종의 놀이 콘텐츠(만화책, 퀴즈, MBTI, 헤어스타일)를 제공하기 위해 분리된 별도의 Next.js 웹 애플리케이션입니다.

- K-Bestie-v3 메인 앱은 오케스트레이션과 놀이 예약/시작을 담당합니다.
- 본 앱(K-Play)은 실제 놀이 UI와 게임 진행 로직(progress state 동기화 등)을 독립적으로 구현합니다.
- 향후 iframe 혹은 외부 URL 리다이렉트 방식으로 메인 앱과 연동됩니다.

## 환경변수
K-Bestie-v3의 `.env.local` 규칙과 동일하게 작성되어야 합니다. 필수 환경변수 목록은 다음과 같습니다 (`.env.local.example` 참고):

```env
# Supabase — 브라우저 허용 (URL + anon key만)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Supabase — 서버 전용 (절대 NEXT_PUBLIC_ 금지)
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

*필요에 따라 기타 게임 진행용 외부 API 키나 설정이 추가될 수 있습니다.*

## 로컬 개발 시작 방법

```bash
# 1. 의존성 설치
npm install

# 2. 로컬 개발 서버 실행
npm run dev
```

개발 서버는 기본적으로 `http://localhost:3000` 에서 구동됩니다. K-Bestie-v3 메인 앱의 개발 서버(`http://localhost:3000`)와 충돌할 수 있으므로, K-Play 앱을 구동할 때는 `npm run dev -- -p 3001` 처럼 포트를 변경하여 실행해야 할 수 있습니다.
