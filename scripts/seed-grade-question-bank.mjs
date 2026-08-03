#!/usr/bin/env node
// requests/065~070 — 학년별 미션 질문지(140문항×6학년=840문항) 등록 파서·생성기.
//
// 사용법:
//   node scripts/seed-grade-question-bank.mjs <requests/0XX-....md> <grade:1-6> <questionnaireVersion 예: grade4_v2>
//
// 산출물:
//   - supabase/migrations/<timestamp>_seed_<version>.sql (idempotent INSERT, id는 결정론적 UUID라
//     동일 group_code 재실행 시 ON CONFLICT DO NOTHING으로 자동 중복 방지)
//   - data/questions/question-bank-v2.0.json 에 신규 항목 append(이미 존재하는 group_code는 skip)
//
// 요청서 표 형식: | 문항 ID | 주기(DAILY/WEEKLY/MONTHLY/QUARTERLY) | 미션(MISSION_I/MISSION_II) |
//                  유형(FIXED/ROTATION) | 영역(한글) | 질문 | daily_once_key(선택) |

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function getDeterministicQuestionId(groupCode) {
  const hash = crypto.createHash("sha256").update("kbestie-alpha-question:" + groupCode).digest("hex");
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// --- 영역 매핑(lib/mission/gradeQuestionAreaMap.ts와 동일 규칙, JS 스크립트라 자체 보유) ---
const DOMAIN_SCHOOL = { dashboardAreaTag: "school_life", domainId: "①학교·학원 생활", dailyReportField: "school_academy_life" };
const DOMAIN_PEER = { dashboardAreaTag: "peer_relations", domainId: "②친구관계와 또래생활", dailyReportField: "peer_friendship" };
const DOMAIN_EMOTION = { dashboardAreaTag: "emotion", domainId: "③감정 힌트", dailyReportField: "emotion_hint" };
const DOMAIN_INTERESTS = { dashboardAreaTag: "interests", domainId: "④관심사와 개인취향", dailyReportField: "interests_preferences" };
const DOMAIN_STUDY = { dashboardAreaTag: "study_concerns", domainId: "⑤공부 고민", dailyReportField: "study_concerns" };
const DOMAIN_DIGITAL = { dashboardAreaTag: "digital_interests", domainId: "⑥디지털 관심사와 콘텐츠 취향", dailyReportField: "digital_content_interests" };
const DOMAIN_FUTURE = { dashboardAreaTag: "future_dreams", domainId: "⑦미래·진로·꿈", dailyReportField: "future_dreams" };
const DOMAIN_RECURRING = { dashboardAreaTag: "recurring_stories", domainId: "⑧반복되는 이야기", dailyReportField: "recurring_stories" };
const OPENING = { dashboardAreaTag: "greeting", domainId: "", dailyReportField: "" };
const CLOSING = { dashboardAreaTag: "daily_general", domainId: "", dailyReportField: "" };

const KEYWORD_RULES = [
  [["하루 열기"], OPENING],
  [["하루 회고", "하루 마무리", "긍정 마무리", "내일 기대"], CLOSING],
  [["학교·수업", "학원·방과후", "학교 적응", "수업·활동", "쉬는 시간", "학업·학원", "학업·진학", "학업·진로"], DOMAIN_SCHOOL],
  [["친구·또래", "친구·놀이", "친구 관계"], DOMAIN_PEER],
  [["관계", "공정함", "규칙"], DOMAIN_PEER],
  [["감정", "몸·컨디션", "Rose-Thorn-Bud", "속상했던 일", "좋았던 일", "힘들거나", "힘들었던 일", "감정 그림"], DOMAIN_EMOTION],
  [["안전망", "믿을 수 있는 어른", "선생님·믿을 수 있는 어른"], DOMAIN_EMOTION],
  [["자기효능감", "자기이해", "성취", "자립"], DOMAIN_EMOTION],
  [["디지털·콘텐츠", "디지털·SNS"], DOMAIN_DIGITAL],
  [["관심사·진로"], DOMAIN_FUTURE],
  [["개인취향", "취향·놀이", "좋아하는 것", "관심사"], DOMAIN_INTERESTS],
  [["가족·집"], DOMAIN_RECURRING],
];

function mapQuestionArea(koreanArea) {
  const normalized = koreanArea.trim();
  for (const [keywords, mapping] of KEYWORD_RULES) {
    if (keywords.some((kw) => normalized.includes(kw))) return mapping;
  }
  return { ...DOMAIN_INTERESTS, unmapped: true };
}

const FREQUENCY_TO_CYCLE_TYPE = { DAILY: "always", WEEKLY: "weekly", MONTHLY: "monthly", QUARTERLY: "quarterly" };
const MISSION_SLOT_TO_ROUND_TYPE = { MISSION_I: "round1_day", MISSION_II: "round2_night" };

function parseTable(mdContent) {
  const lines = mdContent.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!/^\|\s*Q\d[-\w]*\s*\|/.test(line)) continue;
    // 파이프로 분리(맨 앞/뒤 빈 셀 제거) — 065는 7컬럼(ID/주기/미션/유형/영역/질문/daily_once_key),
    // 066~070은 9컬럼(ID/주기/미션/유형/영역/answer_mode/질문/daily_once_key/sensitivity).
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7 && cells.length !== 9) continue;

    const [questionId, frequency, missionSlot, selectionType, area] = cells;
    let questionText, dailyOnceKey, answerMode = null, sensitivity = null;
    if (cells.length === 7) {
      [, , , , , questionText, dailyOnceKey] = cells;
    } else {
      answerMode = cells[5];
      questionText = cells[6];
      dailyOnceKey = cells[7];
      sensitivity = cells[8];
    }
    if (!/^(DAILY|WEEKLY|MONTHLY|QUARTERLY)$/.test(frequency)) continue;
    if (!/^MISSION_I{1,2}$/.test(missionSlot)) continue;

    rows.push({
      questionId,
      frequency,
      missionSlot,
      selectionType,
      area,
      questionText,
      dailyOnceKey: dailyOnceKey || null,
      answerMode,
      sensitivity,
    });
  }
  return rows;
}

