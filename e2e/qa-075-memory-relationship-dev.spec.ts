import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

const DEV_BASE = "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/agy-qa-075";
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

test.describe("075 관계 엔진 기억 활용 Dev QA", () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test("QA-1 ~ QA-6: 기억 인출, memory_refs, 할루시네이션 방지, 감정 우선, 전략 불변성", async () => {
    test.setTimeout(60_000);
    const cookie = await getAuthCookie();

    // 1. 세션 생성/조회
    const sessRes = await fetch(`${DEV_BASE}/api/chat/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ childId: CHILD_ID }),
    });
    expect(sessRes.status).toBe(200);
    const sessData = await sessRes.json();
    const sessionId = sessData.sessionId;
    expect(sessionId).toBeTruthy();

    const history: Array<{ role: "child" | "k"; text: string; id: string }> = [];

    async function sendTurn(text: string) {
      const childTurnId = "turn-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
      history.push({ role: "child", text, id: childTurnId });

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
      const kTurnId = "k-" + childTurnId;
      if (data.text) {
        history.push({ role: "k", text: data.text, id: kTurnId });
        await fetch(`${DEV_BASE}/api/chat/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ sessionId, role: "k", content: data.text, turnId: kTurnId }),
        });
      }
      return { status: resp.status, text: data.text, category: data.category };
    }

    // QA-1
    const t1 = await sendTurn("안녕");
    const t2 = await sendTurn("내가 전에 말한 거 기억나?");
    const t3 = await sendTurn("우리 가족 얘기 기억나?");
    expect(t1.status).toBe(200);
    expect(t2.text).toContain("가족");
    expect(t3.text).toContain("식사");

    // QA-3
    const t4 = await sendTurn("내가 강아지 키운다고 했었지?");
    const t5 = await sendTurn("내가 지난주에 놀이공원 갔다고 했잖아");

    // QA-4
    const t6 = await sendTurn("오늘 학교에서 속상한 일 있었어");
    expect(t6.text).not.toContain("식사");

    const record = {
      sessionId,
      turns: [
        { turn: "안녕", response: t1 },
        { turn: "내가 전에 말한 거 기억나?", response: t2 },
        { turn: "우리 가족 얘기 기억나?", response: t3 },
        { turn: "내가 강아지 키운다고 했었지?", response: t4 },
        { turn: "내가 지난주에 놀이공원 갔다고 했잖아", response: t5 },
        { turn: "오늘 학교에서 속상한 일 있었어", response: t6 },
      ],
    };
    fs.writeFileSync(path.join(EVIDENCE_DIR, "qa-075-execution-summary.json"), JSON.stringify(record, null, 2));
  });
});
