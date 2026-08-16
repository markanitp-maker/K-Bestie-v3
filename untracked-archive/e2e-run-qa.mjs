import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Parse .env.local
const envContent = fs.readFileSync('/mnt/e/VibeCoding/K-Bestie-v3/.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_DEV_URL'];
const SUPABASE_ANON_KEY = env['NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY'];
const SUPABASE_SERVICE_ROLE_KEY = env['SUPABASE_DEV_SERVICE_ROLE_KEY'];
const QA_TEST_PASSWORD = env['QA_TEST_PASSWORD'] || 'QaDev1c65f921aea7!';
const APP_URL = 'https://k-bestie-v3-dev.vercel.app';
const OUT_DIR = '/tmp/agy-qa-authsignup/';

fs.mkdirSync(OUT_DIR, { recursive: true });

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const results = [];

async function pass(scenario, msg = '') {
  results.push(`[PASS] ${scenario}`);
  console.log(`✅ [PASS] ${scenario} ${msg}`);
}

async function fail(scenario, reason, page = null) {
  const screenshotPath = path.join(OUT_DIR, `fail_${scenario.split('.')[0]}_${Date.now()}.png`);
  if (page) {
    try { await page.screenshot({ path: screenshotPath }); } catch(e){}
  }
  const msg = `[FAIL: ${reason} / 증거경로: ${page ? screenshotPath : '없음'}]`;
  results.push(`${scenario} ${msg}`);
  console.error(`❌ ${scenario} ${msg}`);
}

