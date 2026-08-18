import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

// 부모 홈 2열 인사이트 카드의 summary 문구가 모바일 폭에서 불필요하게 두 줄로 떨어지는지 실측한다.
// 눈으로 보지 않고 요소 높이 / line-height 로 줄 수를 계산한다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/qa-insight-wrap";
const PARENT_USERNAME = BASE.includes("app.k-bestie.com") ? "qa-parent" : "qatesti-dev";

function readQaPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  const content = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const match = content.match(/^QA_TEST_PASSWORD=(.*)$/m);
  return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

// 대표 문구 2종을 실제 카드 폭에 넣어 줄 수를 잰다(계정 데이터와 무관하게 재현 가능하게).
const SAMPLE_TEXTS = ["친구와 보드게임하고 놀았음", "억울함과 답답함을 느꼈어요"];
const WIDTHS = [375, 390, 430];

test("모바일 폭별 인사이트 카드 문구 줄 수 실측", async ({ page }) => {
  test.setTimeout(240_000);
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(readQaPassword());
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/parent\/|\/$/, { timeout: 30_000 }).catch(() => {});

  const results: Record<string, unknown> = {};

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const measured = await page.evaluate((texts) => {
      const summary = Array.from(document.querySelectorAll("p")).find((p) =>
        /text-\[13px\]/.test(p.className)
      ) as HTMLElement | undefined;
      if (!summary) return { error: "summary 요소를 찾지 못함" };

      const card = summary.closest("div.relative") as HTMLElement | null;
      const style = getComputedStyle(summary);
      const lineHeight = parseFloat(style.lineHeight);
      const contentWidth = summary.getBoundingClientRect().width;

      // 대표 문구를 같은 스타일로 측정용 노드에 넣어 줄 수를 잰다(원본은 건드리지 않는다).
      const probe = document.createElement("p");
      probe.className = summary.className;
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.width = `${contentWidth}px`;
      summary.parentElement?.appendChild(probe);

      const lines: Record<string, number> = {};
      for (const text of texts) {
        probe.textContent = text;
        lines[text] = Math.round(probe.getBoundingClientRect().height / lineHeight);
      }
      probe.remove();

      // 실제 렌더된 모든 카드의 문구 줄 수와 겹침 여부도 함께 본다.
      const summaries = Array.from(document.querySelectorAll("p")).filter((p) =>
        /text-\[13px\]/.test(p.className)
      ) as HTMLElement[];
      const renderedLines = summaries.map((p) => ({
        text: (p.textContent ?? "").trim().slice(0, 24),
        lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)),
        overflow: p.getBoundingClientRect().bottom >
          (p.closest("div.relative") as HTMLElement | null)!.getBoundingClientRect().bottom + 1,
      }));

      return {
        cardWidth: Math.round(card?.getBoundingClientRect().width ?? 0),
        summaryWidth: Math.round(contentWidth),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        paddingLeft: card ? getComputedStyle(card).paddingLeft : null,
        sampleLines: lines,
        renderedLines,
        overflowCount: renderedLines.filter((r) => r.overflow).length,
      };
    }, SAMPLE_TEXTS);

    results[`w${width}`] = measured;
    console.log(`[QA-wrap] ${width}px`, JSON.stringify(measured));
    await page.screenshot({ path: `${EVIDENCE_DIR}/w${width}.png` });
  }

  fs.writeFileSync(`${EVIDENCE_DIR}/results.json`, JSON.stringify(results, null, 2), "utf8");

  for (const width of WIDTHS) {
    const measured = results[`w${width}`] as {
      sampleLines: Record<string, number>;
      overflowCount: number;
    };
    for (const text of SAMPLE_TEXTS) {
      expect(measured.sampleLines[text], `${width}px "${text}" 줄 수`).toBe(1);
    }
    expect(measured.overflowCount, `${width}px 카드 밖으로 넘친 문구`).toBe(0);
  }
});
