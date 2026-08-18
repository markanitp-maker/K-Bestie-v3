#!/usr/bin/env node
/**
 * 078 canonical 질문은행 반영 — 재현 가능한 적용 스크립트.
 *
 * DEV 에서 검증을 마친 canonical 상태를 그대로 대상 환경에 반영한다.
 * 임의 수동 UPDATE 를 금지하기 위해 모든 Production DB 변경은 이 스크립트로만 수행한다.
 *
 * 입력(체크인된 산출물):
 *   docs/reviews/canonical/question-metadata.json  기존 승인 질문의 최종 메타데이터
 *   docs/reviews/canonical/new-questions.json      신규 질문 전체 행
 *
 * 하는 일은 두 가지뿐이다.
 *   1) 기존 question_id 의 question_family / school_context_tag / weekday_affinity 갱신
 *   2) 신규 질문 INSERT (id 충돌 시 무시 — 재실행해도 중복이 생기지 않는다)
 *
 * 하지 않는 일:
 *   - question_text 수정, 질문 삭제·비활성화
 *   - 대화/미션/보상 등 이력 데이터 변경
 *
 * 사용법:
 *   node scripts/apply-canonical-question-bank.js --dry-run
 *   node scripts/apply-canonical-question-bank.js --apply
 *   node scripts/apply-canonical-question-bank.js --apply --target=prod --confirm=PRODUCTION
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const isApply = args.includes("--apply");
const target = (args.find((a) => a.startsWith("--target=")) || "--target=dev").split("=")[1];
const confirm = (args.find((a) => a.startsWith("--confirm=")) || "").split("=")[1];

if (target === "prod" && confirm !== "PRODUCTION") {
  console.error("ERROR: Production 반영에는 --confirm=PRODUCTION 이 필요합니다.");
  process.exit(1);
}

const envPath = path.join(__dirname, "../.env.local");
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  });
}
const TOKEN = envVars["SUPABASE_ACCESS_TOKEN"];
const PROJECT_REF = target === "prod" ? "fetvnhhjicndmxvhrffk" : "mkrsaaedxqrcrktapaus";
if (!TOKEN) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.");
  process.exit(1);
}

const CANON_DIR = path.join(__dirname, "../docs/reviews/canonical");
const meta = JSON.parse(fs.readFileSync(path.join(CANON_DIR, "question-metadata.json"), "utf8"));
const newQuestions = JSON.parse(fs.readFileSync(path.join(CANON_DIR, "new-questions.json"), "utf8"));

async function runSQL(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 400)}`);
  return res.json();
}

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// 078 후속: 검수 CSV 는 school_context_required 를 TRUE/FALSE 로 적는데
// DB 도메인값은 school_required/universal 이다. 변환 없이 그대로 넣으면
// 방학 차단 코드가 'school_required' 만 보기 때문에 학교 전제 질문이
// 방학에도 노출된다. 실제로 프로덕션에서 56건이 이 상태로 들어갔다.
const schoolTag = (v) => {
  if (v === true || v === "TRUE" || v === "true") return "school_required";
  if (v === false || v === "FALSE" || v === "false") return "universal";
  return v; // 이미 school_required / universal 인 경우
};
const arr = (v, cast) =>
  !Array.isArray(v) || v.length === 0
    ? `ARRAY[]::${cast}[]`
    : `ARRAY[${v.map((x) => (cast === "int" ? Number(x) : q(x))).join(",")}]::${cast}[]`;

async function main() {
  console.log("=========================================");
  console.log(`적용 대상: ${target.toUpperCase()} (${PROJECT_REF})`);
  console.log(`모드: ${isApply ? "APPLY" : "DRY-RUN"}`);
  console.log(`기존 질문 메타데이터: ${meta.length}건 / 신규 질문: ${newQuestions.length}건`);
  console.log("=========================================");

  if (!isApply) {
    console.log("DRY-RUN — 아무것도 쓰지 않았습니다. 실제 반영은 --apply 를 붙이세요.");
    return;
  }

  // 1) 기존 질문 메타데이터 갱신 (question_text 는 건드리지 않는다)
  let updated = 0;
  const CHUNK = 100;
  for (let i = 0; i < meta.length; i += CHUNK) {
    const chunk = meta.slice(i, i + CHUNK);
    const values = chunk
      .map((r) => `(${q(r.id)}::uuid, ${q(r.question_family)}, ${q(schoolTag(r.school_context_tag))}, ${arr(r.weekday_affinity, "text")})`)
      .join(",\n");
    const sql = `
      UPDATE mission_questions AS m
      SET question_family = v.family,
          school_context_tag = v.school_tag,
          weekday_affinity = v.weekday
      FROM (VALUES\n${values}\n) AS v(id, family, school_tag, weekday)
      WHERE m.id = v.id;
    `;
    await runSQL(sql);
    updated += chunk.length;
    process.stdout.write(`\r  메타데이터 갱신 ${updated}/${meta.length}`);
  }
  console.log("");

  // 2) 신규 질문 INSERT — id 충돌 시 무시하므로 재실행해도 중복이 없다
  let inserted = 0;
  for (let i = 0; i < newQuestions.length; i += CHUNK) {
    const chunk = newQuestions.slice(i, i + CHUNK);
    const values = chunk
      .map((r) =>
        `(${q(r.id)}::uuid, ${q(r.question_text)}, ${arr(r.applicable_grades, "int")}, ${q(r.semantic_group)}, ` +
        `${arr(r.weekday_affinity, "text")}, ${q(r.periodicity)}, ${r.cooldown_days ?? "NULL"}, ` +
        `${q(r.conversation_style)}, ${q(r.answer_mode)}, ${q(r.topic)}, ${q(r.sensitivity)}, ` +
        `${r.memory_usable === null || r.memory_usable === undefined ? "NULL" : r.memory_usable}, ` +
        `${q(r.question_family)}, ${q(schoolTag(r.school_context_tag))}, ${q(r.clinical_status)}, ` +
        `${r.is_active === null || r.is_active === undefined ? "true" : r.is_active}, ` +
        `${q(r.question_bank_version)}, ${q(r.round_type)}, ${q(r.cycle_type)}, ` +
        `${q(r.question_intent)}, ${q(r.conversation_stage)}, ${q(r.dashboard_area_tag)})`,
      )
      .join(",\n");
    const sql = `
      INSERT INTO mission_questions
        (id, question_text, applicable_grades, semantic_group, weekday_affinity, periodicity,
         cooldown_days, conversation_style, answer_mode, topic, sensitivity, memory_usable,
         question_family, school_context_tag, clinical_status, is_active,
         question_bank_version, round_type, cycle_type, question_intent,
         conversation_stage, dashboard_area_tag)
      VALUES\n${values}\n
      ON CONFLICT (id) DO NOTHING;
    `;
    await runSQL(sql);
    inserted += chunk.length;
    process.stdout.write(`\r  신규 질문 반영 ${inserted}/${newQuestions.length}`);
  }
  console.log("");
  console.log("완료. 반영 결과는 별도 READ-ONLY 검증으로 확인하세요.");
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
