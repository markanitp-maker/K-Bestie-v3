import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const accessToken = env.SUPABASE_ACCESS_TOKEN;
const projectRef = 'fetvnhhjicndmxvhrffk';
const newSecret = fs
  .readFileSync('/tmp/claude-1000/-mnt-e-VibeCoding-K-Bestie-v3/e4f156d0-1105-45e0-bdff-b0d79efa331d/scratchpad/new-batch-secret.txt', 'utf8')
  .trim();

async function q(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

// 1. Update vault secret to new value
console.log('update vault secret:', JSON.stringify(await q(`
  select vault.update_secret(
    (select id from vault.secrets where name = 'pipeline_worker_secret'),
    new_secret := '${newSecret}'
  );
`)));

// 2. List all v3-* / kbestie-prod-* cron jobs that hardcode the OLD secret, then rewrite
//    each job's command to use the NEW value, preserving everything else byte-for-byte
//    (only the Bearer token changes).
const jobsRes = await q(`
  select jobid, jobname, command
  from cron.job
  where command LIKE '%Bearer%' AND (jobname LIKE 'v3-%' OR jobname LIKE 'kbestie-prod-%' OR jobname = 'kbestie-account-purge');
`);
console.log('jobs to update:', JSON.stringify(jobsRes.map((j) => ({ jobid: j.jobid, jobname: j.jobname }))));

for (const job of jobsRes) {
  const oldCommand = job.command;
  const newCommand = oldCommand.replace(/Bearer [a-f0-9]+/g, `Bearer ${newSecret}`);
  if (newCommand === oldCommand) {
    console.log(`SKIP ${job.jobname}: no Bearer token pattern matched (maybe already vault-based)`);
    continue;
  }
  const escaped = newCommand.replace(/'/g, "''");
  const alterRes = await q(`SELECT cron.alter_job(job_id := ${job.jobid}, command := '${escaped}');`);
  console.log(`updated ${job.jobname} (jobid ${job.jobid}):`, JSON.stringify(alterRes));
}

console.log('DONE. Final job count with old-pattern check:', JSON.stringify(await q(`
  select count(*) from cron.job where command LIKE '%Bearer%';
`)));
