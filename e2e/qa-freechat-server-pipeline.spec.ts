// 긴급: fake mic device는 실제 음성이 아니라 STT가 항상 빈 텍스트를 반환해 클라이언트
// 파이프라인만으로는 재현이 불완전하다. TTS로 실제 한국어 음성을 합성한 뒤 그 오디오를
// STT에 그대로 먹여 실제 발화와 동등한 라운드트립으로 서버 파이프라인 전체를 검증한다.
import { test, expect } from '@playwright/test';

const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('서버 파이프라인: TTS 합성 음성을 STT에 먹여 자유대화 한 턴 검증', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/child**', { timeout: 15000 });

  // 1. session 생성
  const sessionRes = await page.evaluate(async () => {
    const childId = localStorage.getItem('k_child_id');
    const res = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId }),
    });
    return { status: res.status, body: await res.json(), childId };
  });
  console.log('[session]', JSON.stringify(sessionRes));
  expect(sessionRes.status).toBe(200);
  const sessionId = sessionRes.body.sessionId;

  // 2. TTS로 실제 한국어 음성 합성
  const ttsRes = await page.evaluate(async ({ sessionId }) => {
    const res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '체육 시간에 축구한 게 제일 기억나', sessionId }),
    });
    const body = await res.json();
    return { status: res.status, hasAudio: !!body.audioContent, audioLen: body.audioContent?.length };
  }, { sessionId });
  console.log('[tts]', JSON.stringify(ttsRes));
  expect(ttsRes.status).toBe(200);
  expect(ttsRes.hasAudio).toBe(true);

  // 3. TTS 오디오를 그대로 STT에 먹인다(실제 사람 발화 대체)
  const sttRes = await page.evaluate(async ({ sessionId }) => {
    const ttsRes = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '체육 시간에 축구한 게 제일 기억나', sessionId }),
    });
    const ttsBody = await ttsRes.json();
    const sttStart = Date.now();
    const res = await fetch('/api/mission/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: ttsBody.audioContent, sessionId, childTurnId: 't1' }),
    });
    const body = await res.json();
    return { status: res.status, body, latencyMs: Date.now() - sttStart };
  }, { sessionId });
  console.log('[stt round-trip]', JSON.stringify(sttRes));
  expect(sttRes.status).toBe(200);

  // 4. 아이 메시지 저장
  const turnId = crypto.randomUUID();
  const msgRes = await page.evaluate(
    async ({ sessionId, turnId, text }) => {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, role: 'child', content: text, turnId, displaySequence: 1 }),
      });
      return { status: res.status, body: await res.text() };
    },
    { sessionId, turnId, text: '체육 시간에 축구한 게 제일 기억나' }
  );
  console.log('[chat/messages child]', JSON.stringify(msgRes));
  expect(msgRes.status).toBe(200);

  // 5. LLM 응답 생성 (수동 모드)
  const respondManual = await page.evaluate(
    async ({ sessionId }) => {
      const start = Date.now();
      const res = await fetch('/api/voice/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          history: [{ role: 'child', text: '체육 시간에 축구한 게 제일 기억나' }],
          appMode: 'manual',
        }),
      });
      const body = await res.json().catch((e) => ({ parseError: String(e) }));
      return { status: res.status, body, latencyMs: Date.now() - start };
    },
    { sessionId }
  );
  console.log('[voice/respond manual]', JSON.stringify(respondManual));
  expect(respondManual.status).toBe(200);
  expect(respondManual.body.text?.length).toBeGreaterThan(0);
  console.log('[K response - manual]', respondManual.body.text);

  // 6. LLM 응답 생성 (자동 모드) — appMode만 다르게, manual과 분기가 있는지 확인
  const respondAuto = await page.evaluate(
    async ({ sessionId }) => {
      const start = Date.now();
      const res = await fetch('/api/voice/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          history: [{ role: 'child', text: '체육 시간에 축구한 게 제일 기억나' }],
          appMode: 'auto',
        }),
      });
      const body = await res.json().catch((e) => ({ parseError: String(e) }));
      return { status: res.status, body, latencyMs: Date.now() - start };
    },
    { sessionId }
  );
  console.log('[voice/respond auto]', JSON.stringify(respondAuto));
  expect(respondAuto.status).toBe(200);
  expect(respondAuto.body.text?.length).toBeGreaterThan(0);
  console.log('[K response - auto]', respondAuto.body.text);
});
