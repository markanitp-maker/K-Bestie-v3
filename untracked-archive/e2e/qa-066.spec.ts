import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;

const CHILD_A_EMAIL = 'qapersona2@kbestie.local';
const PARENT_A_EMAIL = 'qatest-parent-dev@kbestie.local';
const CHILD_B_EMAIL = 'qatesti-dev@kbestie.local';

const logDir = '/tmp/agy-qa-066llmwiki';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

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

async function loginAs(email: string, context: BrowserContext) {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: linkRes, error: linkErr } = await service.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr) throw new Error(`generateLink failed for ${email}: ${linkErr.message}`);
  
  const { data: verRes, error: verErr } = await anon.auth.verifyOtp({ token_hash: linkRes.properties!.hashed_token, type: 'magiclink' });
  if (verErr) throw new Error(`verifyOtp failed for ${email}: ${verErr.message}`);
  
  await useSession(context, verRes.session!, DEV_BASE);
}

async function closePwaModal(page: import('@playwright/test').Page) {
  try {
    const btn = page.locator('button', { hasText: '나중에 할게요' });
    await btn.waitFor({ state: 'visible', timeout: 8000 });
    await btn.click();
    await page.waitForTimeout(1000);
  } catch (e) {
    // ignore
  }
}

test('QA-066: 시나리오 1 — 아이 자유대화 기억 회상', async ({ page, context }) => {
  test.setTimeout(180000); // 3 mins
  await loginAs(CHILD_A_EMAIL, context);
  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'load' });
  await closePwaModal(page);
  await page.waitForTimeout(3000);

  const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  if (await keyboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await keyboardBtn.click();
  }

  // Question 1: "내가 싫어하는 과일이 뭐지?"
  let input = page.locator('input[type="text"]').last();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill('내가 싫어하는 과일이 뭐지?');
  await page.getByRole('button', { name: '전송' }).click();
  
  await page.waitForTimeout(15000);
  let currentBubble = page.locator('p.text-left').first();
  let currentText = (await currentBubble.textContent().catch(() => '')) || '';
  console.log('[Child A Q1 text]', currentText);
  await page.screenshot({ path: path.join(logDir, 'child_a_q1.png') });
  
  expect(currentText).toContain('참외');

  // Question 2: "내가 먹고 싶은 과일은?"
  input = page.locator('input[type="text"]').last();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill('내가 먹고 싶은 과일은?');
  await page.getByRole('button', { name: '전송' }).click();
  
  await page.waitForTimeout(15000);
  currentBubble = page.locator('p.text-left').first();
  currentText = (await currentBubble.textContent().catch(() => '')) || '';
  console.log('[Child A Q2 text]', currentText);
  await page.screenshot({ path: path.join(logDir, 'child_a_q2.png') });
  
  expect(currentText).toContain('수박');
});

test('QA-066: 시나리오 2 — 부모 화면 알려진 정보 조회', async ({ page, context }) => {
  test.setTimeout(180000); // 3 mins
  await loginAs(PARENT_A_EMAIL, context);
  await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: 'load' });
  await closePwaModal(page);
  await page.waitForTimeout(3000);

  // Find and click "케이와의 대화" or similar
  // Let's just navigate directly if we know the URL. It's usually /parent/k-chat or we can click it.
  // I will try to click a link containing "케이" or "대화"
  const kChatLink = page.locator('a', { hasText: /케이와|케이에게|대화/ }).first();
  if (await kChatLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await kChatLink.click();
  } else {
    // fallback
    await page.goto(`${DEV_BASE}/parent/k-chat`);
  }
  
  await page.waitForTimeout(3000);
  // Might need to select a child if there's a child selector
  const childSelectBtn = page.getByRole('button', { name: /QA테스트아이|qapersona2/ }).first();
  if (await childSelectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await childSelectBtn.click();
    await page.waitForTimeout(1000);
  }

  // Wait for chat input
  const input = page.locator('input[type="text"], textarea').last();
  await input.waitFor({ state: 'visible', timeout: 10000 });

  // Question 1: "아이가 좋아하는 과일은 뭐니?"
  await input.fill('아이가 좋아하는 과일은 뭐니?');
  const sendBtn = page.locator('button:has(svg), button:has-text("전송")').last();
  await sendBtn.click();
  
  await page.waitForTimeout(20000);
  let currentBubble = page.locator('div:has(> p), p').filter({ hasText: /(수박|참외|과일)/ }).last();
  let currentText = (await currentBubble.textContent().catch(() => '')) || '';
  // Fallback if specific filtering fails
  if (!currentText) {
    currentText = await page.locator('main, div').innerText();
  }
  console.log('[Parent A Q1 text]', currentText);
  await page.screenshot({ path: path.join(logDir, 'parent_a_q1.png') });
  
  expect(currentText).toContain('수박');

  // Question 2: "아이가 싫어하는 과일은 뭐니?"
  await input.fill('아이가 싫어하는 과일은 뭐니?');
  await sendBtn.click();
  
  await page.waitForTimeout(20000);
  currentBubble = page.locator('div:has(> p), p').filter({ hasText: /(수박|참외|과일)/ }).last();
  currentText = (await currentBubble.textContent().catch(() => '')) || '';
  if (!currentText) {
    currentText = await page.locator('main, div').innerText();
  }
  console.log('[Parent A Q2 text]', currentText);
  await page.screenshot({ path: path.join(logDir, 'parent_a_q2.png') });
  
  expect(currentText).toContain('참외');
});

test('QA-066: 시나리오 3 — 아이 간 기억 격리', async ({ page, context }) => {
  test.setTimeout(180000); // 3 mins
  await loginAs(CHILD_B_EMAIL, context);
  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'load' });
  await closePwaModal(page);
  await page.waitForTimeout(3000);

  const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  if (await keyboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await keyboardBtn.click();
  }

  const input = page.locator('input[type="text"]').last();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill('내가 좋아하는 과일 기억나?');
  await page.getByRole('button', { name: '전송' }).click();
  
  await page.waitForTimeout(15000);
  const currentBubble = page.locator('p.text-left').first();
  const currentText = (await currentBubble.textContent().catch(() => '')) || '';
  console.log('[Child B text]', currentText);
  await page.screenshot({ path: path.join(logDir, 'child_b.png') });
  
  expect(currentText).not.toContain('수박');
  expect(currentText).not.toContain('참외');
  expect(currentText).not.toContain('스케이트장');
});
