import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// dotenv 패키지가 이 프로젝트에 없으므로 .env.local을 직접 파싱한다.
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const BASE = process.env.BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const USERNAME = "qaclaude160202";
const PASSWORD = process.env.QA_TEST_PASSWORD;
if (!PASSWORD) {
  console.error("QA_TEST_PASSWORD env var not set — refusing to run.");
  process.exit(1);
}

// Dev Supabase
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Supabase config not found.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getSessionInfo(childId) {
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const startOfDayKst = new Date(kstNow.toISOString().split("T")[0] + "T00:00:00+09:00").toISOString();
  
  const { data: session, error } = await supabase
    .from("chat_sessions")
    .select("id, mission_progress(valid_answer_count, question_ids, question_states)")
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .gte("started_at", startOfDayKst)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
    
  if (error || !session) return null;
  return session;
}

async function getQuestionHistory(sessionId) {
  const { data, error } = await supabase
    .from("mission_question_history")
    .select("question_id, question_role, answer_status, selected_order")
    .eq("session_id", sessionId)
    .order("selected_order", { ascending: true });
  return data || [];
}

async function ensureTextMode(page) {
  const textInput = page.locator('input[placeholder="케이에게 답해봐..."]');
  if (await textInput.count() > 0) return;
  const switchBtn = page.locator('button[aria-label="텍스트로 대화하기"]');
  if (await switchBtn.count() > 0) await switchBtn.click();
  await page.waitForSelector('input[placeholder="케이에게 답해봐..."]', { timeout: 15000 });
}

async function rawLineCount(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).length;
  });
}

const STATIC_UI_LINES = new Set([
  "태블릿", "스마트폰", "9:41", "← 뒤로가기", "내친구 케이", "🔊", "🔇", "자동", "수동",
  "대기 중...", "듣고 있어요", "💬", "✕", "🎤", "➤",
  "기기 설정으로 화면이 꺼질 수 있어요",
]);
function isStaticUiLine(line) {
  if (STATIC_UI_LINES.has(line)) return true;
  if (/^\d+\/\d+$/.test(line)) return true; // "3/10" 진행률
  return false;
}
function filterDynamic(lines) {
  return lines.filter((l) => !isStaticUiLine(l));
}
async function bubbleTexts(page) {
  const lines = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  });
  return filterDynamic(lines);
}

async function sendAnswer(page, answer, rawBeforeCount) {
  await page.fill('input[placeholder="케이에게 답해봐..."]', answer);
  await page.click('button[aria-label="전송"]');

  await page.waitForFunction(
    (n) => {
      const text = document.body.innerText || "";
      return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).length > n;
    },
    rawBeforeCount,
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(3000);

  const afterDynamic = await bubbleTexts(page);
  const rawAfterCount = await rawLineCount(page);
  const latestK = afterDynamic[afterDynamic.length - 1] ?? "(none)";
  return { latestK, rawAfterCount, afterDynamic };
}

