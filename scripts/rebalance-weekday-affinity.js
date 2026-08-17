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

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * 질문의 성격과 표현으로부터 weekday_affinity를 유도한다 (§16.1 재배분)
 *
 * 원칙:
 * - 요일 태그는 "이 질문이 그 요일에 특히 어울리는가"를 뜻함.
 * - 요일 색이 없는 일반 질문(감정·성취·취향·친구갈등 등)은 요일 태그를 비움(빈 배열 []).
 * - 선택 엔진의 fallback이 작동하므로 억지로 붙이지 않음.
 */
function deriveWeekdayAffinity(r) {
  const text = (r.question_text || '').trim();
  const sg = (r.semantic_group || '').trim().toUpperCase();

  // 1. 특정 요일 직접 명시 질문
  if (/월요일/.test(text) && !/내일 월요일/.test(text)) return ['mon'];
  if (/화요일/.test(text)) return ['tue'];
  if (/수요일/.test(text)) return ['wed'];
  if (/목요일/.test(text)) return ['thu'];
  if (/금요일/.test(text) && !/내일 금요일/.test(text)) return ['fri'];
  if (/토요일/.test(text) && !/내일 토요일/.test(text)) return ['sat'];
  if (/일요일/.test(text)) return ['sun'];

  // 2. 내일/다음 요일 맥락
  if (/내일 월요일/.test(text)) return ['sun'];
  if (/내일 금요일/.test(text)) return ['thu'];
  if (/내일 토요일/.test(text)) return ['fri'];

  // 3. 주말 기대 / 주말 계획 (금·토)
  if (
    /(주말|이번 주말|다음 주말|쉬는 날).*(계획|하고 싶|가고 싶|어디 가|보내고 싶|할 거야|뭐 할|뭐 하고|기다려|기대)/.test(text) &&
    !/(재밌었던|재미있었던|좋았던|기억에 남|생각나는|생각난|했던 것 중|했던 일 중|아쉬웠던)/.test(text)
  ) {
    return ['fri', 'sat'];
  }

  // 4. 주간 회고 / 다음 주 기대 (일요일 / 토·일)
  // 4-A. 일요일 전용: 주간 총결산 회고 및 다음 주 기대
  if (
    /이번 주 통틀어 제일 좋았던/.test(text) ||
    /이번 주에 제일 좋았던/.test(text) ||
    /이번 주에 가장 기억나는/.test(text) ||
    /이번 주 마음은 맑음/.test(text) ||
    /이번 주 마음을 한 단어로/.test(text) ||
    /(다음 주|다음주의|다음 주에).*(기대|기다려|해보고 싶|하고 싶|응원|말을 해주고|새로 해보고|새로운)/.test(text)
  ) {
    return ['sun'];
  }

  // 4-B. 주말 회고 / 주말에 있었던 일 (토·일)
  if (
    /(이번 주|한 주|주말 동안|주말 통틀어).*(재밌었던|재미있었던|좋았던|기억에 남|생각나는|생각난|했던 것 중|했던 일 중|아쉬웠던|어땠어|마음에 남는|기억나는|다시 해보고|신나게 움직였|힘들거나|어려웠던|불편했던|불공평하거나|억울했던|억울하다고|다시 생각)/.test(text) ||
    /주말에 했던 (일|것)/.test(text)
  ) {
    return ['sat', 'sun'];
  }

  // 5. 주말 생활: 외출 / 나들이 / 산책 / 가족 주말 활동 (토·일)
  if (
    /(밖에|밖에서|어디 다녀|다녀온|나갔다|나들이|외출|산책|어디 놀러|놀이공원)/.test(text) ||
    /이번 주 가족과 (제일 재미있었던|함께한 시간|좋았던)/.test(text) ||
    /가족과 함께한 시간 중 좋았던/.test(text)
  ) {
    return ['sat', 'sun'];
  }

  // 6. 금요일: 주간 성취 / 한 주 마무리 / 오늘 끝까지 해낸 성취 & 칭찬
  if (
    /(이번 주에 (끝까지 해낸|네가 제일 잘했다고|네가 가장 잘했다고|네가 제일 잘한|네가 제일 뿌듯했던|새로 배운 것|학교에서 제일 기억에 남는|스스로 해낸))/.test(text) ||
    /(오늘 (끝까지 해낸|끝까지 해본|스스로에게 잘했다고|스스로 잘했다고|네 장점이 도움이 된|누군가에게 칭찬받은|네가 잘했다고 생각하는|네가 가장 잘했다고 생각하는|스스로 뿌듯했던|칭찬 한마디를 해준다면))/.test(text) ||
    /(오늘 다시 해보고 싶은 (수업|활동)|학교생활에서 제일 괜찮)/.test(text)
  ) {
    return ['fri'];
  }

  // 7. 학원 / 방과후 (화·목 중심)
  if (
    /(학원|방과후|학습지)/.test(text) ||
    (sg === 'LEARNING_AND_STUDY' && /(학원|공부|숙제|배우|양은 괜찮았어)/.test(text))
  ) {
    return ['tue', 'thu'];
  }

  // 8. 수요일: 학교 급식 / 점심시간 / 쉬는 시간 / 주중 친구 놀이 / 수요일 여가
  if (
    sg === 'MEAL_AND_TASTE' ||
    /(급식|점심시간|쉬는 시간|쉬는 시간에는|오늘 밥 뭐 먹었|맛있었던|맛있었어|저녁 맛있|먹은 것 중에|점심\(또는 저녁\)|만들기나 색칠|그림 그렸어|책에서 재미있는 그림|재미있는 그림을 봤어|혼자 쉬는 시간|친구랑 같이 해서 재미있었던|친구랑 같이해서 재미있었던|친구들에게 고마웠던|친구에게 고마웠던|친구들 사이에서 유행하는|공부를 마친 뒤 제일 하고 싶었던)/.test(text)
  ) {
    return ['wed'];
  }

  // 9. 목요일: 학교 수업 발표 / 집중 / 숙제 / 과제 / 생각 변화
  if (
    /(발표|앞에 나간|앞에 나가|집중이 잘됐|집중했던|준비물|과제|숙제|의견을 말한|생각이 바뀐|생각을 바꾸게|헷갈렸던 수업|어렵게 느껴진 수업|어려웠던 수업|별로라고 느낀 수업|수업에서 조금 어려웠던|공부하다가 막힌)/.test(text)
  ) {
    return ['thu'];
  }

  // 10. 화요일: 학교 선생님과의 대화/도움 / 수업 흥미
  if (
    sg === 'TEACHER_RELATIONSHIP' ||
    /(선생님|선생님이|선생님한테|선생님에게|선생님께|수업 중에 흥미|재미있었던 수업|수업 중에 제일 재미|수업에서 제일|선생님이 도와준|선생님이 칭찬|선생님에게 도움|선생님이나 어른에게 도움|선생님이나 어른이 해준)/.test(text)
  ) {
    return ['tue'];
  }

  // 11. 월요일: 등교 / 한 주 시작 / 새 배움 / 학교 첫인상 / 학교 일상
  if (
    /(등교|시간표|새로 배운|새롭게 알게 된|처음 한 일|교실에 들어갔을 때|학교가 처음보다|학교생활이 처음보다|학교에서 오늘 무슨 일|학교\(또는 유치원\)에서 오늘 재밌었던|학교에 갈 때|숫자나 글자|학교가 재미있었어|학교에서 제일 재미있었던|학교에서 제일 기억나는 곳|학교에서 하기 싫었던|학교에서 무서웠던|수업할 때 조용했어|오늘 학교에서 있었던 일|오늘 학교에서 웃|학교에서 제일 먼저 떠오르는)/.test(text) ||
    (sg === 'SCHOOL_EXPERIENCE' && /(기억나는 곳|무슨 일|재밌었던|어땠어|기분이 어땠어|처음 한|알게 된|학교|수업)/.test(text))
  ) {
    return ['mon'];
  }

  // 12. 요일 색 없는 일반 질문(감정·성취·취향·가족·미래·친구갈등 등)은 태그 비움(빈 배열)
  return [];
}

