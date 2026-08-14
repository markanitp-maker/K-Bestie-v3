import { test, expect } from '@playwright/test';

/**
 * 2026-08-14 장애(김지호/jiho0520) 검증.
 *
 * 고객이 기기 앱을 리셋한 뒤 겪을 경로를 그대로 재현한다 — 캐시·서비스워커가
 * 전혀 없는 상태에서 로그인해 자유대화와 미션이 실제로 열리는지 본다.
 * 장애 당시 증상은 자유대화가 "케이가 이야기를 준비하고 있어요..."에서 멈추고,
 * 미션이 "케이랑 접속이 끊겼네?" 오버레이로 막히는 것이었다.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://app.k-bestie.com';
const USERNAME = process.env.QA_CHILD_USERNAME || 'testa';

test('장애 095: 깨끗한 클라이언트에서 로그인·자유대화·미션 진입이 정상이다', async ({ page }) => {
  test.setTimeout(180000);

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('/api/analytics')) {
      failedRequests.push(`${res.status()} ${res.url()}`);
    }
  });

  // 1. 로그인 — 리셋 직후 상태(빈 캐시·SW 없음)
  //
  // 최초 방문에서는 서비스워커가 activate하며 clients.claim()으로 제어권을 잡고,
  // 그때 controllerchange가 떠서 페이지가 한 번 새로고침된다(기존 동작). 그 전에
  // 입력하면 값이 날아가므로 새로고침이 끝난 뒤에 채운다.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  await page.waitForLoadState('networkidle');

  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  const pwInput = page.getByPlaceholder('비밀번호를 입력하세요');
  await idInput.fill(USERNAME);
  await pwInput.fill(process.env.QA_TEST_PASSWORD || '');

  const loginButton = page.getByRole('button', { name: '로그인', exact: true });
  await expect(loginButton).toBeEnabled({ timeout: 10000 });
  await loginButton.click();

  // 로그인 직후 PWA 설치 안내가 먼저 뜬다. 실제 아이도 여기서 넘어가야 홈에 닿는다.
  const skipInstall = page.getByRole('button', { name: /나중에 할게요/ });
  await skipInstall.click({ timeout: 20000 }).catch(() => {});

  await page.waitForURL('**/child**', { timeout: 30000 });
  await page.waitForTimeout(2000);

  expect(await page.locator('body').innerText()).not.toContain('Application error');
  console.log('[095] 로그인 OK ->', page.url());

  // 2. 서버·클라이언트 버전이 일치해야 미션 진입 게이트를 통과한다
  const versionBody = await page.evaluate(async () => {
    const res = await fetch('/api/client-version', { cache: 'no-store' });
    return res.json();
  });
  console.log('[095] 서버 buildId =', JSON.stringify(versionBody));
  expect(typeof versionBody.buildId).toBe('string');

  // 3. 자유대화 — 장애 때 "준비하고 있어요..."에서 멈췄던 화면
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  const chatText = await page.locator('body').innerText();
  console.log('[095] 자유대화 화면:', chatText.replace(/\s+/g, ' ').slice(0, 300));
  expect(chatText).not.toContain('Application error');
  expect(chatText).not.toContain('케이랑 접속이 끊겼네');

  // 4. 미션 진입 — 장애 때 오버레이로 막혔던 화면
  await page.goto(`${BASE}/child/missions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(8000);
  const missionText = await page.locator('body').innerText();
  console.log('[095] 미션 화면:', missionText.replace(/\s+/g, ' ').slice(0, 400));

  await page.screenshot({ path: 'e2e-095-mission.png', fullPage: true });

  // 단언보다 먼저 찍는다 — 실패했을 때 원인을 봐야 한다.
  console.log('[095] 콘솔 오류 전체:', JSON.stringify(consoleErrors, null, 1));
  console.log('[095] 실패 요청 전체:', JSON.stringify(failedRequests, null, 1));

  expect(missionText).not.toContain('Application error');
  expect(missionText).not.toContain('케이랑 접속이 끊겼네');
  expect(missionText).not.toContain('앱을 최신 상태로 바꾼 뒤 다시 열어 주세요');
  expect(missionText).not.toContain('서버에서 현재 미션 상태를 다시 확인하지 못했어요');

  console.log('[095] 콘솔 오류:', consoleErrors.slice(0, 10));
  console.log('[095] 실패 요청:', failedRequests.slice(0, 10));

  // 배포 교체로 청크를 못 받는 상황이 있었다면 여기서 드러난다
  const chunkFailures = failedRequests.filter((r) => r.includes('/_next/static/'));
  expect(chunkFailures, `정적 자산 실패: ${chunkFailures.join(', ')}`).toHaveLength(0);
});