(async () => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream"
    ],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();

  console.log("\n=== E2E Test: 004 Mission Reserve Live ===\n");
  
  // 1. Get Child ID for qaclaude160202 - 이 계정은 member_accounts가 아니라
  // family_members(role='child')+child_profiles 체인을 쓴다(QA테스트는 실제
  // Supabase Auth 유저 - resolveChildForUser와 동일 경로).
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const qaUser = authUsers.users.find((u) => u.email === `${USERNAME}@kbestie.local`);
  if (!qaUser) { console.error("QA auth user not found"); process.exit(1); }
  const { data: familyMember } = await supabase.from("family_members").select("id").eq("user_id", qaUser.id).eq("role", "child").maybeSingle();
  const { data: profile } = await supabase.from("child_profiles").select("id").eq("member_id", familyMember.id).maybeSingle();
  const childId = profile.id;
  
  // Clear any incomplete missions today to ensure a fresh start
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const startOfDayKst = new Date(kstNow.toISOString().split("T")[0] + "T00:00:00+09:00").toISOString();
  await supabase.from("chat_sessions").delete().eq("child_id", childId).eq("session_type", "mission").gte("started_at", startOfDayKst);

  // Login
  console.log("로그인 중...");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[placeholder="아이 아이디를 입력하세요"]', USERNAME);
  await page.fill('input[placeholder="비밀번호를 입력하세요"]', PASSWORD);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/\/(child|parent)/, { timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Start Mission
  console.log("미션 시작 중...");
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const startBtn = page.locator('button[aria-label="미션 시작"]');
  if (await startBtn.count() > 0) await startBtn.click();
  
  await ensureTextMode(page);
  await page.waitForTimeout(3000);
  
  const sess = await getSessionInfo(childId);
  const sessionId = sess.id;
  const histInitial = await getQuestionHistory(sessionId);
  const pCount = histInitial.filter(h => h.question_role === "PRIMARY").length;
  const rCount = histInitial.filter(h => h.question_role === "RESERVE").length;
  console.log(`[시작 DB 확인] PRIMARY: ${pCount}개, RESERVE: ${rCount}개`);

  let rawBefore = await rawLineCount(page);

  // 2. REFUSAL 1회 재시도 및 예비질문 전환 확인
  console.log("\n[테스트] 첫 질문에 REFUSAL(싫어) 전송...");
  let res = await sendAnswer(page, "싫어", rawBefore);
  rawBefore = res.rawAfterCount;
  
  let hist = await getQuestionHistory(sessionId);
  let q0 = hist.find(h => h.selected_order === 1);
  console.log(`- 1차 답변 후 DB 상태: ${q0.answer_status}`); // skipped
  
  console.log("[테스트] 같은 질문에 다시 REFUSAL(싫어) 전송...");
  res = await sendAnswer(page, "싫어", rawBefore);
  rawBefore = res.rawAfterCount;
  
  hist = await getQuestionHistory(sessionId);
  q0 = hist.find(h => h.selected_order === 1);
  const q1 = hist.find(h => h.selected_order === 2);
  console.log(`- 2차 답변 후 DB 상태: 1번질문=${q0.answer_status} (${q0.question_role}), 2번질문=${q1.question_role} (승격됨)`);
  
  // 3. NO_RESPONSE 1회 재시도 및 예비질문 전환 확인
  console.log("\n[테스트] 새 질문에 NO_RESPONSE(빈 답변 유도 - ' ') 전송...");
  res = await sendAnswer(page, " ", rawBefore);
  rawBefore = res.rawAfterCount;
  
  hist = await getQuestionHistory(sessionId);
  let qNew = hist.find(h => h.selected_order === 2);
  console.log(`- 1차 답변 후 DB 상태: ${qNew.answer_status}`); // skipped
  
  console.log("[테스트] 같은 질문에 다시 NO_RESPONSE 전송...");
  res = await sendAnswer(page, " ", rawBefore);
  rawBefore = res.rawAfterCount;
  
  hist = await getQuestionHistory(sessionId);
  qNew = hist.find(h => h.selected_order === 2);
  const qNext = hist.find(h => h.selected_order === 3);
  console.log(`- 2차 답변 후 DB 상태: 2번질문=${qNew.answer_status} (${qNew.question_role}), 3번질문=${qNext.question_role} (승격됨)`);

  // 4. VALID 답변 10개 완료 확인
  console.log("\n[테스트] VALID 답변 10회 전송하여 완료...");
  for (let i = 0; i < 10; i++) {
    res = await sendAnswer(page, "응응", rawBefore);
    rawBefore = res.rawAfterCount;
    const progress = (await getSessionInfo(childId)).mission_progress;
    console.log(`- VALID ${i+1}/10 전송 완료. 현재 카운트: ${progress[0]?.valid_answer_count ?? progress.valid_answer_count}`);
  }

  const finalProgress = (await getSessionInfo(childId)).mission_progress;
  const isCompleted = finalProgress[0]?.status === 'COMPLETED' || finalProgress.status === 'COMPLETED';
  console.log(`[완료 상태 확인] COMPLETED = ${isCompleted}`);
  
  // 서버 200 상태 배너 미표시 확인
  const errorBanner = page.locator('text="서버 연결이 불안정해요"');
  const errorCount = await errorBanner.count();
  console.log(`[배너 확인] "서버 연결이 불안정해요" 배너 표시 횟수 = ${errorCount}`);

  // 5. 풀 소진 상태 테스트 (임의로 세션 데이터를 조작하여 유도)
  // We'll create a new mission, then forcefully delete all RESERVE questions from history and mark all others refused.
  console.log("\n[테스트] 질문 풀 소진(MISSION_QUESTION_POOL_EXHAUSTED) 중립 메시지 확인...");
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const restartBtn = page.locator('button[aria-label="미션 시작"]');
  if (await restartBtn.count() > 0) await restartBtn.click();
  await ensureTextMode(page);
  await page.waitForTimeout(3000);

  const newSess = await getSessionInfo(childId);
  const newSessId = newSess.id;
  
  // Wipe reserves and set valid limit so it starves
  await supabase.from("mission_question_history").delete().eq("session_id", newSessId).eq("question_role", "RESERVE");
  await supabase.from("mission_progress").update({ required_valid_count: 50 }).eq("session_id", newSessId);
  
  // Fail current question twice to trigger reserve promotion failure -> Pool Exhausted
  rawBefore = await rawLineCount(page);
  res = await sendAnswer(page, "싫어", rawBefore);
  rawBefore = res.rawAfterCount;
  res = await sendAnswer(page, "싫어", rawBefore);
  rawBefore = res.rawAfterCount;

  console.log(`[풀 소진 메시지 확인] 케이 응답: "${res.latestK}"`);
  
  await context.close();
  await browser.close();
  
  console.log("\n=== E2E Test Completed ===");
})();
