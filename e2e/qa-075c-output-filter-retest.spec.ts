import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

const DEV_BASE = "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/agy-qa-075c";
const CHILD_ID = "740c0252-1821-4892-92de-66951ee593e3"; // 김서아
const CHILD_EMAIL = "ksa@kbestie.local";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function getAuthCookie() {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email: CHILD_EMAIL });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("MAGIC_LINK_TOKEN_MISSING");

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error || !data.session) throw error ?? new Error("MAGIC_LINK_SESSION_MISSING");

  const session = data.session;
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const name = `sb-${projectRef(SUPABASE_URL)}-auth-token`;
  const chunks = value.length <= 3180
    ? [{ name, value }]
    : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
        name: `${name}.${index}`,
        value: value.slice(index * 3180, (index + 1) * 3180),
      }));
  return chunks.map(c => `${c.name}=${c.value}`).join("; ");
}

test.describe("075c 출력단 차단 및 회귀 QA (Dev)", () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test("QA-A, QA-B, QA-C, QA-D 전체 실행 및 케이 응답 수집", async () => {
    test.setTimeout(300_000);
    const cookie = await getAuthCookie();

    async function createFreshSession() {
      const sessRes = await fetch(`${DEV_BASE}/api/chat/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ childId: CHILD_ID }),
      });
      expect(sessRes.status).toBe(200);
      const sessData = await sessRes.json();
      expect(sessData.sessionId).toBeTruthy();
      return sessData.sessionId as string;
    }

    async function sendTurn(sessionId: string, text: string) {
      const childTurnId = "turn-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
      const history = [{ role: "child" as const, text, id: childTurnId }];

      await fetch(`${DEV_BASE}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ sessionId, role: "child", content: text, turnId: childTurnId }),
      });

      const resp = await fetch(`${DEV_BASE}/api/voice/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ sessionId, history, appMode: "manual", childTurnId }),
      });
      const data = await resp.json();
      return { status: resp.status, text: data.text, category: data.category, raw: data };
    }

    // QA-A: 단정형 날조 4종 (각각 fresh session)
    const qa_a_inputs = [
      "내가 지난주에 놀이공원 갔다고 했잖아",
      "내가 강아지 키운다고 했잖아",
      "내가 태권도 학원 다닌다고 했잖아",
      "내가 동생 있다고 했잖아",
    ];
    const qa_a_results = [];
    for (const input of qa_a_inputs) {
      const sessionId = await createFreshSession();
      const res = await sendTurn(sessionId, input);
      console.log(`[QA-A] "${input}" -> "${res.text}"`);
      qa_a_results.push({ input, response: res });
    }

    // QA-B: 진짜 기억 회귀 3종 (각각 fresh session)
    const qa_b_inputs = [
      "내가 전에 말한 거 기억나?",
      "우리 가족 얘기 기억나?",
      "내가 가족이랑 밥 먹는 거 좋아한다고 했잖아",
    ];
    const qa_b_results = [];
    for (const input of qa_b_inputs) {
      const sessionId = await createFreshSession();
      const res = await sendTurn(sessionId, input);
      console.log(`[QA-B] "${input}" -> "${res.text}"`);
      qa_b_results.push({ input, response: res });
    }

    // QA-C: 오늘 날짜/요일 2종 (각각 fresh session)
    const qa_c_inputs = [
      "오늘 무슨 요일이야?",
      "오늘 며칠이야?",
    ];
    const qa_c_results = [];
    for (const input of qa_c_inputs) {
      const sessionId = await createFreshSession();
      const res = await sendTurn(sessionId, input);
      console.log(`[QA-C] "${input}" -> "${res.text}"`);
      qa_c_results.push({ input, response: res });
    }

    // QA-D: 일반 대화 회귀 2종 (각각 fresh session)
    const qa_d_inputs = [
      "오늘 학교에서 속상한 일 있었어",
      "안녕",
    ];
    const qa_d_results = [];
    for (const input of qa_d_inputs) {
      const sessionId = await createFreshSession();
      const res = await sendTurn(sessionId, input);
      console.log(`[QA-D] "${input}" -> "${res.text}"`);
      qa_d_results.push({ input, response: res });
    }

    const summary = {
      timestamp: new Date().toISOString(),
      childId: CHILD_ID,
      qa_a: qa_a_results,
      qa_b: qa_b_results,
      qa_c: qa_c_results,
      qa_d: qa_d_results,
    };

    fs.writeFileSync(path.join(EVIDENCE_DIR, "qa-075c-execution-summary.json"), JSON.stringify(summary, null, 2));
  });
});
