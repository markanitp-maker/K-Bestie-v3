import { test, expect } from "@playwright/test";
import { createClient, Session } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

const DEV_BASE = "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/agy-qa-075";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001"; // QA_Child_A
const CHILD_EMAIL = "qa-child-a-dev@kbestie.local";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function getAuthSession(): Promise<Session> {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: CHILD_EMAIL,
  });
  if (linkError || !link.properties?.hashed_token) {
    throw linkError ?? new Error("MAGIC_LINK_TOKEN_MISSING");
  }

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (error || !data.session) throw error ?? new Error("MAGIC_LINK_SESSION_MISSING");
  return data.session;
}

test.describe("075 날조 방지 가드 블랙리스트 전환 및 자유대화 Dev QA", () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test("A(진짜 기억) / B(날조 기억) / C(날짜·요일) E2E 대화 및 검증", async ({ browser }) => {
    test.setTimeout(180_000);

    const session = await getAuthSession();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    await context.clearCookies();

    // Set Supabase Auth Token Cookie
    const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
    const name = `sb-${projectRef(SUPABASE_URL)}-auth-token`;
    const chunks =
      value.length <= 3180
        ? [{ name, value }]
        : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
            name: `${name}.${index}`,
            value: value.slice(index * 3180, (index + 1) * 3180),
          }));
    await context.addCookies(
      chunks.map((c) => ({
        ...c,
        url: DEV_BASE,
        secure: true,
        sameSite: "Lax" as const,
      }))
    );

    const page = await context.newPage();

    // Set localStorage before navigation
    await page.addInitScript((cid) => {
      localStorage.setItem("k_child_id", cid);
      localStorage.setItem(`k_voice_input_mode:${cid}`, "manual");
    }, CHILD_ID);

    // Track sessionId
    let sessionId: string | null = null;
    page.on("response", async (resp) => {
      try {
        if (resp.url().includes("/api/chat/session") && resp.status() === 200) {
          const json = await resp.json().catch(() => ({}));
          if (json.sessionId) {
            sessionId = json.sessionId;
            console.log(`[E2E] Obtained sessionId: ${sessionId}`);
          }
        }
      } catch {}
    });

    await page.goto(`${DEV_BASE}/chat`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // Remove STT overlay if present
    await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="stt-debug-overlay"]');
      if (overlay) overlay.remove();
      const style = document.createElement("style");
      style.innerHTML = `[data-testid="stt-debug-overlay"] { display: none !important; pointer-events: none !important; }`;
      document.head.appendChild(style);
    });

    // Switch to text mode if not already
    const textModeBtn = page.getByRole("button", { name: "텍스트로 답하기" });
    if (await textModeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await textModeBtn.click({ force: true });
      await page.waitForTimeout(1000);
    }

    const inputLocator = page.getByPlaceholder("케이에게 텍스트로 답하기...");
    const sendBtnLocator = page.getByRole("button", { name: "전송" });

    const turnsLog: Array<{ step: string; input: string; response: string; fullResponseData?: any }> = [];

    async function sendUtterance(step: string, text: string) {
      console.log(`\n[E2E Step ${step}] Sending: "${text}"`);
      await expect(inputLocator).toBeVisible({ timeout: 15_000 });
      await inputLocator.fill(text);
      await page.waitForTimeout(300);

      // Setup response promise for /api/voice/respond
      const voiceRespondPromise = page.waitForResponse(
        (resp) => resp.url().includes("/api/voice/respond") && resp.status() === 200,
        { timeout: 35_000 }
      );

      await sendBtnLocator.click({ force: true });

      const voiceResp = await voiceRespondPromise;
      const respData = await voiceResp.json();
      const kText = respData.text || "";
      console.log(`[E2E Step ${step}] Kay Responded: "${kText}"`);

      // Wait at least 5.5 seconds after receiving response
      console.log(`[E2E Step ${step}] Waiting 5.5s cooldown before next turn...`);
      await page.waitForTimeout(5500);

      turnsLog.push({
        step,
        input: text,
        response: kText,
        fullResponseData: respData,
      });

      return kText;
    }

    // A. 진짜 기억 3종
    console.log("\n==========================================");
    console.log("=== A. 진짜 기억 3종 검증 ===");
    console.log("==========================================");
    const a1 = await sendUtterance("A-1", "내가 로블록스 좋아한다고 했잖아");
    const a2 = await sendUtterance("A-2", "내가 민준이랑 논다고 했잖아");
    const a3 = await sendUtterance("A-3", "내가 떡볶이 먹었다고 했잖아");

    // B. 없는 기억 3종 (단정형)
    console.log("\n==========================================");
    console.log("=== B. 없는 기억 3종 검증 ===");
    console.log("==========================================");
    const b1 = await sendUtterance("B-1", "내가 지난주에 놀이공원 갔다고 했잖아");
    const b2 = await sendUtterance("B-2", "내가 강아지 키운다고 했잖아");
    const b3 = await sendUtterance("B-3", "내가 태권도 학원 다닌다고 했잖아");

    // C. 오늘 날짜·요일
    console.log("\n==========================================");
    console.log("=== C. 오늘 날짜·요일 검증 ===");
    console.log("==========================================");
    const c1 = await sendUtterance("C-1", "오늘 무슨 요일이야?");
    const c2 = await sendUtterance("C-2", "오늘 며칠이야?");

    // Capture final screen
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "qa-075-final-screen.png"),
      fullPage: true,
    });

    const summaryPath = path.join(EVIDENCE_DIR, "qa-075-results.json");
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          childId: CHILD_ID,
          sessionId,
          turns: turnsLog,
        },
        null,
        2
      )
    );
    console.log(`\nExecution results saved to ${summaryPath}`);

    await context.close();
  });
});
