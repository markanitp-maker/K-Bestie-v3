import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-stt";

const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";

function runQuery(sql: string) {
  try {
    const stdout = execSync(`node scripts/run-query.js "${sql.replace(/"/g, '\\"')}"`, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  } catch (err: any) {
    console.error("SQL Error:", err.message);
    return null;
  }
}

test.describe("STT API Repeated Verification", () => {
  test("QA-2: Call /api/mission/stt 3 times and verify latency & success", async ({ page }) => {
    // 1. Login
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_A_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
    await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

    await page.evaluate(({ cId }) => {
      localStorage.setItem("k_child_id", cId);
      localStorage.setItem("login_role", "member");
    }, { cId: CHILD_A_ID });

    // 2. Active session
    const sessionRes = runQuery(`
      SELECT id FROM chat_sessions 
      WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL 
      ORDER BY started_at DESC LIMIT 1;
    `);
    const sessionId = sessionRes?.[0]?.id;

    const silenceBase64 = Buffer.alloc(16000 * 2).toString("base64");

    const batchResults = [];
    for (let i = 1; i <= 3; i++) {
      const t0 = Date.now();
      const res = await page.evaluate(async ({ sId, audio, iter }) => {
        const fetchRes = await fetch("/api/mission/stt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sId,
            audioBase64: audio,
            sampleRateHertz: 16000,
            childTurnId: `turn_batch_${iter}_${Date.now()}`
          })
        });
        const data = await fetchRes.json().catch(() => null);
        return { status: fetchRes.status, ok: fetchRes.ok, data };
      }, { sId: sessionId, audio: silenceBase64, iter: i });
      const elapsed = Date.now() - t0;
      batchResults.push({ iter: i, ...res, elapsedMs: elapsed });
    }

    console.log("Batch STT Results:", JSON.stringify(batchResults, null, 2));
    fs.writeFileSync(`${EVIDENCE_DIR}/qa2_batch_results.json`, JSON.stringify(batchResults, null, 2));

    for (const r of batchResults) {
      expect(r.status).toBe(200);
      expect(r.ok).toBe(true);
    }
  });
});
