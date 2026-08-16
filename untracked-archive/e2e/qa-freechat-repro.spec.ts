// 자유대화 무응답 버그 재현/검증용 1회성 스크립트.
// requests/request-free-chat-auto-manual-no-response-fix.md 대응 — chat_messages.mode
// CHECK 제약 수정(20260802...) 후 실제 로그인 세션으로 /api/chat/session →
// /api/chat/messages → /api/voice/respond 전체 경로가 정상 동작하는지 확인한다.
import { test, expect } from '@playwright/test';

const DEV_URL = 'http://localhost:3000';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const CHILD_ID = '56235a1c-0427-4960-87b9-d3999a603f8c'; // Dev 테스트 계정 김서아

test('free chat turn end-to-end', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto(`${DEV_URL}/login`);
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('ksa160202');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.goto(`${DEV_URL}/chat`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const sessionRes = await page.evaluate(async (childId) => {
    const res = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId }),
    });
    return { status: res.status, body: await res.json() };
  }, CHILD_ID);
  console.log('[session]', JSON.stringify(sessionRes));
  expect(sessionRes.status).toBe(200);
  const sessionId = sessionRes.body.sessionId;

  const turnId = crypto.randomUUID();
  const msgRes = await page.evaluate(
    async ({ sessionId, turnId }) => {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          role: 'child',
          content: 'QA 재현 테스트 발화입니다',
          turnId,
          displaySequence: 1,
        }),
      });
      return { status: res.status, body: await res.text() };
    },
    { sessionId, turnId }
  );
  console.log('[chat/messages child save]', JSON.stringify(msgRes));
  expect(msgRes.status).toBe(200);

  const respondRes = await page.evaluate(
    async ({ sessionId }) => {
      const res = await fetch('/api/voice/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          history: [{ role: 'child', text: 'QA 재현 테스트 발화입니다' }],
          appMode: 'manual',
        }),
      });
      return { status: res.status, body: await res.text() };
    },
    { sessionId }
  );
  console.log('[voice/respond]', JSON.stringify(respondRes));
  expect(respondRes.status).toBe(200);
  const respondJson = JSON.parse(respondRes.body);
  expect(respondJson.text?.length).toBeGreaterThan(0);
  console.log('[K response text]', respondJson.text, 'model:', respondJson.model);
});
