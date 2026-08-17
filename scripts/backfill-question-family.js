#!/usr/bin/env node
process.removeAllListeners('warning');

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
const { resolveProjectRef, getTargetEnv, assertProdConfirmed } = require('./lib/resolveTarget');

if (!TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.');
  process.exit(1);
}

const args = process.argv.slice(2);
const targetEnv = getTargetEnv();
const projectRef = resolveProjectRef();

// 기본값은 dry-run 이어야 한다. --apply 플래그가 명시되었을 때만 실제 DB UPDATE 수행.
const isApply = args.includes('--apply') || args.includes('--execute') || args.includes('--write');
const isDryRun = !isApply || args.includes('--dry-run');

if (!isDryRun && targetEnv === 'prod') {
  assertProdConfirmed();
}

async function runSQL(q) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
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
  return JSON.parse(text);
}

async function main() {
  const { classifyQuestionFamily, QUESTION_FAMILIES } = await import('../lib/mission-v3/questionFamily.ts');

  console.log(`====================================================`);
  console.log(`[078 Phase A] Question Family Backfill Script`);
  console.log(`Target Environment : ${targetEnv.toUpperCase()} (${projectRef})`);
  console.log(`Execution Mode     : ${isDryRun ? 'DRY-RUN (조회 및 시뮬레이션만 수행)' : 'APPLY (실제 DB UPDATE 수행)'}`);
  console.log(`====================================================\n`);

  console.log('1. 질문은행 데이터 조회 중...');
  const rows = await runSQL(`
    SELECT id, question_text, semantic_group, topic
    FROM public.mission_questions
    ORDER BY created_at ASC, id ASC;
  `);

  console.log(`   총 ${rows.length}개 질문 조회 완료.\n`);

  const familyCounts = {};
  for (const fam of QUESTION_FAMILIES) {
    familyCounts[fam] = 0;
  }

  const updates = [];
  const unclassified = [];

  for (const row of rows) {
    const family = classifyQuestionFamily({
      questionText: row.question_text,
      semanticGroup: row.semantic_group,
      topic: row.topic,
    });

    if (family) {
      familyCounts[family] = (familyCounts[family] || 0) + 1;
      updates.push({ id: row.id, family, text: row.question_text });
    } else {
      unclassified.push(row);
    }
  }

  const classifiedCount = updates.length;
  const unclassifiedCount = unclassified.length;

  console.log('2. 분류 요약 통계:');
  console.log(`   - 전체 질문: ${rows.length}건`);
  console.log(`   - 분류 성공: ${classifiedCount}건 (${((classifiedCount / rows.length) * 100).toFixed(1)}%)`);
  console.log(`   - 분류 불가(null): ${unclassifiedCount}건 (${((unclassifiedCount / rows.length) * 100).toFixed(1)}%)\n`);

  console.log('3. Family별 분포:');
  const sortedFamilies = Object.entries(familyCounts).sort((a, b) => b[1] - a[1]);
  for (const [fam, cnt] of sortedFamilies) {
    const bar = '■'.repeat(Math.round(cnt / 5));
    console.log(`   ${fam.padEnd(28)} : ${String(cnt).padStart(3)}건 ${bar}`);
  }
  console.log();

  if (unclassifiedCount > 0) {
    console.log(`4. 분류 불가(null) 샘플 (상위 5건):`);
    unclassified.slice(0, 5).forEach((q, idx) => {
      console.log(`   [${idx + 1}] [${q.semantic_group || 'NO_GROUP'}] ${q.question_text}`);
    });
    console.log();
  }

  if (isDryRun) {
    console.log('※ DRY-RUN 완료: 실제 DB에 변경사항을 적용하지 않았습니다.');
    console.log('  실제 적용 시: node scripts/backfill-question-family.js --apply [--target=dev|prod]');
    return;
  }

  // 실제 UPDATE 수행 (배치 청크 50개 단위)
  console.log(`5. 실제 DB UPDATE 수행 중 (${updates.length}건)...`);
  const chunkSize = 50;
  let updatedCount = 0;

  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const caseStatements = chunk
      .map(item => `WHEN '${item.id}'::uuid THEN '${item.family}'`)
      .join(' ');
    const idList = chunk.map(item => `'${item.id}'::uuid`).join(', ');

    const sql = `
      UPDATE public.mission_questions
      SET question_family = CASE id
        ${caseStatements}
      END
      WHERE id IN (${idList});
    `;

    await runSQL(sql);
    updatedCount += chunk.length;
    process.stdout.write(`\r   진행률: ${updatedCount} / ${updates.length}`);
  }

  console.log(`\n\n✓ 백필 완료: 총 ${updatedCount}건의 question_family 업데이트 완료.`);
}

main().catch(err => {
  console.error('✗ 오류 발생:', err.message);
  process.exit(1);
});