function getGradeBuckets(grades) {
  if (!grades || !Array.isArray(grades)) return ['g1_2', 'g3_4', 'g5_6'];
  const buckets = [];
  if (grades.some(g => g === 1 || g === 2 || g === '1' || g === '2')) buckets.push('g1_2');
  if (grades.some(g => g === 3 || g === 4 || g === '3' || g === '4')) buckets.push('g3_4');
  if (grades.some(g => g === 5 || g === 6 || g === '5' || g === '6')) buckets.push('g5_6');
  return buckets.length > 0 ? buckets : ['g1_2', 'g3_4', 'g5_6'];
}

async function main() {
  console.log(`====================================================`);
  console.log(`[078 Phase A] Weekday Affinity Rebalance Script (§16.1)`);
  console.log(`Target Environment : ${targetEnv.toUpperCase()} (${projectRef})`);
  console.log(`Execution Mode     : ${isDryRun ? 'DRY-RUN (조회 및 시뮬레이션만 수행)' : 'APPLY (실제 DB UPDATE 수행)'}`);
  console.log(`====================================================\n`);

  console.log('1. 질문은행 데이터 조회 중...');
  const rows = await runSQL(`
    SELECT id, question_text, semantic_group, topic, applicable_grades, weekday_affinity
    FROM public.mission_questions
    ORDER BY created_at ASC, id ASC;
  `);
  console.log(`   총 ${rows.length}개 질문 조회 완료.\n`);

  // 2. 롤백을 위한 원본 덤프 파일 저장
  const backupDir = path.join(__dirname, '../backup');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `weekday_affinity_backup_${targetEnv}_${timestamp}.json`;
  const backupFilePath = path.join(backupDir, backupFileName);

  const backupData = rows.map(r => ({
    id: r.id,
    question_text: r.question_text,
    applicable_grades: r.applicable_grades,
    weekday_affinity: r.weekday_affinity,
  }));
  fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`2. 원본 데이터 덤프 완료:`);
  console.log(`   - 백업 경로: ${backupFilePath} (${rows.length}건)\n`);

  // 3. 재배분 계산 및 통계 집계
  const beforeStats = {
    '전체 (all)': { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    '초1~2 (g1_2)': { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    '초3~4 (g3_4)': { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    '초5~6 (g5_6)': { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
  };

  const afterStats = {
    '전체 (all)': { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    '초1~2 (g1_2)': { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    '초3~4 (g3_4)': { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    '초5~6 (g5_6)': { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
  };

  const updates = [];

  for (const row of rows) {
    const buckets = getGradeBuckets(row.applicable_grades);

    // before
    const affBefore = Array.isArray(row.weekday_affinity) ? row.weekday_affinity : [];
    affBefore.forEach(d => {
      if (beforeStats['전체 (all)'][d] !== undefined) beforeStats['전체 (all)'][d]++;
      buckets.forEach(b => {
        const key = b === 'g1_2' ? '초1~2 (g1_2)' : b === 'g3_4' ? '초3~4 (g3_4)' : '초5~6 (g5_6)';
        if (beforeStats[key][d] !== undefined) beforeStats[key][d]++;
      });
    });

    // after
    const affAfter = deriveWeekdayAffinity(row);
    affAfter.forEach(d => {
      if (afterStats['전체 (all)'][d] !== undefined) afterStats['전체 (all)'][d]++;
      buckets.forEach(b => {
        const key = b === 'g1_2' ? '초1~2 (g1_2)' : b === 'g3_4' ? '초3~4 (g3_4)' : '초5~6 (g5_6)';
        if (afterStats[key][d] !== undefined) afterStats[key][d]++;
      });
    });

    updates.push({
      id: row.id,
      weekday_affinity: affAfter,
    });
  }

  const totalQuestions = rows.length;
  const untaggedBefore = rows.filter(r => !Array.isArray(r.weekday_affinity) || r.weekday_affinity.length === 0).length;
  const untaggedAfter = updates.filter(u => u.weekday_affinity.length === 0).length;

  console.log('3. 재배분 전 요일별 후보 수 및 비율:');
  console.table(beforeStats);
  const beforeRatios = ALL_DAYS.map(d => `${d}: ${beforeStats['전체 (all)'][d]}건 (${((beforeStats['전체 (all)'][d] / totalQuestions) * 100).toFixed(1)}%)`).join(' | ');
  console.log(`   [전체 비율] ${beforeRatios}`);
  console.log(`   [태그 없음] ${untaggedBefore}건 (${((untaggedBefore / totalQuestions) * 100).toFixed(1)}%)\n`);

  console.log('4. 재배분 후 요일별 후보 수 및 비율:');
  console.table(afterStats);
  const afterRatios = ALL_DAYS.map(d => `${d}: ${afterStats['전체 (all)'][d]}건 (${((afterStats['전체 (all)'][d] / totalQuestions) * 100).toFixed(1)}%)`).join(' | ');
  console.log(`   [전체 비율] ${afterRatios}`);
  console.log(`   [태그 없음] ${untaggedAfter}건 (${((untaggedAfter / totalQuestions) * 100).toFixed(1)}%)\n`);

  // 40% 초과 요일 검증
  console.log('5. 요일별 40% 상한 검증 (최대 40% 이하):');
  let over40Found = false;
  for (const day of ALL_DAYS) {
    const ratio = (afterStats['전체 (all)'][day] / totalQuestions) * 100;
    if (ratio > 40) {
      console.error(`   [경고] ${day}요일 비율이 ${ratio.toFixed(1)}%로 40%를 초과합니다!`);
      over40Found = true;
    }
  }
  if (!over40Found) {
    console.log('   ✓ 모든 요일이 전체의 40% 이하로 균형 유지 확인 완료\n');
  }

  // 10개 미달 검증
  console.log('6. 최소 후보 수 검증 (학년군×요일 10~40개 기준):');
  const underfillList = [];
  for (const [groupName, stats] of Object.entries(afterStats)) {
    if (groupName === '전체 (all)') continue;
    for (const [day, count] of Object.entries(stats)) {
      if (count < 10) {
        console.warn(`   [알림] ${groupName} ${day}요일 후보 수가 ${count}개로 10개 미만입니다.`);
        underfillList.push(`${groupName} ${day}요일 (${count}개)`);
      }
    }
  }
  if (underfillList.length === 0) {
    console.log('   ✓ 모든 학년군×요일 조합에서 최소 10개 이상 후보 확보 완료');
  } else {
    console.log(`   ! 10개 미만 조합: ${underfillList.join(', ')}`);
  }
  console.log();

  if (isDryRun) {
    console.log('※ DRY-RUN 완료: 실제 DB에 변경사항을 적용하지 않았습니다.');
    console.log('  실제 적용 시: node scripts/rebalance-weekday-affinity.js --apply [--target=dev|prod]');
    return;
  }

  // 실제 UPDATE 수행 (배치 청크 50개 단위, 오직 weekday_affinity만 UPDATE)
  console.log(`6. 실제 DB UPDATE 수행 중 (${updates.length}건)...`);
  const chunkSize = 50;
  let updatedCount = 0;

  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const caseStatements = chunk
      .map(item => {
        const arrLiteral = `ARRAY[${item.weekday_affinity.map(d => `'${d}'`).join(',')}]::text[]`;
        return `WHEN '${item.id}'::uuid THEN ${arrLiteral}`;
      })
      .join(' ');
    const idList = chunk.map(item => `'${item.id}'::uuid`).join(', ');

    const sql = `
      UPDATE public.mission_questions
      SET weekday_affinity = CASE id
        ${caseStatements}
      END
      WHERE id IN (${idList});
    `;

    await runSQL(sql);
    updatedCount += chunk.length;
    process.stdout.write(`\r   진행률: ${updatedCount} / ${updates.length}`);
  }

  console.log(`\n\n✓ 재배분 완료: 총 ${updatedCount}건의 weekday_affinity 업데이트 완료.`);
}

main().catch(err => {
  console.error('✗ 오류 발생:', err.message);
  process.exit(1);
});
