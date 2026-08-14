import { test } from '@playwright/test';

/**
 * "케이랑 접속이 끊겼네?" 오버레이가 미션 시작 전에 뜨는 원인 추적.
 * 필터 없이 전부 찍는다 — 무엇이 이 오버레이를 켜는지 아직 모른다.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://app.k-bestie.com';
const USERNAME = process.env.QA_CHILD_USERNAME || 'psh160202';

test('디버그: 미션 진입 시 오버레이 발생 시점 추적', async ({ page }) => {
  test.setTimeout(180000);
  const t0 = Date.now();
  const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
  let tracing = false;

  page.on('console', (msg) => {
    if (!tracing) return;
    console.log(`${stamp()} [${msg.type()}] ${msg.text().slice(0, 300)}`);
  });
  page.on('pageerror', (err) => console.log(`${stamp()} [pageerror] ${err.message.slice(0, 300)}`));
  page.on('response', async (res) => {
    if (!tracing || !res.url().includes('/api/mission')) return;
    const body = await res.text().catch(() => '<unreadable>');
    console.log(`${stamp()} [res ${res.status()}] ${res.url().replace(BASE, '')}\n    ${body.slice(0, 900)}`);
  });
  page.on('websocket', (ws) => {
    if (!tracing) return;
    console.log(`${stamp()} [ws] ${ws.url().slice(0, 100)}`);
    ws.on('socketerror', (e) => console.log(`${stamp()} [ws error] ${e}`));
    ws.on('close', () => console.log(`${stamp()} [ws close]`));
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill(USERNAME);
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: /나중에 할게요/ }).click({ timeout: 20000 }).catch(() => {});
  await page.waitForURL('**/child**', { timeout: 30000 });

  tracing = true;
  console.log(`${stamp()} === 미션 진입 ===`);
  await page.goto(`${BASE}/child/missions`, { waitUntil: 'domcontentloaded' });

  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(500);
    const body = await page.locator('body').innerText().catch(() => '');
    if (body.includes('케이랑 접속이 끊겼네')) {
      console.log(`${stamp()} !!! 오버레이 등장 !!!`);
      break;
    }
  }
  await page.waitForTimeout(1500);
  console.log(`${stamp()} 끝`);
});