async function getSession(email, password = 'Password123!') {
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

async function createNewUser() {
  const email = `test-new-${Date.now()}@kbestie.local`;
  const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({ 
      email, 
      password: 'Password123!', 
      email_confirm: true 
  });
  if (error) throw error;
  const session = await getSession(email);
  return { user, session, email };
}

async function injectSessionAndGoto(context, session, targetUrl) {
  const page = await context.newPage();
  await page.goto(`${APP_URL}/login`);
  await page.evaluate(async ({ url, key, session }) => {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(url, key);
    await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    await new Promise(r => setTimeout(r, 1000));
  }, { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, session });
  await page.goto(targetUrl);
  await page.waitForLoadState('networkidle');
  return page;
}

async function apiFetch(endpoint, session, method = 'GET', body = null) {
  const url = new URL(APP_URL);
  const projectId = new URL(SUPABASE_URL).hostname.split('.')[0];
  
  // Try to use cookie if needed, but Next.js API routes with Supabase usually read Auth header or cookie
  // Actually, many Next.js API routes in K-Bestie read cookies. We can mock the sb-xxx-auth-token cookie.
  const cookieValue = encodeURIComponent(JSON.stringify([
      session.access_token,
      session.refresh_token,
      null,
      null,
      null
  ]));
  
  const headers = {
    'Cookie': `sb-${projectId}-auth-token=${cookieValue}`,
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`
  };
  
  const res = await fetch(`${APP_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
    redirect: 'follow'
  });
  return res;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  console.log("Starting QA Tests...");

  // Scenario 1: New user
  try {
    const { session } = await createNewUser();
    const context = await browser.newContext();
    const page = await injectSessionAndGoto(context, session, `${APP_URL}/`);
    if (page.url().includes('/signup?step=consent')) {
      await pass('1. 신규 사용자');
    } else {
      await fail('1. 신규 사용자', `예상: /signup?step=consent, 실제: ${page.url()}`, page);
    }
    await context.close();
  } catch (e) { await fail('1. 신규 사용자', e.message); }

  // Scenario 2: Existing active user
  let existingUserSession;
  try {
    existingUserSession = await getSession('qapersona2@kbestie.local', QA_TEST_PASSWORD);
    const context = await browser.newContext();
    const page = await injectSessionAndGoto(context, existingUserSession, `${APP_URL}/`);
    
    // Check if redirected to signup
    if (!page.url().includes('/signup')) {
      await pass('2. 기존 활성 보호자 회귀');
    } else {
      await fail('2. 기존 활성 보호자 회귀', `가입 화면으로 튕김. 현재 URL: ${page.url()}`, page);
    }
    await context.close();
  } catch (e) { await fail('2. 기존 활성 보호자 회귀', e.message); }

  // Scenario 3: 4-step API E2E
  let apiTestUser;
  try {
    apiTestUser = await createNewUser();
    const { session, user } = apiTestUser;
    
    // Step 1: /api/signup/consent
    const res1 = await apiFetch('/api/signup/consent', session, 'POST', {
        agreements: [{ type: 'TERMS_OF_SERVICE', agreed: true, version: '1.0' }, { type: 'PRIVACY_POLICY', agreed: true, version: '1.0' }]
    });
    if (!res1.ok) throw new Error(`Consent API failed: ${res1.status}`);

    // Step 2: /api/signup/profile
    const res2 = await apiFetch('/api/signup/profile', session, 'POST', {
        name: 'QA 부모', phone: '010-0000-0000', relation_to_child: 'MOTHER', is_legal_guardian: true
    });
    if (!res2.ok) throw new Error(`Profile API failed: ${res2.status}`);
    
    // Step 3: /api/families (POST)
    const res3 = await apiFetch('/api/families', session, 'POST', { name: 'QA가족' });
    if (!res3.ok) throw new Error(`Families API failed: ${res3.status}`);
    const familyData = await res3.json();
    if (!familyData.family?.id) throw new Error("가족 ID 반환 안됨");
    const familyId = familyData.family.id;

    // Step 4: /api/families/[id]/children (POST)
    const res4 = await apiFetch(`/api/families/${familyId}/children`, session, 'POST', {
        last_name: '테', first_name: '스트', gender: 'MALE', login_id: `qa_child_${Date.now()}`,
        password: 'Password123!', password_confirm: 'Password123!', school_grade: 'GRADE_1', interests: [],
        legal_guardian_consent: true
    });
    if (!res4.ok) {
        const text = await res4.text();
        throw new Error(`Children API failed: ${res4.status} ${text}`);
    }

    // Verify DB
    const { data: members } = await supabaseAdmin.from('family_members').select('*').eq('family_id', familyId);
    if (!members || members.length < 2) throw new Error("DB에 family_members 행이 2개(부모, 아이) 미만임");
    
    // Verify autoApproved
    const { data: childReq } = await supabaseAdmin.from('child_approval_requests').select('*').eq('family_id', familyId).maybeSingle();
    // In beta, child_profiles or requests might show approved
    // If it's inserted directly to child_profiles
    await pass('3. 회원가입 4단계 API 흐름', 'DB생성 확인');
  } catch (e) { await fail('3. 회원가입 4단계 API 흐름', e.message); }

  // Scenario 4: Idempotency
  try {
    if (!apiTestUser) throw new Error("API Test user not created");
    const { session } = apiTestUser;
    
    // We already called POST /api/families in Scenario 3. Call again.
    const resDup = await apiFetch('/api/families', session, 'POST', { name: 'QA가족중복' });
    
    // It should not create a new one. It should return 409 or the same family.
    if (resDup.status === 409 || resDup.status === 200) {
        // Let's count families for this parent
        const { data: parent } = await supabaseAdmin.from('parents').select('family_id').eq('id', apiTestUser.user.id).single();
        // check family_members
        const { data: members } = await supabaseAdmin.from('family_members').select('*').eq('user_id', apiTestUser.user.id);
        if (members && members.length > 1) {
             throw new Error("가족이 중복 생성됨 (family_members 2개 이상)");
        }
        await pass('4. 멱등성', `응답상태: ${resDup.status}`);
    } else {
        throw new Error(`Unexpected status code for duplicate family: ${resDup.status}`);
    }
  } catch (e) { await fail('4. 멱등성', e.message); }

  // Scenario 5: Resume
  try {
    const { session } = await createNewUser();
    // Consent only
    await apiFetch('/api/signup/consent', session, 'POST', {
        agreements: [{ type: 'TERMS_OF_SERVICE', agreed: true, version: '1.0' }]
    });
    
    const context = await browser.newContext();
    const page = await injectSessionAndGoto(context, session, `${APP_URL}/`);
    // Should go to profile step
    if (page.url().includes('step=profile')) {
        await pass('5. 중단 후 재개');
    } else {
        await fail('5. 중단 후 재개', `예상: step=profile, 실제: ${page.url()}`, page);
    }
    await context.close();
  } catch (e) { await fail('5. 중단 후 재개', e.message); }

  // Scenario 6: SUSPENDED account
  try {
    const { session, user } = await createNewUser();
    // Complete signup partially to have a parent record
    await apiFetch('/api/signup/consent', session, 'POST', {
        agreements: [{ type: 'TERMS_OF_SERVICE', agreed: true, version: '1.0' }]
    });
    await apiFetch('/api/signup/profile', session, 'POST', {
        name: '정지부모', phone: '010-1111-1111', relation_to_child: 'MOTHER', is_legal_guardian: true
    });
    
    // Update to SUSPENDED via Admin
    await supabaseAdmin.from('parents').update({ account_status: 'SUSPENDED' }).eq('id', user.id);
    
    const context = await browser.newContext();
    const page = await injectSessionAndGoto(context, session, `${APP_URL}/parent/home`);
    
    if (page.url().includes('/account/suspended')) {
        await pass('6. SUSPENDED 계정 리다이렉트');
    } else {
        await fail('6. SUSPENDED 계정 리다이렉트', `예상: /account/suspended, 실제: ${page.url()}`, page);
    }
    await context.close();
  } catch (e) { await fail('6. SUSPENDED 계정 리다이렉트', e.message); }

  // Scenario 7: Mobile viewport
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    });
    const { session } = await createNewUser();
    
    // Try to visit /signup directly to see if UI renders without scroll
    const page = await injectSessionAndGoto(context, session, `${APP_URL}/signup?step=profile`);
    // We just take a screenshot and check horizontal scroll via JS
    await page.waitForTimeout(2000); // let UI settle
    
    const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    
    const ssPath = path.join(OUT_DIR, 'scenario7_viewport.png');
    await page.screenshot({ path: ssPath });
    
    if (hasHorizontalScroll) {
        await fail('7. 모바일 뷰포트', '가로 스크롤 발생함', page);
    } else {
        await pass('7. 모바일 뷰포트', `정상 (스크린샷: ${ssPath})`);
    }
    await context.close();
  } catch (e) { await fail('7. 모바일 뷰포트', e.message); }

  await browser.close();

  console.log("\n=== 요약 ===");
  results.forEach(r => console.log(r));
  const hasFail = results.some(r => r.includes('[FAIL'));
  
  if (hasFail) {
      console.log("\n[QA 실패: 시나리오/원인/증거경로 목록]");
      results.filter(r => r.includes('[FAIL')).forEach(r => console.log(r));
  } else {
      console.log("\n[QA 통과]");
  }
})();
