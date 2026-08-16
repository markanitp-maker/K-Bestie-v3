const { createClient } = require('@supabase/supabase-js');

async function testScenario6() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
  const DEV_URL = 'https://k-bestie-v3-dev.vercel.app';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const email = `suspend-test-${Date.now()}@kbestie.local`;
  const password = 'password123';
  
  console.log(`Creating user: ${email}`);
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) throw authError;
  const user = authData.user;
  
  const { error: dbError } = await supabase
    .from('parents')
    .upsert({
      id: user.id,
      email,
      name: 'Suspended QA',
      phone_number: '010-0000-0000',
      account_status: 'SUSPENDED'
    });
  if (dbError) throw dbError;
  
  // Login to get token
  const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (loginError) throw loginError;
  
  const session = loginData.session;
  
  // Construct the cookie. 
  // With @supabase/ssr, the base64url encoded JSON array is usually used.
  // Actually, sometimes it's base64 encoded. Let's just pass Authorization header.
  // wait, middleware in Next.js might check Authorization header if we are lucky? Usually not for pages.
  // But let's try passing the chunked cookies:
  
  const cookieValue = JSON.stringify([session.access_token, session.refresh_token, null, null, null]);
  const encodedValue = encodeURIComponent(cookieValue);
  
  // If it's long, it might need chunking, but let's try without chunking first.
  const cookieHeader = `sb-mkrsaaedxqrcrktapaus-auth-token=${encodedValue}`;
  
  console.log('Fetching /parent/dashboard with cookie...');
  const res = await fetch(`${DEV_URL}/parent/dashboard`, {
    redirect: 'manual', // We want to catch the redirect!
    headers: {
      Cookie: cookieHeader
    }
  });
  
  console.log('Status:', res.status);
  console.log('Location:', res.headers.get('location'));
  
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc && loc.includes('/account/suspended')) {
      console.log('PASS');
    } else {
      console.log('FAIL: Redirected to ' + loc);
    }
  } else {
    console.log('FAIL: Did not redirect. Status was ' + res.status);
  }
}

testScenario6().catch(console.error);
