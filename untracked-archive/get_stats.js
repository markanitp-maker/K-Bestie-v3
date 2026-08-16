const fs = require('fs');
const envVars = {};
fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});
const TOKEN = envVars['SUPABASE_ACCESS_TOKEN'];
const { resolveProjectRef } = require('./scripts/lib/resolveTarget');
const ref = resolveProjectRef();
fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "SELECT school_context_tag, COUNT(*) FROM mission_questions GROUP BY school_context_tag;" })
}).then(r => r.json()).then(d => console.log(d));
