import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { createClient, type Session } from '@supabase/supabase-js';

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const EVIDENCE_DIR = '/tmp/agy-qa-073-track2';
const CHILD_ID = 'fe3ba9aa-5485-43fb-b8eb-a5838f6f9ff9'; // TestChild
const QA_EMAIL = 'qatesti-dev@kbestie.local';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

function getProjectRef(url: string) {
  return new URL(url).hostname.split('.')[0];
}

async function setupAuthCookies(context: BrowserContext): Promise<{ cookieName: string; cookieValue: string }> {
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email: QA_EMAIL,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(`Failed to generate magiclink for ${QA_EMAIL}: ${linkErr?.message}`);
  }

  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  if (verifyErr || !verified?.session) {
    throw new Error(`Failed to verify OTP: ${verifyErr?.message}`);
  }

  const session = verified.session as Session;
  const projectRef = getProjectRef(SUPABASE_URL);
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;

  const chunks = cookieValue.length <= 3180
    ? [{ name: cookieName, value: cookieValue }]
    : Array.from({ length: Math.ceil(cookieValue.length / 3180) }, (_, index) => ({
        name: `${cookieName}.${index}`,
        value: cookieValue.slice(index * 3180, (index + 1) * 3180),
      }));

  await context.addCookies(chunks.map((cookie) => ({
    ...cookie,
    url: DEV_URL,
    secure: true,
    sameSite: 'Lax' as const,
  })));

  return { cookieName, cookieValue };
}

function getStartOfTodayKst(): string {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const yyyy = kstNow.getUTCFullYear();
  const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstNow.getUTCDate()).padStart(2, '0');
  const businessDate = `${yyyy}-${mm}-${dd}`;
  return new Date(`${businessDate}T00:00:00+09:00`).toISOString();
}

