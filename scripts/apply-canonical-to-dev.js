#!/usr/bin/env node
process.removeAllListeners('warning');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// DEV ONLY check: 절대 Production 적용 금지
if (targetEnv !== 'dev' || projectRef !== 'mkrsaaedxqrcrktapaus') {
  console.error('⛔ ERROR: 이 스크립트는 DEV 환경(mkrsaaedxqrcrktapaus)에서만 실행할 수 있습니다.');
  console.error(`현재 타겟: ${targetEnv} (${projectRef})`);
  process.exit(1);
}

const isApply = args.includes('--apply') || args.includes('--execute') || args.includes('--write');
const isDryRun = !isApply || args.includes('--dry-run');

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

function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function escapeSQLString(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function parseGradeBand(gradeBand) {
  if (gradeBand === '초1~2') return [1, 2];
  if (gradeBand === '초3~4') return [3, 4];
  if (gradeBand === '초5~6') return [5, 6];
  return [1, 2, 3, 4, 5, 6];
}

async function main() {
  const { classifyQuestionFamily } = await import('../lib/mission-v3/questionFamily.ts');

  console.log('====================================================');
  console.log('078 Canonicalization & DEV DB Apply');
  console.log(`Target Environment : DEV (${projectRef})`);
  console.log(`Mode               : ${isDryRun ? 'DRY-RUN' : 'APPLY (실제 DB 반영)'}`);
  console.log('====================================================\n');

  const ssotPath = path.join(__dirname, '../docs/reviews/_ssot-846.json');
  const csvPath = path.join(__dirname, '../docs/reviews/mission-question-bank-v2-draft-review-v3.csv');

  const ssot = JSON.parse(fs.readFileSync(ssotPath, 'utf8'));
  const ssotMap = new Map(ssot.map(r => [r.id, r]));
  const csvRows = parseCSV(fs.readFileSync(csvPath, 'utf8'));

  console.log(`1. SSOT 846 데이터 및 CSV 240행 로드 완료.`);

  // Resolutions for known collisions
  const RESOLUTIONS = {
    'c4415254-da55-4b66-8dbe-b877774f3e92': 'WISH_NOW_IMMEDIATE',
    'e3df1283-a841-cb53-f652-079f54c95d3f': 'FAVORITE_MEDIA_RECENT',
    '1b607c42-5856-faa1-74ce-89c6ef159094': 'HUNGER_NOW_CHECK',
    '6e330beb-1bb3-f14f-f2e2-97923c3ce292': 'PLAY_FUN_TODAY',
  };

  // Build canonical map for REUSE QIDs
  const qidToCanonical = new Map();

  for (const row of csvRows) {
    if (row.status === 'REUSE_EXISTING') {
      const rawIds = (row.existing_similar_question_ids || '')
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);

      for (const rawId of rawIds) {
        let qid = rawId;
        if (qid.length < 36) {
          const matched = ssot.filter(s => s.id.startsWith(qid));
          if (matched.length === 1) qid = matched[0].id;
        }

        if (!ssotMap.has(qid)) continue;

        if (!qidToCanonical.has(qid)) {
          const ssotItem = ssotMap.get(qid);
          qidToCanonical.set(qid, {
            id: qid,
            family: row.proposed_question_family,
            schoolContext: row.school_context_required,
            weekdays: new Set(ssotItem.weekday_affinity || []),
            rapportWeight: row.rapport_weight ? parseInt(row.rapport_weight, 10) : 1,
            timeOfDay: row.time_of_day || 'any',
          });
        }

        const entry = qidToCanonical.get(qid);
        if (RESOLUTIONS[qid]) {
          entry.family = RESOLUTIONS[qid];
        } else {
          entry.family = row.proposed_question_family;
        }
        entry.schoolContext = row.school_context_required;
        row.weekday_affinity.split(',').map(w => w.trim()).filter(Boolean).forEach(w => {
          entry.weekdays.add(w);
        });
      }
    }
  }

  console.log(`2. REUSE 대상 canonical 메타데이터 산출 완료 (${qidToCanonical.size}개 QID).`);

  // Build SQL statements
  const statements = [];

  // A. Update REUSE QIDs with canonical metadata
  for (const [qid, entry] of qidToCanonical.entries()) {
    const weekdayArraySQL = `ARRAY[${Array.from(entry.weekdays).map(w => `'${w}'`).join(', ')}]::text[]`;
    const famSQL = escapeSQLString(entry.family);
    const schoolSQL = escapeSQLString(entry.schoolContext);
    const timeSQL = escapeSQLString(entry.timeOfDay);
    const rapportSQL = entry.rapportWeight;

    statements.push(`
      UPDATE public.mission_questions
      SET
        question_family = ${famSQL},
        school_context_tag = ${schoolSQL},
        weekday_affinity = ${weekdayArraySQL},
        time_of_day = ${timeSQL},
        rapport_weight = ${rapportSQL}
      WHERE id = '${qid}';
    `);
  }

  // B. For all other 846 SSOT questions without family yet, backfill via classifier
  let classifiedCount = 0;
  for (const s of ssot) {
    if (!qidToCanonical.has(s.id)) {
      const family = classifyQuestionFamily({
        questionText: s.question_text,
        semanticGroup: s.semantic_group,
        topic: s.topic,
      });
      if (family) {
        classifiedCount++;
        statements.push(`
          UPDATE public.mission_questions
          SET question_family = ${escapeSQLString(family)}
          WHERE id = '${s.id}' AND question_family IS NULL;
        `);
      }
    }
  }

  console.log(`3. 미분류 SSOT 질문 ${classifiedCount}건 rule-based classifier 패밀리 배정 완료.`);

  // C. Insert/Upsert NEW_QUESTION rows (123건)
  const newQuestions = csvRows.filter(r => r.status === 'NEW_QUESTION');
  console.log(`4. NEW_QUESTION ${newQuestions.length}건 준비 중...`);

  let newInserted = 0;
  for (const row of newQuestions) {
    // Generate deterministic UUID for each new question based on text and grade
    const hash = crypto.createHash('md5').update(`v3-new-${row.grade_band}-${row.question_text}`).digest('hex');
    const newId = `${hash.substring(0,8)}-${hash.substring(8,12)}-4${hash.substring(13,16)}-a${hash.substring(17,20)}-${hash.substring(20,32)}`;
    const grades = parseGradeBand(row.grade_band);
    const weekdays = row.weekday_affinity.split(',').map(w => w.trim()).filter(Boolean);
    const weekdayArraySQL = `ARRAY[${weekdays.map(w => `'${w}'`).join(', ')}]::text[]`;
    const gradesArraySQL = `ARRAY[${grades.join(', ')}]::integer[]`;
    const cooldownDays = row.recommended_cooldown_days ? parseInt(row.recommended_cooldown_days, 10) : 5;
    const rapportWeight = row.rapport_weight ? parseInt(row.rapport_weight, 10) : 1;
    const timeOfDay = row.time_of_day || 'any';

    statements.push(`
      INSERT INTO public.mission_questions (
        id,
        question_text,
        applicable_grades,
        semantic_group,
        cooldown_days,
        weekday_affinity,
        topic,
        conversation_style,
        fun_type,
        memory_usable,
        sensitivity,
        answer_mode,
        periodicity,
        clinical_status,
        is_active,
        school_context_tag,
        question_family,
        rapport_weight,
        time_of_day,
        cycle_type,
        dashboard_area_tag,
        round_type,
        question_bank_version,
        created_at
      ) VALUES (
        '${newId}',
        ${escapeSQLString(row.question_text)},
        ${gradesArraySQL},
        ${escapeSQLString(row.semantic_group)},
        ${cooldownDays},
        ${weekdayArraySQL},
        ${escapeSQLString(row.semantic_group.toLowerCase())},
        'reflective',
        'none',
        false,
        'low',
        'open',
        'flexible',
        'APPROVED',
        true,
        ${escapeSQLString(row.school_context_required)},
        ${escapeSQLString(row.proposed_question_family)},
        ${rapportWeight},
        ${escapeSQLString(timeOfDay)},
        'always',
        'daily_general',
        'round2_night',
        'v3.0',
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        question_text = EXCLUDED.question_text,
        applicable_grades = EXCLUDED.applicable_grades,
        semantic_group = EXCLUDED.semantic_group,
        cooldown_days = EXCLUDED.cooldown_days,
        weekday_affinity = EXCLUDED.weekday_affinity,
        school_context_tag = EXCLUDED.school_context_tag,
        question_family = EXCLUDED.question_family,
        rapport_weight = EXCLUDED.rapport_weight,
        time_of_day = EXCLUDED.time_of_day,
        cycle_type = EXCLUDED.cycle_type,
        dashboard_area_tag = EXCLUDED.dashboard_area_tag,
        round_type = EXCLUDED.round_type,
        question_bank_version = EXCLUDED.question_bank_version,
        is_active = true,
        clinical_status = 'APPROVED';
    `);
    newInserted++;
  }

  console.log(`   총 ${statements.length}개 SQL문 생성 완료 (REUSE 갱신: ${qidToCanonical.size}, classifier: ${classifiedCount}, NEW 삽입: ${newInserted}).\n`);

  if (isDryRun) {
    console.log('DRY-RUN 완료. 실제 반영을 하려면 --apply 플래그를 붙여 실행하세요.');
    return;
  }

  console.log('5. DEV DB에 SQL 실행 중...');
  // Execute in batches of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE).join('\n');
    await runSQL(batch);
    process.stdout.write(`   진행률: ${Math.min(i + BATCH_SIZE, statements.length)} / ${statements.length}\r`);
  }
  console.log(`\n   ✅ DEV DB 반영 성공 완료!\n`);

  // Verify DEV DB
  const verifyRes = await runSQL(`
    SELECT
      count(*) as total,
      count(question_family) as with_family,
      count(*) filter (where school_context_tag = 'TRUE') as school_true,
      count(*) filter (where school_context_tag = 'FALSE') as school_false
    FROM public.mission_questions
    WHERE is_active = true AND clinical_status = 'APPROVED';
  `);
  console.log('6. DEV DB 최종 통계:', verifyRes[0]);
}

main().catch(err => {
  console.error('❌ Execution error:', err);
  process.exit(1);
});
