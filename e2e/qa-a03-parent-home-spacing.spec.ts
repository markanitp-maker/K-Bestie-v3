import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

// 대표님 지정(a03.png) 부모 홈 세로 공백 3구간 축소 검증.
// 구간 간격을 getBoundingClientRect 로 실제 픽셀로 재고, 모바일·태블릿·PC 회귀를 함께 본다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/qa-a03";
const PARENT_USERNAME = "qatesti-dev";

function readQaPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  const envPath = path.join(process.cwd(), ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/^QA_TEST_PASSWORD=(.*)$/m);
  return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

test("부모 홈 세로 공백 3구간 측정 (모바일/태블릿/PC)", async ({ page }) => {
  test.setTimeout(240_000);
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(readQaPassword());
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/parent\/|\/$/, { timeout: 30_000 }).catch(() => {});

  const results: Record<string, unknown> = {};

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);

    const measured = await page.evaluate(() => {
      const cardOf = (text: string): HTMLElement | null => {
        const nodes = Array.from(document.querySelectorAll("h3, span, p, div"));
        const hit = nodes.find((n) => (n.textContent ?? "").trim() === text) as HTMLElement | undefined;
        if (!hit) return null;
        let node: HTMLElement | null = hit;
        while (node && node.parentElement) {
          const style = getComputedStyle(node);
          if (style.borderRadius && parseFloat(style.borderRadius) >= 14) return node;
          node = node.parentElement;
        }
        return hit;
      };

      // 공통 헤더는 <header> 태그가 아니다. 스크롤 컨테이너(overflow-y:auto)의 직전 형제가
      // 헤더 영역이므로, 카드의 스크롤 조상을 찾아 그 top 을 기준선으로 쓴다.
      const scrollParentOf = (el: HTMLElement | null): HTMLElement | null => {
        let node: HTMLElement | null = el;
        while (node && node.parentElement) {
          const style = getComputedStyle(node);
          if (style.overflowY === "auto" || style.overflowY === "scroll") return node;
          node = node.parentElement;
        }
        return null;
      };

      const guide = cardOf("오늘의 한마디");
      const firstInsight = cardOf("학교·학원 생활");
      const lastInsight = cardOf("반복 이야기");
      const growth = cardOf("키");

      const rect = (el: HTMLElement | null) => (el ? el.getBoundingClientRect() : null);
      const scroller = scrollParentOf(guide);
      const headerRect = scroller ? scroller.getBoundingClientRect() : null;
      const guideRect = rect(guide);
      const firstRect = rect(firstInsight);
      const lastRect = rect(lastInsight);
      const growthRect = rect(growth);

      return {
        found: {
          scroller: Boolean(scroller),
          guide: Boolean(guideRect),
          firstInsight: Boolean(firstRect),
          lastInsight: Boolean(lastRect),
          growth: Boolean(growthRect),
        },
        // 구간① = 스크롤 영역 상단(=헤더 바로 아래) ~ 오늘의 한마디 카드 상단
        gap1: headerRect && guideRect ? Math.round(guideRect.top - headerRect.top) : null,
        gap2: guideRect && firstRect ? Math.round(firstRect.top - guideRect.bottom) : null,
        gap3: lastRect && growthRect ? Math.round(growthRect.top - lastRect.bottom) : null,
        insightCardCount: Array.from(document.querySelectorAll("div")).filter((n) =>
          ["학교·학원 생활", "친구 관계", "마음 흐름", "관심사·취향", "공부 고민", "디지털·콘텐츠", "선생님·어른", "반복 이야기"]
            .includes((n.querySelector("span:nth-child(2)")?.textContent ?? "").trim())
        ).length,
      };
    });

    results[viewport.name] = measured;
    console.log(`[QA-a03] ${viewport.name}`, JSON.stringify(measured));
    await page.screenshot({ path: `${EVIDENCE_DIR}/${viewport.name}.png`, fullPage: false });
  }

  fs.writeFileSync(`${EVIDENCE_DIR}/results.json`, JSON.stringify(results, null, 2), "utf8");

  for (const viewport of VIEWPORTS) {
    const measured = results[viewport.name] as { gap1: number | null; gap2: number | null; gap3: number | null };
    for (const key of ["gap1", "gap2", "gap3"] as const) {
      const value = measured[key];
      expect(value, `${viewport.name} ${key} 측정 실패`).not.toBeNull();
      expect(value as number, `${viewport.name} ${key} 겹침`).toBeGreaterThanOrEqual(0);
      expect(value as number, `${viewport.name} ${key} 과도한 공백`).toBeLessThan(50);
    }
  }
});
