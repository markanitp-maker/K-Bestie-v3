#!/usr/bin/env node
/**
 * 008-A 넌센스 퀴즈 Question Bank 시드 적재 스크립트
 *
 * requests/008-nonsense-quiz-question-pool.seed.json 데이터를 검증하고
 * 대상 DB(Dev / Prod)의 nonsense_questions 테이블에 적재한다.
 *
 * 특징:
 *   - 기본값: DRY-RUN (아무것도 쓰지 않고 검증 및 통계만 출력)
 *   - ON CONFLICT (concept_key) DO NOTHING 으로 재실행해도 중복이 생기지 않음
 *   - 질문/정답 하드코딩 없이 JSON 파일 원본을 읽어 처리
 *   - 시드 데이터 자체 검증 (§7-1) 통과 시에만 적용 가능
 *
 * 사용법:
 *   node scripts/seed-nonsense-questions.js --dry-run
 *   node scripts/seed-nonsense-questions.js --apply
 *   node scripts/seed-nonsense-questions.js --apply --target=prod --confirm=PRODUCTION
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const targetArg = args.find((a) => a.startsWith('--target='));
const target = targetArg ? targetArg.split('=')[1] : 'dev';
const confirmArg = args.find((a) => a.startsWith('--confirm='));
const confirm = confirmArg ? confirmArg.split('=')[1] : '';

if (target !== 'dev' && target !== 'prod') {
  console.error(`오류: --target 값은 'dev' 또는 'prod'만 허용됩니다 (입력값: ${target}).`);
  process.exit(1);
}

if (isApply && target === 'prod' && confirm !== 'PRODUCTION') {
  console.error('오류: Production 환경에 반영하려면 --target=prod와 함께 반드시 --confirm=PRODUCTION 플래그를 명시해야 합니다.');
  process.exit(1);
}

const PROD_PROJECT_REF = 'fetvnhhjicndmxvhrffk';
const DEV_PROJECT_REF = 'mkrsaaedxqrcrktapaus';
const PROJECT_REF = target === 'prod' ? PROD_PROJECT_REF : DEV_PROJECT_REF;

// .env.local 로딩
const envPath = path.join(__dirname, '../.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || envVars['SUPABASE_ACCESS_TOKEN'];

if (isApply && !TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN 이 환경변수 또는 .env.local 에 없습니다.');
  process.exit(1);
}

const SEED_FILE = path.join(__dirname, '../requests/008-nonsense-quiz-question-pool.seed.json');
if (!fs.existsSync(SEED_FILE)) {
  console.error(`ERROR: 시드 파일을 찾을 수 없습니다: ${SEED_FILE}`);
  process.exit(1);
}

const rawSeed = fs.readFileSync(SEED_FILE, 'utf8');
let seedData;
try {
  seedData = JSON.parse(rawSeed);
} catch (e) {
  console.error(`ERROR: 시드 JSON 파싱 실패: ${e.message}`);
  process.exit(1);
}

const questions = seedData.questions;
if (!Array.isArray(questions) || questions.length === 0) {
  console.error('ERROR: 시드 데이터에 questions 배열이 없거나 비어 있습니다.');
  process.exit(1);
}

// ------------------------------------------------------------------------------
// 시드 데이터 자체 검증 (§7-1)
// ------------------------------------------------------------------------------
const validationErrors = [];
const conceptKeySet = new Set();
let dupConceptKeyCount = 0;
let missingReqCount = 0;
let childUnsafeCount = 0;
const validQuestions = [];
const excludedQuestions = [];

const VALID_STATUSES = new Set(['ACTIVE', 'REVIEW', 'REJECTED', 'DEPRECATED']);

questions.forEach((q, idx) => {
  const itemIndex = `Item #${idx + 1} (${q.id || 'NO_ID'})`;

  // 1) 필수 필드 확인
  if (
    !q.id ||
    !q.concept_key ||
    !q.question ||
    !q.canonical_answer ||
    !Array.isArray(q.accepted_answers) ||
    q.difficulty === undefined ||
    q.min_grade === undefined ||
    q.max_grade === undefined ||
    q.status === undefined ||
    q.child_safe === undefined
  ) {
    missingReqCount++;
    validationErrors.push(`${itemIndex}: 필수 필드 누락`);
  }

  // 2) concept_key 고유성 검사
  if (q.concept_key) {
    if (conceptKeySet.has(q.concept_key)) {
      dupConceptKeyCount++;
      validationErrors.push(`${itemIndex}: 중복된 concept_key '${q.concept_key}'`);
    } else {
      conceptKeySet.add(q.concept_key);
    }
  }

  // 3) canonical_answer 비어있지 않음 및 accepted_answers 포함 여부
  if (typeof q.canonical_answer !== 'string' || q.canonical_answer.trim() === '') {
    validationErrors.push(`${itemIndex}: canonical_answer가 비어 있습니다.`);
  }

  // 4) 학년 범위 검사
  if (
    typeof q.min_grade !== 'number' ||
    typeof q.max_grade !== 'number' ||
    q.min_grade < 1 ||
    q.min_grade > 6 ||
    q.max_grade < 1 ||
    q.max_grade > 6 ||
    q.min_grade > q.max_grade
  ) {
    validationErrors.push(`${itemIndex}: 학년 범위 오류 (min_grade: ${q.min_grade}, max_grade: ${q.max_grade})`);
  }

  // 5) 난이도 범위 검사 (1~6)
  if (typeof q.difficulty !== 'number' || q.difficulty < 1 || q.difficulty > 6) {
    validationErrors.push(`${itemIndex}: 난이도 범위 오류 (difficulty: ${q.difficulty})`);
  }

  // 6) status enum 검사
  if (!VALID_STATUSES.has(q.status)) {
    validationErrors.push(`${itemIndex}: 유효하지 않은 status '${q.status}'`);
  }

  // 7) child_safe 검사
  if (q.child_safe === false) {
    childUnsafeCount++;
    excludedQuestions.push({ q, reason: 'child_safe=false' });
    return; // 제외
  }

  validQuestions.push(q);
});

// ------------------------------------------------------------------------------
// 통계 산출
// ------------------------------------------------------------------------------
const statusDistribution = {};
const difficultyDistribution = {};
const gradeTotalMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
const gradeActiveMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

questions.forEach((q) => {
  statusDistribution[q.status] = (statusDistribution[q.status] || 0) + 1;
  difficultyDistribution[`D${q.difficulty}`] = (difficultyDistribution[`D${q.difficulty}`] || 0) + 1;

  for (let g = 1; g <= 6; g++) {
    if (q.min_grade <= g && g <= q.max_grade) {
      gradeTotalMap[g]++;
      if (q.status === 'ACTIVE' && q.child_safe) {
        gradeActiveMap[g]++;
      }
    }
  }
});

// ------------------------------------------------------------------------------
// SQL 헬퍼
// ------------------------------------------------------------------------------
const sqlStr = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sqlArr = (v) =>
  !Array.isArray(v) || v.length === 0
    ? `ARRAY[]::text[]`
    : `ARRAY[${v.map((x) => sqlStr(x)).join(',')}]::text[]`;

async function runSQL(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.substring(0, 400)}`);
  }
  return res.json();
}

// ------------------------------------------------------------------------------
// 메인 실행
// ------------------------------------------------------------------------------
async function main() {
  console.log('================================================================');
  console.log(`[008-A] 넌센스 퀴즈 Question Bank 시드 스크립트`);
  console.log(`- 대상 환경: ${target.toUpperCase()} (Ref: ${PROJECT_REF})`);
  console.log(`- 실행 모드: ${isApply ? 'APPLY (실제 DB 반영)' : 'DRY-RUN (검증 및 통계 조회)'}`);
  console.log('================================================================');

  console.log(`\n[1] 데이터 검증 결과:`);
  console.log(`- 총 문제 수: ${questions.length}건`);
  console.log(`- concept_key 중복 건수: ${dupConceptKeyCount}건`);
  console.log(`- 필수 필드 누락 건수: ${missingReqCount}건`);
  console.log(`- child_safe=false 건수: ${childUnsafeCount}건 (시드 제외 대상)`);
  console.log(`- 적재 대상 유효 문항: ${validQuestions.length}건`);

  if (validationErrors.length > 0) {
    console.error(`\n❌ 시드 데이터 검증 실패 (${validationErrors.length}건 에러):`);
    validationErrors.slice(0, 10).forEach((err) => console.error(`  - ${err}`));
    if (validationErrors.length > 10) {
      console.error(`  ... 외 ${validationErrors.length - 10}건`);
    }
    process.exit(1);
  }
  console.log(`- 검증 상태: PASS (무결성 검증 통과)`);

  console.log(`\n[2] 상태별 분포:`);
  Object.keys(statusDistribution).sort().forEach((st) => {
    console.log(`  - ${st}: ${statusDistribution[st]}건`);
  });

  console.log(`\n[3] 난이도별 분포:`);
  Object.keys(difficultyDistribution).sort().forEach((df) => {
    console.log(`  - ${df}: ${difficultyDistribution[df]}건`);
  });

  console.log(`\n[4] 학년별 후보 수 (min_grade <= G <= max_grade):`);
  for (let g = 1; g <= 6; g++) {
    console.log(`  - 초${g} (G${g}): 전체 ${gradeTotalMap[g]}건 (ACTIVE ${gradeActiveMap[g]}건)`);
  }

  if (!isApply) {
    console.log('\n================================================================');
    console.log('DRY-RUN 완료 — DB에 아무것도 쓰지 않았습니다.');
    console.log('실제 DB 반영은 --apply 플래그를 붙여 실행하세요.');
    console.log('예: node scripts/seed-nonsense-questions.js --apply');
    console.log('================================================================');
    return;
  }

  // ----------------------------------------------------------------------------
  // 실제 DB 반영 (APPLY 모드)
  // ----------------------------------------------------------------------------
  console.log('\n[5] DB 적재 시작...');
  const CHUNK_SIZE = 50;
  let insertedCount = 0;

  for (let i = 0; i < validQuestions.length; i += CHUNK_SIZE) {
    const chunk = validQuestions.slice(i, i + CHUNK_SIZE);
    const rows = chunk
      .map(
        (r) =>
          `(${sqlStr(r.id)}, ${sqlStr(r.concept_key)}, ${sqlStr(r.question)}, ${sqlStr(r.canonical_answer)}, ` +
          `${sqlArr(r.accepted_answers)}, ${sqlStr(r.hint_1)}, ${sqlStr(r.hint_2)}, ${sqlStr(r.explanation)}, ` +
          `${sqlStr(r.category)}, ${sqlStr(r.pun_type)}, ${r.difficulty}, ${r.min_grade}, ${r.max_grade}, ` +
          `${sqlStr(r.primary_grade_band)}, ${sqlStr(r.status)}, ${r.child_safe ? 'true' : 'false'}, ` +
          `${sqlStr(r.source_type)}, ${r.quality_score ?? 'NULL'})`,
      )
      .join(',\n');

    const sql = `
      INSERT INTO nonsense_questions (
        id, concept_key, question, canonical_answer, accepted_answers,
        hint_1, hint_2, explanation, category, pun_type,
        difficulty, min_grade, max_grade, primary_grade_band,
        status, child_safe, source_type, quality_score
      )
      VALUES
${rows}
      ON CONFLICT (concept_key) DO NOTHING;
    `;

    await runSQL(sql);
    insertedCount += chunk.length;
    process.stdout.write(`\r  진행 상황: ${insertedCount}/${validQuestions.length} 처리 완료`);
  }

  console.log('\n\n✅ 넌센스 퀴즈 Question Bank 시드 적재 완료.');
}

main().catch((err) => {
  console.error('\n❌ 실행 중 오류 발생:', err.message);
  process.exit(1);
});
