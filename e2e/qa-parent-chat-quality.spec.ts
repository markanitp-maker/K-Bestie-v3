import { test, expect } from "@playwright/test";
import fs from "fs";

// 부모–케이 대화 품질 QA.
// 대표님 지적("케이가 지능이 많이 떨어진다")으로 고친 것들이 실제로 동작하는지 본다.
// agy 쿼터 소진으로 오케스트레이터가 직접 작성·실행한다(2026-08-18).

const BASE = process.env.QA_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const PARENT_USERNAME = "qatesti-dev";
const OUT = "/tmp/qa-parent-chat";

// 순서가 중요하다. 앞말을 이어받는지가 핵심 판정이라 한 세션에서 연속으로 말한다.
const TURNS = [
  { id: "A1", text: "우리 애가 요즘 통 말이 없어요" },
  { id: "A2", text: "왜 그럴까요?" },
  { id: "A3", text: "그럼 제가 어떻게 하면 좋을까요?" },
  { id: "B1", text: "케이는 무슨 도움을 줄 수 있어요?" },
  { id: "C1", text: "서현이 어제 뭐 했어?" },
];

test("부모-케이 대화 품질", async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });

  const answers: { id: string; question: string; answer: string; route: string | null }[] = [];

  // API 응답을 직접 가로챈다 — 화면 파싱보다 정확하다.
  page.on("response", async (res) => {
    if (!res.url().includes("/api/parent/k-chat")) return;
    try {
      const body = await res.json();
      answers.push({
        id: "", question: "",
        answer: typeof body.answer === "string" ? body.answer : JSON.stringify(body).slice(0, 200),
        route: body.answerStatus ?? body.retrievalStatus ?? null,
      });
    } catch { /* 파싱 실패는 무시 — 아래에서 개수로 드러난다 */ }
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/parent\/|\/$/, { timeout: 20000 }).catch(() => {});

  await page.goto(`${BASE}/parent/guide`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/00-guide.png` });

  const input = page.getByPlaceholder(/케이가 아는 선에서 알려드려요|입력/).first();

  for (const turn of TURNS) {
    const before = answers.length;
    await input.fill(turn.text);
    await page.keyboard.press("Enter");
    // 응답이 올 때까지 기다린다. 타임아웃이어도 계속 진행해 무엇이 왔는지 본다.
    await page.waitForFunction((n) => true, before, { timeout: 1000 }).catch(() => {});
    for (let i = 0; i < 60 && answers.length === before; i++) {
      await page.waitForTimeout(1000);
    }
    if (answers.length > before) {
      answers[answers.length - 1].id = turn.id;
      answers[answers.length - 1].question = turn.text;
    }
    await page.screenshot({ path: `${OUT}/${turn.id}.png` });
  }

  fs.writeFileSync(`${OUT}/answers.json`, JSON.stringify(answers, null, 2));
  console.log("\n===== 부모-케이 대화 결과 =====");
  for (const a of answers) {
    console.log(`[${a.id || "?"}] ${a.question}\n   → (${a.route}) ${a.answer}\n`);
  }

  expect(answers.length, "응답이 하나도 오지 않았다").toBeGreaterThan(0);
});
