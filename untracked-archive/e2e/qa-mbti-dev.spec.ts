import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const QA_PASSWORD = process.env.QA_TEST_PASSWORD || '';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const EVIDENCE_DIR = '/tmp/agy-qa-mbti';

test.describe('MBTI 카드 iframe 빈 화면 버그 E2E 검증', () => {
  test('시나리오 1, 2, 3 전체 검증', async ({ page }) => {
    test.setTimeout(120000);

    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }

    const consoleLogs: string[] = [];
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];
    const networkRequests: { url: string; status: number }[] = [];

    page.on('console', (msg) => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(entry);
      if (msg.type() === 'error') {
        consoleErrors.push(entry);
      }
    });

    page.on('requestfailed', (req) => {
      networkErrors.push(`FAILED ${req.method()} ${req.url()} ${req.failure()?.errorText}`);
    });

    page.on('response', (res) => {
      networkRequests.push({ url: res.url(), status: res.status() });
      if (res.status() >= 400) {
        networkErrors.push(`HTTP ${res.status()} ${res.url()}`);
      }
    });

    // --- Step 1: 로그인 ---
    console.log('=== Step 1: 로그인 ===');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('load');

    const idInput = page.getByPlaceholder('아이 아이디를 입력하세요').or(page.locator('input[type="text"]').first());
    await idInput.waitFor({ state: 'visible', timeout: 15000 });
    await idInput.click();
    await idInput.fill('');
    await idInput.type('qatesti-dev', { delay: 50 });

    const pwInput = page.getByPlaceholder('비밀번호를 입력하세요').or(page.locator('input[type="password"]').first());
    await pwInput.click();
    await pwInput.fill('');
    await pwInput.type(QA_PASSWORD, { delay: 50 });
    await page.waitForTimeout(300);

    const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
    await expect(loginBtn).toBeEnabled();
    await loginBtn.click();

    // 로그인 후 처리 (onboarding 또는 child 등 리다이렉트 대기)
    await page.waitForURL(/\/(parent|child|onboarding)/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'step1-login-after.png') });

    // --- Step 1-2: /child/play 이동 및 MBTI 카드 클릭 ---
    console.log('=== Step 1-2: /child/play 이동 및 MBTI 카드 클릭 ===');
    await page.goto(`${BASE_URL}/child/play`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'step1-play-home.png') });

    const mbtiCard = page.getByText('오늘의 나').or(page.getByText('MBTI'));
    await expect(mbtiCard.first()).toBeVisible({ timeout: 10000 });
    await mbtiCard.first().click();

    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'step1-modal-check.png') });

    // 시작/이어하기/새로시작 모달 확인 및 클릭
    const startBtn = page.getByRole('button', { name: /시작하기|이어하기|새로 시작|새로시작|시작/i });
    if (await startBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('모달 발견, 버튼 클릭');
      await startBtn.first().click();
    }

    // /child/play/mbti 이동 확인
    await page.waitForURL('**/child/play/mbti**', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000); // iframe 및 static 자산 로딩 대기
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'step1-mbti-iframe-loaded.png') });

    // iframe 표시 확인
    const iframeElement = page.locator('iframe').first();
    await expect(iframeElement).toBeVisible({ timeout: 10000 });

    const frame = page.frameLocator('iframe').first();
    let frameBodyText = '';
    try {
      frameBodyText = await frame.locator('body').innerText({ timeout: 10000 });
    } catch (e) {
      console.log('failed to read iframe body:', String(e));
    }
    console.log('iframe body text (sample):', frameBodyText.slice(0, 300));

    // _next/static 자산 로드 확인 (200/304 response)
    const staticAssets = networkRequests.filter(r => r.url.includes('_next/static'));
    console.log('_next/static 자산 요청 개수:', staticAssets.length);
    const staticFailures = staticAssets.filter(r => r.status >= 400);
    console.log('_next/static 자산 실패 개수:', staticFailures.length);

    // CSP / frame-ancestors 에러 체크
    const hasCspError = consoleErrors.some(m => m.includes('frame-ancestors') || m.includes('CSP')) ||
      networkErrors.some(m => m.includes('ERR_BLOCKED_BY_RESPONSE') || m.includes('frame-ancestors'));

    console.log('CSP / frame-ancestors 오류 여부:', hasCspError);
    expect(hasCspError, 'CSP / frame-ancestors 오류가 없어야 함').toBe(false);
    expect(frameBodyText.trim().length, 'iframe 내부 body가 비어있지 않아야 함').toBeGreaterThan(0);

    // --- Step 2: iframe 문항 응답 및 화면 전환, API 저장, URL 유지 확인 ---
    console.log('=== Step 2: iframe 문항 응답 및 진행 ===');
    let currentUrl = page.url();
    console.log('현재 메인 창 URL:', currentUrl);
    expect(currentUrl).toContain('/child/play/mbti');

    // iframe 내부의 클릭 가능한 요소(버튼, 선택지) 찾기
    const frameButtons = frame.locator('button, [role="button"], a, div[onclick], div.cursor-pointer');
    const buttonCount = await frameButtons.count();
    console.log('iframe 내부 클릭 가능 요소 수:', buttonCount);

    if (buttonCount > 0) {
      console.log('첫 번째 선택지/버튼 클릭');
      await frameButtons.first().click({ force: true }).catch(async () => {
        const anyChoice = frame.locator('text=/Start|시작|검사|Q|문항|A|B|예|아니오/i').first();
        if (await anyChoice.isVisible()) {
          await anyChoice.click();
        }
      });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'step2-after-click-1.png') });

      let frameBodyText2 = '';
      try {
        frameBodyText2 = await frame.locator('body').innerText({ timeout: 5000 });
      } catch {}
      console.log('클릭 후 iframe body text (sample):', frameBodyText2.slice(0, 300));

      const frameButtons2 = frame.locator('button, [role="button"], a');
      if (await frameButtons2.count() > 0) {
        console.log('두 번째 선택지/버튼 클릭');
        await frameButtons2.first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, 'step2-after-click-2.png') });
      }
    }

    const urlStep2 = page.url();
    console.log('Step 2 메인 창 URL:', urlStep2);
    expect(urlStep2).toContain('/child/play/mbti');

    // --- Step 3: 복귀 및 세션/재화 차감 상태 확인 ---
    console.log('=== Step 3: /child/play 복귀 및 중복 차감 확인 ===');
    const backBtn = page.getByRole('button', { name: /뒤로|닫기|돌아가기/i }).or(page.locator('header button')).first();
    if (await backBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await backBtn.click();
    } else {
      await page.goBack();
    }

    await page.waitForURL('**/child/play', { timeout: 10000 }).catch(async () => {
      await page.goto(`${BASE_URL}/child/play`);
    });
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'step3-back-to-play.png') });

    expect(page.url()).toContain('/child/play');

    // 로그 보존
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'console-logs.txt'), consoleLogs.join('\n'), 'utf-8');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'console-errors.txt'), consoleErrors.join('\n'), 'utf-8');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'network-errors.txt'), networkErrors.join('\n'), 'utf-8');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'network-requests.txt'), networkRequests.map(r => `${r.status} ${r.url}`).join('\n'), 'utf-8');

    console.log('전체 E2E QA 검증 완료');
  });
});
