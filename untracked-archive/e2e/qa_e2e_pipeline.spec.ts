import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
const adminEmail = 'qa-parent@kbestie.local';

function projectRef(url: string) {
  return new URL(url).hostname.split('.')[0];
}

async function useSession(context: BrowserContext, session: Session, url: string, databaseUrl: string) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  const cookieName = `sb-${projectRef(databaseUrl)}-auth-token`;
  const chunks = value.length <= 3180
    ? [{ name: cookieName, value }]
    : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
        name: `${cookieName}.${index}`,
        value: value.slice(index * 3180, (index + 1) * 3180),
      }));
  await context.addCookies(
    chunks.map((chunk) => ({ ...chunk, url, secure: true, sameSite: 'Lax' as const }))
  );
}

test.describe('V3 Pipeline Manual E2E', () => {
  test.setTimeout(120000);

  test('TestA: Create 30 messages and run manual pipeline', async ({ page, context }) => {
    // 1. Login as TestA parent and go to child app
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('아이 아이디를 입력하세요').fill('testa');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL('**/child**', { timeout: 15000 });

    // 2. session 생성
    const sessionRes = await page.evaluate(async () => {
      const childId = localStorage.getItem('k_child_id');
      const res = await fetch('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId }),
      });
      return { status: res.status, body: await res.json(), childId };
    });
    console.log('[session]', sessionRes);
    expect(sessionRes.status).toBe(200);
    const sessionId = sessionRes.body.sessionId;
    const childId = sessionRes.childId;

    // 3. Generate 30 messages (15 child, 15 assistant)
    console.log(`Generating 30 messages for sessionId: ${sessionId}...`);
    for (let i = 1; i <= 15; i++) {
      const childRes = await page.evaluate(
        async ({ sessionId, text, displaySequence }) => {
          const res = await fetch('/api/chat/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, role: 'child', content: text, turnId: crypto.randomUUID(), displaySequence }),
          });
          return { status: res.status };
        },
        { sessionId, text: `나는 유치원에서 친구들과 축구하는 게 너무 재미있었어! ${i}`, displaySequence: i * 2 - 1 }
      );
      expect(childRes.status).toBe(200);

      const asstRes = await page.evaluate(
        async ({ sessionId, text, displaySequence }) => {
          const res = await fetch('/api/chat/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, role: 'assistant', content: text, turnId: crypto.randomUUID(), displaySequence }),
          });
          return { status: res.status };
        },
        { sessionId, text: `정말 멋지다! 축구를 하면 기분이 어때? ${i}`, displaySequence: i * 2 }
      );
      expect(asstRes.status).toBe(200);
    }
    console.log('Finished generating messages.');

    // 4. Authenticate as Admin
    console.log('Authenticating as Admin...');
    const service = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const authClient = () => createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: adminLink, error: adminLinkError } = await service.auth.admin.generateLink({
      type: 'magiclink',
      email: adminEmail,
    });
    expect(adminLinkError).toBeNull();
    expect(adminLink.properties?.hashed_token).toBeTruthy();

    const adminAuth = authClient();
    const { data: verifiedAdmin, error: verifyAdminError } = await adminAuth.auth.verifyOtp({
      token_hash: adminLink.properties!.hashed_token,
      type: 'magiclink',
    });
    expect(verifyAdminError).toBeNull();
    expect(verifiedAdmin.session).toBeTruthy();
    
    await useSession(context, verifiedAdmin.session!, BASE, supabaseUrl!);

    // 5. Navigate to Admin page to ensure cookies are sent
    await page.goto(`${BASE}/admin/retention`, { waitUntil: 'networkidle' });

    // 6. Trigger manual collection and generation
    console.log('Triggering manual collection and generation for TestA...');
    const triggerRes = await page.evaluate(async ({ childId }) => {
      // Create a function to poll
      const poll = async (executionId, action, targetCount) => {
        let errorCount = 0;
        let isComplete = false;
        let summary = null;
        for (let i = 0; i < 60; i++) { // Max 2 minutes
          await new Promise(r => setTimeout(r, 2000));
          const res = await fetch('/api/admin/reporting/pulse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ executionId, action, targetCount })
          });
          const data = await res.json();
          if (data.ok && data.isComplete) {
            isComplete = true;
            summary = data.summary;
            break;
          }
        }
        return { isComplete, summary };
      };

      const res = await fetch('/api/admin/reporting/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDate: '2026-08-03', action: 'collect_and_generate', target: { scope: 'single', childId } })
      });
      const data = await res.json();
      
      if (data.v3 && data.execution_id && !data.completed) {
         return await poll(data.execution_id, 'collect_and_generate', 1);
      }
      return data;
    }, { childId });

    console.log('[Manual Trigger Result]', triggerRes);
    expect(triggerRes.isComplete).toBe(true);
    expect(triggerRes.summary?.report?.success).toBe(1);
    console.log('✅ TestA pipeline verified successfully.');
  });
});
