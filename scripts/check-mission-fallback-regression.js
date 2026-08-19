#!/usr/bin/env node
// 요청서 019 §7-9 — 미션 폴백 문구 재발 감시 (READ-ONLY).
//
// 아이가 정상 답변한 뒤 "더 얘기해줄래?/계속 말해줘" 계열 문장이 나갔는지 센다.
// PASS 기준은 0건이다. 쓰기는 하지 않는다.
//
// 사용:
//   node scripts/check-mission-fallback-regression.js --target=prod --days=1
//   node scripts/check-mission-fallback-regression.js --target=dev

const { execFileSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith('--days='));
const days = daysArg ? Number(daysArg.split('=')[1]) : 1;
if (!Number.isFinite(days) || days <= 0 || days > 30) {
  console.error('오류: --days 는 1~30 사이여야 합니다.');
  process.exit(1);
}

const sql = `
select
  date_trunc('hour', created_at) as hour_kst_utc,
  count(*) as fallback_messages
from chat_messages
where role = 'k'
  and deleted_at is null
  and created_at > now() - interval '${days} days'
  and (
    content like '%더 얘기해줄래%'
    or content like '%더 이야기해줄래%'
    or content like '%계속 말해줘%'
    or content like '%계속 얘기해줘%'
    or content like '%더 말해줘%'
  )
group by 1
order by 1 desc
`.trim();

const output = execFileSync(
  process.execPath,
  [path.join(__dirname, 'run-query.js'), sql, ...args.filter((a) => a.startsWith('--target=') || a.startsWith('--confirm='))],
  { encoding: 'utf8' },
);
const rows = JSON.parse(output.slice(output.indexOf('[')));
const total = rows.reduce((sum, row) => sum + Number(row.fallback_messages), 0);

console.log(output.trim());
console.log(`\n최근 ${days}일 폴백 문구 총 ${total}건 — ${total === 0 ? 'PASS' : 'FAIL (재발)'}`);
process.exit(total === 0 ? 0 : 1);
