import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR_LOCAL = path.join(__dirname, "../evidence/qa-017");
const EVIDENCE_DIR_TMP = "/tmp/agy-qa-017";
const PARENT_USERNAME = "qatesti-dev";
const TARGET_CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const TARGET_CHILD_NAME = "QA_Child_A";

async function saveScreenshot(page: Page, filename: string) {
  const localPath = path.join(EVIDENCE_DIR_LOCAL, filename);
  const tmpPath = path.join(EVIDENCE_DIR_TMP, filename);
  await page.screenshot({ path: localPath, fullPage: false });
  await page.screenshot({ path: tmpPath, fullPage: false });
  console.log(`[QA] Saved screenshot: ${filename}`);
}

async function hideTelemetryOverlay(page: Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
    const nextjsPortal = document.querySelector("nextjs-portal");
    if (nextjsPortal) {
      (nextjsPortal as HTMLElement).style.display = "none";
    }
  }).catch(() => {});
}

test.describe("Growth UX Improvements E2E QA (Requests 016 & 017)", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR_LOCAL)) {
      fs.mkdirSync(EVIDENCE_DIR_LOCAL, { recursive: true });
    }
    if (!fs.existsSync(EVIDENCE_DIR_TMP)) {
      fs.mkdirSync(EVIDENCE_DIR_TMP, { recursive: true });
    }
  });

  test("Run full Growth UX Verification (Scenarios B, C, A, D, Mobile)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });

    // Login as parent
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
    await page.waitForURL(/\/parent\/|\/$/, { timeout: 20000 }).catch(() => {});

    // Navigate to /parent/home & set active child
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1000);

    await page.evaluate((cid) => {
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
      localStorage.setItem("k_child_id", cid);
      localStorage.setItem("selected_child_id", cid);
      localStorage.setItem("active_child_id", cid);
      try {
        const storeRaw = localStorage.getItem("k_store_v1");
        if (storeRaw) {
          const parsed = JSON.parse(storeRaw);
          parsed.activeChildId = cid;
          localStorage.setItem("k_store_v1", JSON.stringify(parsed));
        } else {
          localStorage.setItem("k_store_v1", JSON.stringify({ activeChildId: cid }));
        }
      } catch (e) {}
    }, TARGET_CHILD_ID);

    await page.reload({ waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1500);

    const modalClose = page.getByRole("button", { name: /확인|닫기|다시 보지 않기/ });
    if (await modalClose.count()) {
      await modalClose.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // Open growth modal (or setup modal if initial)
    const growthCard = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*키.*성장정보 열기|키.*성장정보|138\\.5cm|키.*기록 없음`) }).first();
    await growthCard.waitFor({ state: "visible", timeout: 10000 });
    await growthCard.click();
    await page.waitForTimeout(800);

    // If Initial Setup Modal is open (Scenario B & C flow)
    const setupModalHeading = page.getByRole("heading", { name: "우리 아이 성장정보 시작하기" });
    if (await setupModalHeading.isVisible().catch(() => false)) {
      // ── SCENARIO B ──
      await saveScreenshot(page, "01-scenario-b-setup-modal-initial.png");
      const consentItemCollect = page.getByText(/수집 항목/);
      expect(await consentItemCollect.isVisible().catch(() => false)).toBe(false);

      const checkbox = page.locator('input[type="checkbox"]');
      const laterBtn = page.getByRole("button", { name: "나중에 하기" });
      const startBtn = page.getByRole("button", { name: "동의하고 시작하기" });
      await expect(checkbox).toBeVisible();
      await expect(laterBtn).toBeVisible();
      await expect(startBtn).toBeVisible();

      const toggleConsentBtn = page.getByRole("button", { name: /내용 확인|내용보기/ });
      await toggleConsentBtn.click();
      await page.waitForTimeout(500);
      await saveScreenshot(page, "02-scenario-b-consent-expanded.png");
      expect(await page.getByText(/수집 항목/).first().isVisible().catch(() => false)).toBe(true);

      const collapseConsentBtn = page.getByRole("button", { name: /내용 접기|내용 닫기|내용 확인/ });
      await collapseConsentBtn.click();
      await page.waitForTimeout(500);
      expect(await page.getByText(/수집 항목/).first().isVisible().catch(() => false)).toBe(false);
      await saveScreenshot(page, "03-scenario-b-consent-collapsed-again.png");

      const manualBirthInput = page.locator("#birth-date-manual");
      if (await manualBirthInput.isVisible().catch(() => false)) {
        await manualBirthInput.fill("2015-03-10");
      }
      const femaleBtn = page.getByRole("button", { name: "여자", exact: true });
      if (await femaleBtn.isVisible().catch(() => false)) {
        await femaleBtn.click();
      }
      await checkbox.check();
      await saveScreenshot(page, "04-scenario-b-ready-to-submit.png");
      await startBtn.click();
      await page.waitForTimeout(1000);

      // ── SCENARIO C ──
      await saveScreenshot(page, "05-scenario-c-first-record-entry.png");
      const firstRecordHeading = page.getByRole("heading", { name: /첫 성장기록 입력|성장기록 입력/ });
      expect(await firstRecordHeading.isVisible().catch(() => false)).toBe(true);

      const allNumberInputs = page.locator('input[inputmode="decimal"], input[type="number"], input[placeholder*="."]');
      if ((await allNumberInputs.count()) >= 2) {
        await allNumberInputs.nth(0).fill("138.5");
        await allNumberInputs.nth(1).fill("32.4");
      }
      await saveScreenshot(page, "06-scenario-c-record-filled.png");

      const saveRecordBtn = page.getByRole("button", { name: /저장하고 성장정보 보기|저장하기|저장/ }).last();
      await saveRecordBtn.click();
      await page.waitForTimeout(1500);
      await saveScreenshot(page, "07-scenario-c-detail-modal-with-data.png");
    }

    // ── SCENARIO A: Header CTA ──
    const headerAddBtn = page.getByRole("button", { name: "새 기록 추가" }).first();
    await expect(headerAddBtn).toBeVisible();
    await saveScreenshot(page, "08-scenario-a-header-cta.png");

    const allAddBtns = page.getByRole("button", { name: "새 기록 추가" });
    expect(await allAddBtns.count()).toBe(1);

    await headerAddBtn.click();
    await page.waitForTimeout(500);
    await saveScreenshot(page, "09-scenario-a-input-ui-opened.png");

    const cancelFormBtn = page.getByRole("button", { name: "취소" });
    if (await cancelFormBtn.isVisible().catch(() => false)) {
      await cancelFormBtn.click();
      await page.waitForTimeout(500);
    }

    // ── SCENARIO D: Birth Date Change ──
    const detailModalHeading = page.getByRole("heading", { name: "우리 아이 성장정보" });
    await expect(detailModalHeading).toBeVisible();

    const editInfoLink = page.getByText("정보 변경");
    await expect(editInfoLink).toBeVisible();
    await saveScreenshot(page, "10-scenario-d-info-edit-entry.png");

    await editInfoLink.click();
    await page.waitForTimeout(500);
    await saveScreenshot(page, "11-scenario-d-edit-ui-opened.png");

    const manualInput = page.locator("#birth-date-manual, input[placeholder*='2016']").first();
    await expect(manualInput).toBeVisible();

    await manualInput.fill("2014-03-10");
    await page.waitForTimeout(300);
    await saveScreenshot(page, "12-scenario-d-edit-changed-2014.png");

    const saveBirthBtn = page.getByRole("button", { name: /저장|수정 완료|확인/ }).last();
    await saveBirthBtn.click();
    await page.waitForTimeout(1500);

    await saveScreenshot(page, "13-scenario-d-after-birth-change.png");

    // ── MOBILE VIEWPORT CHECK (375x812) ──
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(600);
    await saveScreenshot(page, "14-mobile-375x812-header.png");
  });
});