test.describe('QA-073 Track 2: 하루 1미션 세션생성 가드 E2E', () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test('시나리오 1: 동일 아이·날짜에 미션 시작 중복/동시 요청 시 단일 세션 재사용 및 중복 생성 방지', async ({ page, context }) => {
    const { cookieName, cookieValue } = await setupAuthCookies(context);

    // Call API twice concurrently
    const callStart = async () => {
      const res = await fetch(`${DEV_URL}/api/mission/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `${cookieName}=${cookieValue}`,
        },
        body: JSON.stringify({
          childId: CHILD_ID,
          roundType: 'common',
        }),
      });
      return { status: res.status, data: await res.json() };
    };

    const [req1, req2] = await Promise.all([callStart(), callStart()]);
    console.log('[Scenario 1] Concurrent req1:', req1);
    console.log('[Scenario 1] Concurrent req2:', req2);

    expect(req1.status).toBe(200);
    expect(req2.status).toBe(200);
    expect(req1.data.sessionId).toBeTruthy();
    expect(req2.data.sessionId).toBeTruthy();
    expect(req1.data.sessionId).toBe(req2.data.sessionId);

    // Call sequentially once more
    const seqReq = await callStart();
    console.log('[Scenario 1] Sequential req:', seqReq);
    expect(seqReq.status).toBe(200);
    expect(seqReq.data.sessionId).toBe(req1.data.sessionId);
    expect(seqReq.data.resumed).toBe(true);

    // Verify DB has exactly 1 session for this child today
    const startOfToday = getStartOfTodayKst();
    const { data: todaySessions, error: sessErr } = await service
      .from('chat_sessions')
      .select('id, started_at, session_type, mission_progress(*)')
      .eq('child_id', CHILD_ID)
      .eq('session_type', 'mission')
      .gte('started_at', startOfToday);

    expect(sessErr).toBeNull();
    console.log(`[Scenario 1] Today sessions in DB count: ${todaySessions?.length}`);
    expect(todaySessions?.length).toBe(1);
    expect(todaySessions![0].id).toBe(req1.data.sessionId);
  });

  test('시나리오 3: 오늘 IN_PROGRESS 세션이 있는 상태에서 미션 화면 재진입 시 항상 동일 세션으로 이어하기(resume) 확인', async ({ page, context }) => {
    await setupAuthCookies(context);

    // Ensure session is IN_PROGRESS in DB
    const startOfToday = getStartOfTodayKst();
    const { data: todaySession } = await service
      .from('chat_sessions')
      .select('id, mission_progress(*)')
      .eq('child_id', CHILD_ID)
      .eq('session_type', 'mission')
      .gte('started_at', startOfToday)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    expect(todaySession).toBeTruthy();
    const expectedSessionId = todaySession!.id;

    await service
      .from('mission_progress')
      .update({ status: 'IN_PROGRESS' })
      .eq('session_id', expectedSessionId);

    // Listen to network requests to verify /api/mission/start is called and resumed
    let interceptedSessionId: string | null = null;
    let isResumed: boolean | null = null;

    page.on('response', async (response) => {
      if (response.url().includes('/api/mission/start') && response.request().method() === 'POST') {
        try {
          const json = await response.json();
          interceptedSessionId = json.sessionId;
          isResumed = json.resumed;
          console.log('[Scenario 3] Intercepted /api/mission/start response:', json);
        } catch {}
      }
    });

    // Navigate to mission page
    await page.goto(`${DEV_URL}/child/missions?childId=${CHILD_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'scenario3_in_progress_entry.png') });

    expect(interceptedSessionId).toBe(expectedSessionId);
    expect(isResumed).toBe(true);

    // Verify page content does not show error
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('미션을 시작하지 못했어요');
    expect(bodyText).not.toContain('Database error');
  });

  test('시나리오 4: 1개 이상 질문 답변 후 페이지 새로고침/재진입 시 진행 상태 유지(세션 유지) 확인', async ({ page, context }) => {
    const { cookieName, cookieValue } = await setupAuthCookies(context);

    // Get today's active session and question ids
    const startOfToday = getStartOfTodayKst();
    const { data: todaySession } = await service
      .from('chat_sessions')
      .select('id, mission_progress(*)')
      .eq('child_id', CHILD_ID)
      .eq('session_type', 'mission')
      .gte('started_at', startOfToday)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    expect(todaySession).toBeTruthy();
    const sessionId = todaySession!.id;
    const progress = Array.isArray(todaySession!.mission_progress)
      ? todaySession!.mission_progress[0]
      : todaySession!.mission_progress;

    const firstQuestionId = progress.question_ids[0];
    console.log('[Scenario 4] Answering first question:', firstQuestionId, 'for session:', sessionId);

    // Submit answer to question 1
    const answerRes = await fetch(`${DEV_URL}/api/mission/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${cookieName}=${cookieValue}`,
      },
      body: JSON.stringify({
        sessionId,
        questionId: firstQuestionId,
        answerText: '안녕 나는 테스트차일드야 오늘 학교에서 재미있었어',
        childTurnId: `qa-turn-${Date.now()}`,
      }),
    });

    const answerJson = await answerRes.json();
    console.log('[Scenario 4] Answer response:', answerRes.status, answerJson);
    expect(answerRes.status).toBe(200);

    // Verify DB progress updated
    const { data: updatedProgress } = await service
      .from('mission_progress')
      .select('valid_answer_count, question_states, status')
      .eq('session_id', sessionId)
      .single();

    console.log('[Scenario 4] DB updated progress:', updatedProgress);
    expect(updatedProgress?.valid_answer_count).toBeGreaterThanOrEqual(1);

    // Now reload the page in browser
    let resumedSessionId: string | null = null;
    let resumedCount: number | null = null;

    page.on('response', async (response) => {
      if (response.url().includes('/api/mission/start') && response.request().method() === 'POST') {
        try {
          const json = await response.json();
          resumedSessionId = json.sessionId;
          resumedCount = json.validAnswerCount;
          console.log('[Scenario 4] Intercepted start on reload:', json);
        } catch {}
      }
    });

    await page.goto(`${DEV_URL}/child/missions?childId=${CHILD_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'scenario4_progress_maintained_reload.png') });

    // Assert session not lost and validAnswerCount maintained
    expect(resumedSessionId).toBe(sessionId);
    expect(resumedCount).toBe(updatedProgress?.valid_answer_count);

    // Reload again to verify idempotency
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    expect(resumedSessionId).toBe(sessionId);
  });

  test('시나리오 2: 오늘 이미 COMPLETED 완료된 상태에서 미션 화면 재진입 시 잠김(locked/confirm) UI 및 응답 확인', async ({ page, context }) => {
    const { cookieName, cookieValue } = await setupAuthCookies(context);

    const startOfToday = getStartOfTodayKst();
    const { data: todaySession } = await service
      .from('chat_sessions')
      .select('id, mission_progress(*)')
      .eq('child_id', CHILD_ID)
      .eq('session_type', 'mission')
      .gte('started_at', startOfToday)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    expect(todaySession).toBeTruthy();
    const sessionId = todaySession!.id;

    // Mark mission as COMPLETED in DB to simulate finished state
    const { error: compErr } = await service
      .from('mission_progress')
      .update({
        status: 'COMPLETED',
        valid_answer_count: 10,
      })
      .eq('session_id', sessionId);
    expect(compErr).toBeNull();

    // Call /api/mission/start without confirmRestart
    const startRes = await fetch(`${DEV_URL}/api/mission/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${cookieName}=${cookieValue}`,
      },
      body: JSON.stringify({
        childId: CHILD_ID,
        roundType: 'common',
      }),
    });

    const startData = await startRes.json();
    console.log('[Scenario 2] COMPLETED session start API response:', startRes.status, startData);

    // Should indicate already completed today (either locked or requiresConfirmation)
    expect(startData.alreadyCompletedToday).toBe(true);

    // Now test Browser UI rendering
    let interceptedLockedOrConfirm: any = null;
    page.on('response', async (response) => {
      if (response.url().includes('/api/mission/start') && response.request().method() === 'POST') {
        try {
          interceptedLockedOrConfirm = await response.json();
        } catch {}
      }
    });

    await page.goto(`${DEV_URL}/child/missions?childId=${CHILD_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'scenario2_completed_locked_screen.png') });

    // Verify UI shows either locked screen or completion confirmation
    const pageText = await page.locator('body').innerText();
    console.log('[Scenario 2] Page text:', pageText);

    const hasLockedMessage = pageText.includes('미션을 이미 완료') || pageText.includes('이미 완료') || pageText.includes('다음 미션');
    const hasRestartConfirmMessage = pageText.includes('다시 할래요') || pageText.includes('다시 시작') || pageText.includes('완료');
    
    expect(hasLockedMessage || hasRestartConfirmMessage).toBe(true);

    // Verify no new session created in DB
    const { data: allSessionsToday } = await service
      .from('chat_sessions')
      .select('id')
      .eq('child_id', CHILD_ID)
      .eq('session_type', 'mission')
      .gte('started_at', startOfToday);

    expect(allSessionsToday?.length).toBe(1);
  });
});
