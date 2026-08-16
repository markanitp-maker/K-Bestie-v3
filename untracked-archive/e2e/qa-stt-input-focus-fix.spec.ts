import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

// requests/request-parent-k-stt-input-focus-fix-dev-prod.md — 입력창을 먼저 터치했는지와
// 무관하게 STT 최종 결과가 입력창에 반영되고, 마이크 중지 시 자동 전송되지 않는지 검증한다.
// 실제 SpeechRecognition은 헤드리스에서 쓸 수 없으므로 window.SpeechRecognition을
// 가짜 클래스로 교체해 onresult/onend 콜백을 직접 발생시킨다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
const PARENT_EMAIL = 'qatest-parent-dev@kbestie.local';
const CHILD_ID = '4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c'; // QA테스트아이(4학년)

function projectRef(url: string) {
  return new URL(url).hostname.split('.')[0];
}

async function useSession(context: BrowserContext, session: Session, url: string) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  const cookieName = `sb-${projectRef(SUPABASE_URL)}-auth-token`;
  const chunks =
    value.length <= 3180
      ? [{ name: cookieName, value }]
      : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
          name: `${cookieName}.${index}`,
          value: value.slice(index * 3180, (index + 1) * 3180),
        }));
  await context.addCookies(chunks.map((chunk) => ({ ...chunk, url, secure: true, sameSite: 'Lax' as const })));
}

const FAKE_SPEECH_RECOGNITION_INIT_SCRIPT = `
  class FakeSpeechRecognition {
    constructor() {
      this.lang = '';
      this.interimResults = false;
      this.continuous = false;
      this.maxAlternatives = 1;
      window.__fakeRecognitionInstances = window.__fakeRecognitionInstances || [];
      window.__fakeRecognitionInstances.push(this);
    }
    start() { if (this.onstart) this.onstart(); }
    stop() { if (this.onend) this.onend(); }
    abort() { if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;
`;

async function login(page: import('@playwright/test').Page, context: BrowserContext) {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: 'magiclink', email: PARENT_EMAIL });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: link.properties!.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);
  await useSession(context, verified.session!, BASE);
}

async function fireFinalTranscript(page: import('@playwright/test').Page, text: string) {
  await page.evaluate((transcript) => {
    const r = (window as any).__fakeRecognitionInstances.at(-1);
    r.onresult({
      resultIndex: 0,
      results: [{ 0: { transcript }, isFinal: true, length: 1 }],
    });
  }, text);
}

test.describe('부모-케이 대화 STT 입력창 포커스 의존 제거', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.addInitScript(FAKE_SPEECH_RECOGNITION_INIT_SCRIPT);
    await login(page, context);
    await page.goto(`${BASE}/parent/guide`, { waitUntil: 'load' });
    await page.evaluate((childId) => {
      const existing = JSON.parse(localStorage.getItem('k_store_v1') || '{}');
      localStorage.setItem('k_store_v1', JSON.stringify({ ...existing, activeChildId: childId }));
    }, CHILD_ID);
    await page.reload({ waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
  });

  test('입력창을 먼저 터치하지 않아도 STT 최종 결과가 입력창에 표시되고 자동 전송되지 않는다', async ({ page }) => {
    const input = page.locator('input[placeholder*="케이가 아는 선"], input[placeholder*="듣는 중"]').first();
    const micButton = page.locator('button').filter({ has: page.locator('svg') }).last();

    // 입력창을 터치하지 않고 곧바로 마이크 시작
    const startButtons = page.locator('button[type="button"]');
    await expect(input).toHaveValue('');

    const messagesBefore = await page.locator('text=케이가 아는 선에서').count().catch(() => 0);

    // 마이크 버튼: 입력창 오른쪽의 원형 버튼(전송 버튼은 입력값이 있을 때만 나타남 —
    // 입력이 비어 있는 지금은 마이크 버튼만 보인다)
    const micToggle = page.locator('form button[type="button"]').last();
    await micToggle.click({ force: true });
    await page.waitForTimeout(200);

    await fireFinalTranscript(page, '이번 주말에 뭐 하고 싶은지 물어봐줘');
    await micToggle.click({ force: true }); // 중지

    await expect(input).toHaveValue('이번 주말에 뭐 하고 싶은지 물어봐줘', { timeout: 5000 });

    // 자동 전송되지 않았는지 — 방금 발화 텍스트가 채팅 말풍선으로 나타나면 안 된다
    await page.waitForTimeout(1000);
    const sentAsMessage = await page.getByText('이번 주말에 뭐 하고 싶은지 물어봐줘', { exact: false }).count();
    // input 안의 값과 채팅 말풍선 텍스트를 구분하기 위해 input을 제외한 카운트만 확인
    const bubbleCount = await page.locator('.rounded-2xl, [class*="message"]').getByText('이번 주말에 뭐 하고 싶은지 물어봐줘').count().catch(() => 0);
    expect(bubbleCount, '자동 전송으로 채팅 말풍선이 생기면 안 된다').toBe(0);
  });

  test('입력창을 먼저 터치한 경우도 동일하게 동작한다(선터치 유무로 결과가 달라지지 않음)', async ({ page }) => {
    const input = page.locator('input[placeholder*="케이가 아는 선"], input[placeholder*="듣는 중"]').first();
    await input.click();

    const micToggle = page.locator('form button[type="button"]').last();
    await micToggle.click({ force: true });
    await page.waitForTimeout(200);
    await fireFinalTranscript(page, '요즘 좋아하는 놀이가 뭔지 물어봐줘');
    await micToggle.click({ force: true });

    await expect(input).toHaveValue('요즘 좋아하는 놀이가 뭔지 물어봐줘', { timeout: 5000 });
  });

  test('기존 입력값이 있으면 STT 결과가 뒤에 자연스럽게 이어붙는다', async ({ page }) => {
    const input = page.locator('input[placeholder*="케이가 아는 선"], input[placeholder*="듣는 중"]').first();
    await input.fill('서현이에게');

    const micToggle = page.locator('form button[type="button"]').last();
    await micToggle.click({ force: true });
    await page.waitForTimeout(200);
    await fireFinalTranscript(page, '오늘 학교에서 재미있었던 게 있었는지 물어봐 줘');
    await micToggle.click({ force: true });

    await expect(input).toHaveValue('서현이에게 오늘 학교에서 재미있었던 게 있었는지 물어봐 줘', { timeout: 5000 });
  });
});
