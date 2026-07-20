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
const { resolveProjectRef } = require('./lib/resolveTarget');
const PROJECT_REF = resolveProjectRef();

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
  return text ? JSON.parse(text) : [];
}

async function check() {
  const q1 = "SELECT pg_get_functiondef('public.purge_account_family_data'::regproc);";
  const r1 = await runSQL(q1);
  const def1 = r1[0]?.pg_get_functiondef || "";
  console.log("purge_account_family_data contains 'purge_initiated_by':", def1.includes("purge_initiated_by"));

  const q2 = "SELECT pg_get_functiondef('public.create_family_with_owner'::regproc);";
  const r2 = await runSQL(q2);
  const def2 = r2[0]?.pg_get_functiondef || "";
  console.log("create_family_with_owner contains 'unique_violation':", def2.includes("unique_violation"));
}

check().catch(console.error);