function main() {
  const [, , mdPath, gradeArg, version] = process.argv;
  if (!mdPath || !gradeArg || !version) {
    console.error("Usage: node scripts/seed-grade-question-bank.mjs <request.md> <grade> <version>");
    process.exit(1);
  }
  const grade = parseInt(gradeArg, 10);
  const mdContent = fs.readFileSync(path.resolve(mdPath), "utf-8");
  const rows = parseTable(mdContent);

  console.log(`파싱된 문항 수: ${rows.length} (기대값: 140)`);
  if (rows.length !== 140) {
    console.warn(`⚠️ 경고: 140개가 아닙니다. 표 형식을 확인하세요.`);
  }

  const unmapped = [];
  const sqlValues = [];
  const jsonEntries = [];
  const seenIds = new Set();

  for (const row of rows) {
    const groupCode = `${version}:${row.questionId}`;
    const id = getDeterministicQuestionId(groupCode);
    if (seenIds.has(id)) {
      console.error(`중복 ID 발생: ${groupCode} -> ${id}`);
      process.exit(1);
    }
    seenIds.add(id);

    const areaMap = mapQuestionArea(row.area);
    if (areaMap.unmapped) unmapped.push(`${row.questionId}: "${row.area}"`);

    const cycleType = FREQUENCY_TO_CYCLE_TYPE[row.frequency];
    const roundType = MISSION_SLOT_TO_ROUND_TYPE[row.missionSlot];
    if (!cycleType || !roundType) {
      console.error(`매핑 실패: ${row.questionId} frequency=${row.frequency} missionSlot=${row.missionSlot}`);
      process.exit(1);
    }

    const escapedText = row.questionText.replace(/'/g, "''");
    sqlValues.push(
      `  ('${id}', '${escapedText}', ARRAY[${grade}]::int[], '${cycleType}', '${areaMap.dashboardAreaTag}', '${roundType}', true, 'APPROVED', '${version}')`
    );

    if (areaMap.domainId) {
      // 상태체크 8분류에 해당하는 질문만 JSON 메타데이터를 등록한다(오프닝/클로징 성격의
      // greeting/daily_general 태그 문항은 isValidMissionQuestion의 8분류 대상이 아니므로
      // domain_id를 붙이지 않고 JSON 항목 자체를 생략 — DB 행만으로 충분히 출제 가능).
      jsonEntries.push({
        group_code: groupCode,
        title: row.questionId,
        question_text: row.questionText,
        applicable_grades: [grade],
        cycle_type: cycleType,
        dashboard_area_tag: areaMap.dashboardAreaTag,
        round_type: roundType,
        conversation_stage: "DAILY_LIFE",
        question_intent: `${row.area} 영역 상태 확인`,
        frequency: row.frequency,
        clinical_status: "APPROVED",
        question_bank_version: version,
        domain_id: areaMap.domainId,
        daily_report_field: areaMap.dailyReportField,
        information_goal: `${row.area} 영역 상태 확인`,
        purpose: "state_check",
        display_area: row.area,
        selection_type: row.selectionType,
        daily_once_key: row.dailyOnceKey,
        answer_mode: row.answerMode,
        sensitivity: row.sensitivity,
      });
    }
  }

  if (unmapped.length > 0) {
    console.log(`\n⚠️ 키워드 매핑 실패(기본값 interests로 처리됨) ${unmapped.length}건:`);
    unmapped.forEach((u) => console.log("  " + u));
  }

  // --- SQL 마이그레이션 생성 ---
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "");
  const migrationPath = path.join(repoRoot, "supabase/migrations", `${ts}_seed_${version}.sql`);
  const sql = `-- requests/065~070 — ${version} 학년 전용 미션 질문지 ${rows.length}문항 등록
-- 결정론적 UUID(group_code 기반) 사용 — 동일 group_code 재실행 시 ON CONFLICT DO NOTHING으로
-- 안전하게 재실행 가능(멱등). 기존 질문/history는 건드리지 않음(순수 INSERT).

INSERT INTO mission_questions
  (id, question_text, applicable_grades, cycle_type, dashboard_area_tag, round_type, is_active, clinical_status, question_bank_version)
VALUES
${sqlValues.join(",\n")}
ON CONFLICT (id) DO NOTHING;
`;
  fs.writeFileSync(migrationPath, sql, "utf-8");
  console.log(`\n마이그레이션 작성: ${migrationPath}`);

  // --- JSON 파일에 append (기존 group_code는 skip) ---
  const jsonPath = path.join(repoRoot, "data/questions/question-bank-v2.0.json");
  const existing = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const existingCodes = new Set(existing.map((q) => q.group_code));
  const toAdd = jsonEntries.filter((e) => !existingCodes.has(e.group_code));
  const merged = [...existing, ...toAdd];
  fs.writeFileSync(jsonPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  console.log(`JSON 갱신: 기존 ${existing.length}건 + 신규 ${toAdd.length}건 = ${merged.length}건 (state_check 대상 아닌 오프닝/클로징 문항 ${rows.length - jsonEntries.length}개는 JSON 미등록, DB만)`);

  console.log(`\n완료: ${version} — DB 행 ${sqlValues.length}개, JSON 항목 ${toAdd.length}개 추가`);
}

main();
