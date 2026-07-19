#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const TOKEN = envVars['SUPABASE_ACCESS_TOKEN'];
// apply-migration.js를 참고한 PROJECT_REF 하드코딩 + 동적 파싱 fallback
const PROJECT_REF = envVars['NEXT_PUBLIC_SUPABASE_URL'] 
  ? envVars['NEXT_PUBLIC_SUPABASE_URL'].match(/https:\/\/(.+)\.supabase\.co/)?.[1]
  : 'fetvnhhjicndmxvhrffk';

const child1 = envVars['ALPHA_SAFETY_CHILD_ID_1'];
const child2 = envVars['ALPHA_SAFETY_CHILD_ID_2'];
const adminId = envVars['ALPHA_SAFETY_ADMIN_ID'];

if (!child1 || !child2 || !adminId) {
  console.error('ERROR: ALPHA_SAFETY_CHILD_ID_1, ALPHA_SAFETY_CHILD_ID_2, or ALPHA_SAFETY_ADMIN_ID is missing in .env.local.');
  process.exit(1);
}

if (!TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.');
  process.exit(1);
}

if (!PROJECT_REF) {
  console.error('ERROR: Could not determine PROJECT_REF.');
  process.exit(1);
}

console.log(`=========================================`);
console.log(`Alpha Safety Allowlist Seeding`);
console.log(`Project: ${PROJECT_REF}`);
console.log(`=========================================`);

const query = `
  INSERT INTO public.alpha_safety_text_allowlist (child_id, admin_user_id, env)
  VALUES 
    ('${child1}', '${adminId}', 'alpha'),
    ('${child2}', '${adminId}', 'alpha')
  ON CONFLICT DO NOTHING;
`;

async function runSQL(q) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: q }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : { success: true };
}

runSQL(query)
  .then(data => {
    console.log('Alpha safety allowlist seeded successfully.');
  })
  .catch(err => {
    console.error('✗ 오류:', err.message);
    process.exit(1);
  });
