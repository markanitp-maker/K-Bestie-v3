import { createClient, type Session } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const DEV_BASE = "https://k-bestie-v3-dev.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const QA_CHILD_EMAIL = "ksh@kbestie.local";

type ViewportMetrics = {
  innerHeight: number;
  clientHeight: number;
  visualViewportHeight: number;
  visualViewportOffsetTop: number;
  container: DOMRect;
  inputArea: DOMRect;
  inputRow: DOMRect;
  inputAreaPaddingBottom: string;
  parentOverflowY: string | null;
  parentScrollTop: number | null;
  bodyScrollTop: number;
  windowScrollY: number;
};

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function useSession(context: BrowserContext, session: Session) {
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const cookieName = `sb-${projectRef(SUPABASE_URL!)}-auth-token`;
  const chunks = value.length <= 3180
    ? [{ name: cookieName, value }]
    : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
        name: `${cookieName}.${index}`,
        value: value.slice(index * 3180, (index + 1) * 3180),
      }));
  await context.addCookies(chunks.map((chunk) => ({
    ...chunk,
    url: DEV_BASE,
    secure: true,
    sameSite: "Lax" as const,
  })));
}

async function loginAsChild(page: Page, context: BrowserContext) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    throw new Error("Dev Supabase QA credentials are required");
  }
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: QA_CHILD_EMAIL,
  });
  if (linkError || !link.properties?.hashed_token) throw new Error("QA magic link generation failed");

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !verified.session) throw new Error("QA magic link verification failed");

  const { data: familyMember, error: familyMemberError } = await service
    .from("family_members")
    .select("id")
    .eq("user_id", verified.session.user.id)
    .single();
  if (familyMemberError || !familyMember) throw new Error("QA family member lookup failed");
  const { data: childProfile, error: childProfileError } = await service
    .from("child_profiles")
    .select("id")
    .eq("member_id", familyMember.id)
    .single();
  if (childProfileError || !childProfile) throw new Error("QA child profile lookup failed");

  await useSession(context, verified.session);
  await page.goto(`${DEV_BASE}/child/home`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/child\/home/);
  return childProfile.id;
}

async function dismissOverlays(page: Page) {
  const laterButton = page.getByRole("button", { name: /^(나중에|나중에 할게요)/ }).first();
  const appeared = await laterButton.waitFor({ state: "visible", timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await laterButton.click();
    await page.waitForTimeout(300);
  }
}

async function openTextInput(page: Page) {
  const start = page.getByRole("button", { name: /^(시작하기|이어하기|대화 시작하기|새 미션 시작하기)$/ }).first();
  const textMode = page.getByRole("button", { name: "텍스트로 답하기" }).first();
  const input = page.getByPlaceholder("케이에게 텍스트로 답하기...");
  await expect(start.or(textMode).or(input).first()).toBeVisible({ timeout: 30_000 });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    await expect(textMode.or(input).first()).toBeVisible({ timeout: 30_000 });
  }
  if (await textMode.isVisible().catch(() => false)) await textMode.click();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.focus();
}

async function readMetrics(
  page: Page,
  containerSelector: string,
  inputAreaSelector: string,
): Promise<ViewportMetrics> {
  return page.evaluate(({ containerSelector, inputAreaSelector }) => {
    const container = document.querySelector<HTMLElement>(containerSelector);
    const inputArea = document.querySelector<HTMLElement>(inputAreaSelector);
    const inputRow = inputArea?.querySelector<HTMLElement>("input")?.parentElement;
    if (!container || !inputArea || !inputRow) throw new Error("conversation metrics target missing");
    const parent = document.querySelector<HTMLElement>('[data-ui="demo-frame-mobile-viewport"]');
    return {
      innerHeight: window.innerHeight,
      clientHeight: document.documentElement.clientHeight,
      visualViewportHeight: window.visualViewport?.height ?? window.innerHeight,
      visualViewportOffsetTop: window.visualViewport?.offsetTop ?? 0,
      container: container.getBoundingClientRect().toJSON(),
      inputArea: inputArea.getBoundingClientRect().toJSON(),
      inputRow: inputRow.getBoundingClientRect().toJSON(),
      inputAreaPaddingBottom: getComputedStyle(inputArea).paddingBottom,
      parentOverflowY: parent ? getComputedStyle(parent).overflowY : null,
      parentScrollTop: parent?.scrollTop ?? null,
      bodyScrollTop: document.documentElement.scrollTop,
      windowScrollY: window.scrollY,
    } as ViewportMetrics;
  }, { containerSelector, inputAreaSelector });
}

async function verifyViewportContract(
  page: Page,
  containerSelector: string,
  inputAreaSelector: string,
  expectsHiddenParent: boolean,
) {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForFunction((selector) => (
    document.querySelector(selector)?.getAttribute("data-keyboard-open") === "true"
  ), containerSelector);

  const openMetrics = await readMetrics(page, containerSelector, inputAreaSelector);
  console.log(JSON.stringify({ phase: "open", route: page.url(), ...openMetrics }));
  expect(Math.abs(openMetrics.container.bottom - openMetrics.visualViewportHeight)).toBeLessThanOrEqual(2);
  expect(Math.abs(openMetrics.inputArea.bottom - openMetrics.visualViewportHeight)).toBeLessThanOrEqual(2);
  expect(Number.parseFloat(openMetrics.inputAreaPaddingBottom)).toBeLessThanOrEqual(24);
  expect(openMetrics.windowScrollY).toBe(0);
  if (expectsHiddenParent) {
    expect(openMetrics.parentOverflowY).toBe("hidden");
    expect(openMetrics.parentScrollTop).toBe(0);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction((selector) => (
    document.querySelector(selector)?.getAttribute("data-keyboard-open") === "false"
  ), containerSelector);
  const restoredMetrics = await readMetrics(page, containerSelector, inputAreaSelector);
  console.log(JSON.stringify({ phase: "restored", route: page.url(), ...restoredMetrics }));
  expect(Math.abs(restoredMetrics.container.height - 844)).toBeLessThanOrEqual(2);
}

test("071 Free Chat과 Mission은 축소된 Visual Viewport 경계에 입력 영역을 맞춘다", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const childId = await loginAsChild(page, context);
  await dismissOverlays(page);

  await page.goto(`${DEV_BASE}/chat`, { waitUntil: "domcontentloaded" });
  await dismissOverlays(page);
  await openTextInput(page);
  await verifyViewportContract(
    page,
    '[data-ui="freechat-conversation-viewport"]',
    '[data-ui="freechat-input-area"]',
    true,
  );

  await page.goto(`${DEV_BASE}/child/missions?childId=${childId}`, { waitUntil: "domcontentloaded" });
  await dismissOverlays(page);
  await openTextInput(page);
  await verifyViewportContract(
    page,
    '[data-ui="mission-conversation-viewport"]',
    '[data-ui="mission-input-area"]',
    false,
  );
});
