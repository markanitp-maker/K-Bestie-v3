const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function run() {
  const env = fs.readFileSync('.env.local', 'utf8');
  const getEnv = (key) => {
    const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : null;
  };

  const devUrl = getEnv('NEXT_PUBLIC_SUPABASE_DEV_URL');
  const devKey = getEnv('NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY');
  const devService = getEnv('SUPABASE_DEV_SERVICE_ROLE_KEY');

  const prodUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const prodKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const prodService = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  
  async function testEnv(name, siteUrl, sbUrl, sbKey, sbService, parentEmail, childEmail) {
    console.log(`\n=== Testing ${name} (${siteUrl}) ===`);
    const sbAdmin = createClient(sbUrl, sbService);
    
    // Parent
    const { data: pLink, error: pLinkErr } = await sbAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: parentEmail
    });
    if (pLinkErr) return console.error(`[${name}] Parent generateLink failed:`, pLinkErr.message);

    // Child
    const { data: cLink, error: cLinkErr } = await sbAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: childEmail
    });
    if (cLinkErr) return console.error(`[${name}] Child generateLink failed:`, cLinkErr.message);

    // Follow links to get tokens
    const sb = createClient(sbUrl, sbKey);
    let parentToken = null;
    let childToken = null;
    let childId = null;

    try {
      const pRes = await fetch(pLink.properties.action_link, { redirect: 'manual' });
      const pLoc = pRes.headers.get('location');
      if (pLoc) {
        const hash = pLoc.split('#')[1];
        if (hash) {
          const params = new URLSearchParams(hash);
          parentToken = params.get('access_token');
        }
      }
    } catch(e) { console.error('Error fetching parent link', e); }

    try {
      const cRes = await fetch(cLink.properties.action_link, { redirect: 'manual' });
      const cLoc = cRes.headers.get('location');
      if (cLoc) {
        const hash = cLoc.split('#')[1];
        if (hash) {
          const params = new URLSearchParams(hash);
          childToken = params.get('access_token');
        }
      }
    } catch(e) { console.error('Error fetching child link', e); }

    if (!parentToken || !childToken) {
      console.log(`[${name}] Could not extract tokens from magic links`);
      return;
    }

    const { data: { user } } = await sb.auth.getUser(childToken);
    childId = user.id;

    console.log(`[${name}] Login Success`);

    // 1. Mission LLM Respond (Lean)
    try {
      console.log(`[${name}] Requesting Mission Respond-Lean...`);
      const res = await fetch(`${siteUrl}/api/mission/respond-lean`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${childToken}`
        },
        body: JSON.stringify({
          childId: childId,
          transcriptText: "안녕 케이! 오늘 나 유치원에서 그림 그렸어.",
          k_utterance_text: "안녕! 오늘 유치원에서 뭐 했어?",
          mission_id: "m1",
          mission_step_index: 0
        })
      });
      console.log(`[${name}] Mission Respond-Lean: ${res.status}`);
      if (!res.ok) console.log(await res.text());
    } catch (err) { console.error(err); }

    // 2. Freechat Memory Recall
    try {
      console.log(`[${name}] Requesting Freechat Memory Recall...`);
      const res = await fetch(`${siteUrl}/api/parent/memory/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${childToken}`
        },
        body: JSON.stringify({
          childId: childId,
          query: "아이가 가장 좋아하는 색깔은?"
        })
      });
      console.log(`[${name}] Freechat Memory Query: ${res.status}`);
      if (!res.ok) console.log(await res.text());
    } catch (err) { console.error(err); }

    // 3. Parent-K Chat
    try {
      console.log(`[${name}] Requesting Parent-K Chat...`);
      const res = await fetch(`${siteUrl}/api/parent/k-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${parentToken}`
        },
        body: JSON.stringify({
          childId: childId,
          message: "우리 아이가 요즘 어떤 주제에 관심이 많나요?",
          history: []
        })
      });
      console.log(`[${name}] Parent-K Chat: ${res.status}`);
      if (!res.ok) console.log(await res.text());
    } catch (err) { console.error(err); }
  }

  await testEnv('Dev', 'https://k-bestie-v3-dev.vercel.app', devUrl, devKey, devService, 'testp02@kbestie.local', 'testi02@kbestie.local');
  await testEnv('Prod', 'https://app.k-bestie.com', prodUrl, prodKey, prodService, 'qatest-parent-prod@kbestie.local', 'qatest-child-prod@kbestie.local');
}
run();
