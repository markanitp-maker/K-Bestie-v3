import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// QA-022: Feedback attachments preservation bug and 401 unauth checks

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const serviceRoleKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
const adminEmail = "markanitp@gmail.com";

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function useSession(
  context: BrowserContext,
  session: Session,
  url: string,
  databaseUrl: string
) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const cookieName = `sb-${projectRef(databaseUrl)}-auth-token`;
  const chunks =
    value.length <= 3180
      ? [{ name: cookieName, value }]
      : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
          name: `${cookieName}.${index}`,
          value: value.slice(index * 3180, (index + 1) * 3180),
        }));
  await context.addCookies(
    chunks.map((chunk) => ({ ...chunk, url, secure: true, sameSite: "Lax" as const }))
  );
}

test('QA-022: Feedback attachments preservation & Unauth checks', async ({ page, context }) => {
  test.setTimeout(120_000);
  test.skip(
    !supabaseUrl || !serviceRoleKey || !anonKey,
    "Dev Supabase 검증용 환경변수가 필요합니다."
  );
  
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const imgPath = path.join(os.tmpdir(), 'qa-022-test-attachment.png');
  fs.writeFileSync(imgPath, Buffer.from(pngBase64, 'base64'));

  // 1. Child login
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  
  // Go to child home
  await page.goto(`${BASE}/child/home`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  
  // Open widget
  await page.getByLabel('문의하기 열기').click();
  await expect(page.locator('role=dialog')).toBeVisible();
  
  const uniqueContent = `QA Test Image Attachment ${Date.now()}`;
  await page.getByPlaceholder('케이에게 궁금한 내용을 적어줘.').fill(uniqueContent);
  
  // Upload image
  await page.locator('input[type="file"]').setInputFiles(imgPath);
  
  // Wait for upload finish
  await page.waitForResponse(r => r.url().includes('/api/support/attachments') && r.request().method() === 'POST');
  await page.waitForTimeout(2000); 
  
  // Submit
  const submitPromise = page.waitForResponse(r => r.url().includes('/api/support') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '제출하기', exact: true }).click();
  const submitRes = await submitPromise;
  expect(submitRes.status()).toBe(200);
  
  // Success Screen
  await expect(page.getByText(/접수번호는/)).toBeVisible();
  
  // Close with X button instead of '확인'
  await page.getByRole('dialog').getByLabel('닫기').click();
  await expect(page.locator('role=dialog')).toBeHidden();
  
  // Wait to make sure there's no DELETE request sent
  await page.waitForTimeout(3000);
  
  // 2. Admin Login
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authClient = () =>
    createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  const { data: adminLink, error: adminLinkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: adminEmail,
  });
  expect(adminLinkError).toBeNull();

  const adminAuth = authClient();
  const { data: verifiedAdmin, error: verifyAdminError } = await adminAuth.auth.verifyOtp({
    token_hash: adminLink.properties!.hashed_token,
    type: "magiclink",
  });
  expect(verifyAdminError).toBeNull();
  await useSession(context, verifiedAdmin.session!, BASE, supabaseUrl);

  // Go to Admin Page
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  
  // Feedback Tab
  await page.getByText('문의·건의·버그 접수').click();
  
  // Search for the unique content
  await page.getByPlaceholder('검색어 (접수번호, 내용)').fill(uniqueContent);
  
  // Wait for API reload
  await page.waitForResponse(r => r.url().includes('/api/admin/support-requests') && r.url().includes(encodeURIComponent(uniqueContent)));
  await page.waitForTimeout(1000);
  
  // Verify row and image badge
  const row = page.locator('tr', { hasText: uniqueContent }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText(/이미지 1장/)).toBeVisible();
  
  // Expand and check download link
  await row.click();
  await expect(page.getByRole('link', { name: '다운로드' })).toBeVisible();
  
  // 3. Unauthenticated API Check
  await context.clearCookies();
  const unauthRes = await page.request.get(`${BASE}/api/admin/support-requests`);
  expect(unauthRes.status()).toBe(401);
});
