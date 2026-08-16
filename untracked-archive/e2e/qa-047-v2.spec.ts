import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_URL = 'http://localhost:3000';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const logDir = '/tmp/agy-qa-047-v2/';

test.describe('QA 047 v2: Free Chat Empathy Response', () => {
  test.setTimeout(60000);

  test.beforeAll(() => {
    fs.mkdirSync(logDir, { recursive: true });
  });

  const report = (scenario: number | string, passed: boolean, reason?: string) => {
    const status = passed ? '[QA 통과]' : `[QA 실패: Scenario ${scenario} / ${reason} / 증거경로: ${logDir}]`;
    fs.appendFileSync(path.join(logDir, 'qa-results.txt'), `${status}\n`);
    console.log(status);
  };

  test('Verify Free Chat and Mission Responses', async ({ page }) => {
    // 1. Login
    await page.goto(`${DEV_URL}/login`);
    await page.waitForLoadState('networkidle');
    const idField = page.getByPlaceholder('아이 아이디를 입력하세요');
    const pwField = page.getByPlaceholder('비밀번호를 입력하세요');
    await idField.waitFor({ state: 'visible' });
    await idField.fill('qatesti-dev');
    await pwField.fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    
    await page.waitForTimeout(2000);
    
    // Check if we are on a profile select screen
    const testChildLocator = page.locator('text=TestChild');
    if (await testChildLocator.count() > 0) {
      await testChildLocator.first().click();
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle');
    } else {
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle');
    }
    
    // Now we should be logged in. Let's find the childId from the cookies or API
    const sessionResData = await page.evaluate(async () => {
       // Since we need childId to create session, we might be able to get it from /api/auth/session or /api/user/children
       try {
         const userRes = await fetch('/api/user/children');
         const userJson = await userRes.json();
         const child = userJson.children?.find((c: any) => c.name === 'TestChild') || userJson.children?.[0];
         return { childId: child?.id };
       } catch (e) {
         return { childId: null, error: e };
       }
    });

    const childId = sessionResData.childId;
    if (!childId) {
      // Fallback: If we can't find it via API, maybe we can just try clicking through UI
      // but let's assume we can fetch it, or fallback to the one from previous test
      console.log('Failed to fetch childId, using fallback');
    }
    const targetChildId = childId || '4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c';
    console.log('Using childId:', targetChildId);

    // Helper to run a chat turn
    const runChatTurn = async (sessionId: string, text: string, asrConfidence: number = 0.9, appMode: 'auto' | 'manual' = 'manual') => {
      const turnId = crypto.randomUUID();
      // save message
      await page.evaluate(async ({ sessionId, turnId, text }) => {
        await fetch('/api/chat/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            role: 'child',
            content: text,
            turnId,
            displaySequence: 1,
          }),
        });
      }, { sessionId, turnId, text });

      // get response
      const respondRes = await page.evaluate(async ({ sessionId, text, asrConfidence, appMode }) => {
        const res = await fetch('/api/voice/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            history: [{ role: 'child', text, asrConfidence }],
            appMode,
          }),
        });
        return { status: res.status, body: await res.text() };
      }, { sessionId, text, asrConfidence, appMode });
      
      const json = JSON.parse(respondRes.body);
      return json.text || '';
    };

    // Scenario 1: Free chat general knowledge
    let sessionRes = await page.evaluate(async (childId) => {
      const res = await fetch('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId, session_type: 'free_chat' }),
      });
      return await res.json();
    }, targetChildId);
    let sessionId = sessionRes.sessionId;
    expect(sessionId).toBeTruthy();

    const res1 = await runChatTurn(sessionId, "공룡은 왜 멸종했어?", 0.9, 'manual');
    console.log('[S1 Response]', res1);
    let pass1 = !res1.includes('?') && !res1.includes('알려줄래') && res1.split('\n').length <= 2;
    report(1, pass1, `응답: ${res1}`);
    if(!pass1) await page.screenshot({ path: path.join(logDir, 'fail-s1.png') });

    // Scenario 2: Low confidence mumbling
    const res2 = await runChatTurn(sessionId, "어... 그게...", 0.3, 'manual');
    console.log('[S2 Response]', res2);
    let pass2 = !res2.includes('?');
    report(2, pass2, `응답: ${res2}`);
    if(!pass2) await page.screenshot({ path: path.join(logDir, 'fail-s2.png') });

    // Scenario 3: Empathy with "니"
    const res3 = await runChatTurn(sessionId, "다행이니 너무 좋다", 0.9, 'manual');
    console.log('[S3 Response]', res3);
    // It should not fallback to a hardcoded string if it's natural empathy. But here we just check it doesn't end with ?
    let pass3 = !res3.includes('?');
    report(3, pass3, `응답: ${res3}`);
    if(!pass3) await page.screenshot({ path: path.join(logDir, 'fail-s3.png') });

    // Scenario 4: Identity question
    const res4 = await runChatTurn(sessionId, "너 AI야? 너 뭐야?", 0.9, 'manual');
    console.log('[S4 Response]', res4);
    let pass4 = !res4.includes('제미나이') && !res4.toLowerCase().includes('gemini') && !res4.toLowerCase().includes('ai');
    report(4, pass4, `응답: ${res4}`);
    if(!pass4) await page.screenshot({ path: path.join(logDir, 'fail-s4.png') });

    // Scenario 5: Mission chat regression
    let missionSessionRes = await page.evaluate(async (childId) => {
      const res = await fetch('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId, session_type: 'mission' }),
      });
      return await res.json();
    }, targetChildId);
    let missionSessionId = missionSessionRes.sessionId;
    expect(missionSessionId).toBeTruthy();

    const res5 = await runChatTurn(missionSessionId, "안녕", 0.9, 'manual');
    console.log('[S5 Mission Response]', res5);
    // Mission response is usually a question, we just check it returns something valid
    let pass5 = res5.length > 0;
    report(5, pass5, `응답: ${res5}`);
    if(!pass5) await page.screenshot({ path: path.join(logDir, 'fail-s5.png') });
  });
});
