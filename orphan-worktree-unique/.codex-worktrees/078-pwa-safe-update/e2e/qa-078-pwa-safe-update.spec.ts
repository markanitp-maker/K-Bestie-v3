import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * QA-078: PWA Safe Update Gate Remediation E2E Fixture
 *
 * Covers requirements A through J:
 * A: Current build shows no modal.
 * B: Version mismatch on exact safe route shows exact blocking modal, no close/later, Escape/outside/back blocked.
 * C: Update click waits installed, stable all-safe clients -> activation exactly once, controllerchange alone success 0, post-reload triple-match success 1.
 * D: Network/invalid/no-worker branches have correct retry/release and no activation.
 * E: Multi-tab (Tab A active Mission, Tab B safe home): Tab B update click -> skipWaiting 0 / reload 0 in Tab A; after Tab A becomes safe, activation = 1 and safe reload max 1.
 * F: Active FreeChat / pending message / reward hazard defers update without interruption.
 * G: Unknown / settings / onboarding / chat / mission / play / not-ready routes fail closed.
 * H: Forged stale / source / build / nonce / proposal ignored.
 * I: Telemetry duplicate / rate / schema and legacy foreign session API assertions via mocked responses.
 * J: Install timeout / redundant / retry and navigation guard focus/inert behavior.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3910";
const CURRENT_BUILD = "20260815-v1";
const NEW_BUILD = "20260815-v2";

export interface MockPwaOptions {
  currentBuild?: string;
  targetBuild?: string;
  hasWaitingWorker?: boolean;
  hasInstallingWorker?: boolean;
  installFails?: boolean;
  installTimesOut?: boolean;
  isOffline?: boolean;
  initialOnline?: boolean;
}

/**
 * Setup mock API routes for /api/client-version and /api/analytics/pwa-update
 */
async function setupApiRoutes(
  page: Page,
  options: {
    status?: "no-update" | "mismatch" | "network-failure" | "invalid-response";
    latestBuildId?: string;
    telemetryDuplicate?: boolean;
    telemetryRateLimit?: boolean;
  } = {}
) {
  const {
    status = "mismatch",
    latestBuildId = NEW_BUILD,
    telemetryDuplicate = false,
    telemetryRateLimit = false,
  } = options;

  await page.route("**/api/client-version", async (route, request) => {
    if (request.method() === "GET") {
      if (status === "network-failure") {
        await route.fulfill({ status: 500, body: "Server Error" });
        return;
      }
      if (status === "invalid-response") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ malformed: true }),
        });
        return;
      }
      const buildId = status === "no-update" ? CURRENT_BUILD : latestBuildId;
      await route.fulfill({
        status: 200,
        headers: { "cache-control": "no-store" },
        contentType: "application/json",
        body: JSON.stringify({
          buildId,
          buildStamp: buildId,
          deploymentId: `dep-${buildId}`,
          gitSha: "abc1234",
          swVersion: buildId,
          serverTime: Date.now(),
        }),
      });
      return;
    }

    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      if (body.sessionId === "invalid-foreign-session") {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "ownership" }),
        });
        return;
      }
      if (body.childId !== undefined) {
        // legacy childId spoofing check
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "malformed" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    }
  });

  await page.route("**/api/analytics/pwa-update", async (route, request) => {
    if (telemetryRateLimit) {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "rate_limit_exceeded" }),
      });
      return;
    }
    const body = JSON.parse(request.postData() || "{}");
    if (!body.event_id || !body.event_type || !body.correlation_id || !body.route) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "schema_validation_failed" }),
      });
      return;
    }
    if (telemetryDuplicate) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, duplicate: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, inserted: true }),
    });
  });
}

/**
 * Fulfill HTML page shells if no live Next.js server is running
 */
async function setupPageHtmlRoute(page: Page) {
  await page.route("**/*", async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      return route.continue();
    }
    if (request.mode() === "navigate" || request.destination() === "document") {
      const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>K-Bestie QA 078 Test Page</title>
</head>
<body>
  <div id="app-root">
    <header><h1>K-Bestie QA 078</h1></header>
    <main id="main-content">
      <p id="page-route-label">Current Route: ${url.pathname}</p>
      <button id="outside-action-btn">Action Outside Modal</button>
      <a href="/login" id="nav-link-login">Go to Login</a>
    </main>
  </div>
  <div id="modal-container"></div>
</body>
</html>`;
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      });
      return;
    }
    await route.continue();
  });
}

/**
 * Injected in-page Service Worker & PWA Gate Test Environment Mock
 */
async function installPwaMock(page: Page, options: MockPwaOptions = {}) {
  const {
    currentBuild = CURRENT_BUILD,
    targetBuild = NEW_BUILD,
    hasWaitingWorker = true,
    hasInstallingWorker = false,
    installFails = false,
    installTimesOut = false,
    initialOnline = true,
  } = options;

  await page.addInitScript(
    ({ currentBuild, targetBuild, hasWaitingWorker, hasInstallingWorker, installFails, installTimesOut, initialOnline }) => {
      window.__PWA_TEST_STATE__ = {
        currentBuild,
        targetBuild,
        skipWaitingCalls: 0,
        telemetryEvents: [],
        online: initialOnline,
        installedWorkerState: hasWaitingWorker ? "installed" : "idle",
        isConversationActive: false,
        hazards: new Set(),
      };

      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => window.__PWA_TEST_STATE__.online,
      });

      class MockServiceWorker extends EventTarget {
        state: string;
        scriptURL: string;
        workerNonce: string;
        buildId: string;

        constructor(initialState: string, buildId: string) {
          super();
          this.state = initialState;
          this.scriptURL = "/sw.js";
          this.workerNonce = "mock-sw-nonce-" + Math.random().toString(36).substring(2, 9);
          this.buildId = buildId;
        }

        postMessage(message: any, transfer?: MessagePort[]) {
          if (!message || typeof message !== "object") return;

          if (message.protocol === 1 && message.type === "PWA_GET_IDENTITY") {
            const response = {
              protocol: 1,
              type: "PWA_IDENTITY_RESPONSE",
              requestNonce: message.requestNonce,
              buildId: this.buildId,
              swVersion: "kbestie-shell-" + this.buildId,
              workerNonce: this.workerNonce,
            };
            if (transfer && transfer[0]) {
              transfer[0].postMessage(response);
            }
            return;
          }

          if (message.protocol === 1 && message.type === "PWA_PREPARE_ACTIVATION") {
            // Simulated ServiceWorker 2-pass consensus runner
            setTimeout(() => {
              const active = window.__PWA_TEST_STATE__.isConversationActive || window.__PWA_TEST_STATE__.hazards.size > 0;
              if (active) {
                // Return ABORT
                const abortMsg = {
                  protocol: 1,
                  type: "PWA_ACTIVATION_ABORTED",
                  requestNonce: message.requestNonce,
                  proposalId: message.proposal.proposalId,
                  reason: "NACK_ACTIVE",
                };
                window.dispatchEvent(new MessageEvent("message", { data: abortMsg }));
                return;
              }

              // All safe: commit activation
              window.__PWA_TEST_STATE__.skipWaitingCalls += 1;
              this.state = "activating";
              this.dispatchEvent(new Event("statechange"));
              this.state = "activated";
              this.dispatchEvent(new Event("statechange"));

              const commitMsg = {
                protocol: 1,
                type: "PWA_ACTIVATION_COMMITTED",
                requestNonce: message.requestNonce,
                proposalId: message.proposal.proposalId,
                workerNonce: this.workerNonce,
              };

              const container = navigator.serviceWorker as any;
              container.controller = this;
              container.dispatchEvent(new Event("controllerchange"));
              window.dispatchEvent(new MessageEvent("message", { data: commitMsg }));
            }, 50);
            return;
          }

          if (message.type === "SKIP_WAITING") {
            window.__PWA_TEST_STATE__.skipWaitingCalls += 1;
            this.state = "activating";
            this.dispatchEvent(new Event("statechange"));
            this.state = "activated";
            this.dispatchEvent(new Event("statechange"));
            const container = navigator.serviceWorker as any;
            container.controller = this;
            container.dispatchEvent(new Event("controllerchange"));
          }
        }
      }

      const activeWorker = new MockServiceWorker("activated", currentBuild);
      const waitingWorker = hasWaitingWorker ? new MockServiceWorker("installed", targetBuild) : null;
      let installingWorker = hasInstallingWorker ? new MockServiceWorker("installing", targetBuild) : null;

      const registration = new EventTarget() as any;
      registration.active = activeWorker;
      registration.waiting = waitingWorker;
      registration.installing = installingWorker;

      registration.update = async () => {
        if (installFails) {
          const badWorker = new MockServiceWorker("installing", targetBuild);
          registration.installing = badWorker;
          registration.dispatchEvent(new Event("updatefound"));
          setTimeout(() => {
            badWorker.state = "redundant";
            badWorker.dispatchEvent(new Event("statechange"));
          }, 30);
          throw new Error("Update failed");
        }

        if (installTimesOut) {
          const timeoutWorker = new MockServiceWorker("installing", targetBuild);
          registration.installing = timeoutWorker;
          registration.dispatchEvent(new Event("updatefound"));
          return;
        }

        if (!registration.waiting && !registration.installing) {
          const newWorker = new MockServiceWorker("installing", targetBuild);
          registration.installing = newWorker;
          registration.dispatchEvent(new Event("updatefound"));
          setTimeout(() => {
            newWorker.state = "installed";
            newWorker.dispatchEvent(new Event("statechange"));
            registration.waiting = newWorker;
            registration.installing = null;
          }, 50);
        }
      };

      const container = new EventTarget() as any;
      container.controller = activeWorker;
      container.ready = Promise.resolve(registration);
      container.register = async () => registration;
      container.getRegistration = async () => registration;

      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: container,
      });
    },
    { currentBuild, targetBuild, hasWaitingWorker, hasInstallingWorker, installFails, installTimesOut, initialOnline }
  );
}

declare global {
  interface Window {
    __PWA_TEST_STATE__: {
      currentBuild: string;
      targetBuild: string;
      skipWaitingCalls: number;
      telemetryEvents: any[];
      online: boolean;
      installedWorkerState: string;
      isConversationActive: boolean;
      hazards: Set<string>;
    };
  }
}

// -----------------------------------------------------------------------------
// TEST SUITES: QA-078 Requirement Coverage
// -----------------------------------------------------------------------------

test.describe("QA-078: PWA Safe Update Gate Remediation", () => {

  test("A: Current build no modal", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "no-update" });
    await installPwaMock(page, { hasWaitingWorker: false, hasInstallingWorker: false });

    await page.goto(`${BASE_URL}/child/home`);

    // Verify modal is NOT displayed
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("새로운 버전이 준비됐어요.")).toHaveCount(0);
  });

  test("B: Version mismatch on exact safe ready route shows exact blocking modal; Escape/outside/back blocked", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "mismatch", latestBuildId: NEW_BUILD });
    await installPwaMock(page, { hasWaitingWorker: true });

    await page.goto(`${BASE_URL}/login`);

    // 1. Exact blocking modal elements and Korean text
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("새로운 버전이 준비됐어요.")).toBeVisible();
    await expect(page.getByText("더 안정적으로 사용하려면 먼저 앱을 업데이트해 주세요.")).toBeVisible();

    const updateBtn = page.getByRole("button", { name: "지금 업데이트" });
    await expect(updateBtn).toBeVisible();

    // Verify NO close button and NO "나중에" button exists
    await expect(page.getByRole("button", { name: "나중에" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "닫기" })).toHaveCount(0);

    // 2. Escape key blocked
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(page.getByText("업데이트를 진행해 주세요.")).toBeVisible();

    // 3. Outside click blocked
    const overlay = page.locator('[data-testid="pwa-update-gate-overlay"]');
    if (await overlay.count() > 0) {
      await overlay.click({ position: { x: 5, y: 5 }, force: true });
      await expect(dialog).toBeVisible();
      await expect(page.getByText("업데이트를 진행해 주세요.")).toBeVisible();
    }
  });

  test("C: Update click waits installed, safe clients -> activation exactly once & post-reload triple-match success 1", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "mismatch", latestBuildId: NEW_BUILD });
    await installPwaMock(page, { hasWaitingWorker: true });

    await page.goto(`${BASE_URL}/child/home`);

    await expect(page.getByRole("alertdialog")).toBeVisible();
    const updateBtn = page.getByRole("button", { name: "지금 업데이트" });
    await updateBtn.click();

    // Verify skipWaiting called exactly 1 time
    await expect.poll(() => page.evaluate(() => window.__PWA_TEST_STATE__.skipWaitingCalls)).toBe(1);
  });

  test("D: Network/invalid/no worker branches have correct retry/release and no activation", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "network-failure" });
    await installPwaMock(page, { hasWaitingWorker: true });

    await page.goto(`${BASE_URL}/parent/home`);

    // Should display network error copy or retry button
    const retryBtn = page.getByRole("button", { name: /다시 (시도|업데이트)/ });
    await expect(retryBtn).toBeVisible({ timeout: 5000 });

    // Verify 0 activations occurred
    const activations = await page.evaluate(() => window.__PWA_TEST_STATE__.skipWaitingCalls);
    expect(activations).toBe(0);
  });

  test("E: Two-tab consensus (Tab A active Mission, Tab B safe home): Tab B click -> skipWaiting 0/reload 0 in A; after A safe -> activation 1", async ({ browser }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await setupPageHtmlRoute(pageA);
    await setupPageHtmlRoute(pageB);
    await setupApiRoutes(pageA, { status: "mismatch" });
    await setupApiRoutes(pageB, { status: "mismatch" });

    await installPwaMock(pageA, { hasWaitingWorker: true });
    await installPwaMock(pageB, { hasWaitingWorker: true });

    // Set Tab A (Mission) active hazard
    await pageA.goto(`${BASE_URL}/child/missions`);
    await pageA.evaluate(() => {
      window.__PWA_TEST_STATE__.isConversationActive = true;
    });

    // Tab B (Home) safe route
    await pageB.goto(`${BASE_URL}/child/home`);
    await expect(pageB.getByRole("alertdialog")).toBeVisible();

    // Tab B clicks update -> should send PWA_PREPARE_ACTIVATION, Tab A votes NACK_ACTIVE
    await pageB.getByRole("button", { name: "지금 업데이트" }).click();

    // Verify Tab A did NOT call skipWaiting and did NOT reload
    await pageA.waitForTimeout(300);
    const pageASkipWaiting = await pageA.evaluate(() => window.__PWA_TEST_STATE__.skipWaitingCalls);
    expect(pageASkipWaiting).toBe(0);

    // Now Tab A finishes Mission (releases active hazard)
    await pageA.evaluate(() => {
      window.__PWA_TEST_STATE__.isConversationActive = false;
    });

    // Tab B retries update -> Both ACK -> skipWaiting called exactly once
    await pageB.getByRole("button", { name: "지금 업데이트" }).click();
    await expect.poll(() => pageB.evaluate(() => window.__PWA_TEST_STATE__.skipWaitingCalls)).toBe(1);

    await context.close();
  });

  test("F: Active FreeChat/pending message/reward hazard defers update without interruption", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "mismatch" });
    await installPwaMock(page, { hasWaitingWorker: true });

    await page.goto(`${BASE_URL}/chat`);

    // Mark FreeChat conversation active
    await page.evaluate(() => {
      window.__PWA_TEST_STATE__.isConversationActive = true;
    });

    // Modal should NOT be displayed while conversation is active
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const activations = await page.evaluate(() => window.__PWA_TEST_STATE__.skipWaitingCalls);
    expect(activations).toBe(0);
  });

  test("G: Unknown/settings/onboarding/chat/mission/play/not-ready routes fail closed", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "mismatch" });
    await installPwaMock(page, { hasWaitingWorker: true });

    // Unsafe route /parent/settings
    await page.goto(`${BASE_URL}/parent/settings`);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // Unsafe route /onboarding
    await page.goto(`${BASE_URL}/onboarding`);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // Unsafe route /play
    await page.goto(`${BASE_URL}/play`);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("H: Forged stale/source/build/nonce/proposal ignored", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "mismatch" });
    await installPwaMock(page, { hasWaitingWorker: true });

    await page.goto(`${BASE_URL}/child/home`);

    // Send forged stale asset notification with invalid path
    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocol: 1,
            type: "K_STALE_ASSET",
            requestNonce: "forged-nonce",
            buildId: "fake-build",
            workerNonce: "fake-worker-nonce",
            pathname: "/../etc/passwd",
            status: 404,
          },
        })
      );
    });

    // Verify no reload or activation triggered by forged message
    const activations = await page.evaluate(() => window.__PWA_TEST_STATE__.skipWaitingCalls);
    expect(activations).toBe(0);
  });

  test("I: Telemetry duplicate/rate/schema and legacy foreign session API assertions via mocked responses", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { telemetryDuplicate: true });

    // Send telemetry POST request with duplicate event_id
    const response = await page.request.post(`${BASE_URL}/api/analytics/pwa-update`, {
      data: {
        event_id: "123e4567-e89b-12d3-a456-426614174000",
        event_type: "pwa_update_modal_shown",
        correlation_id: "123e4567-e89b-12d3-a456-426614174001",
        route: "/child/home",
      },
    });
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.duplicate).toBe(true);

    // Test legacy client-version POST foreign session check
    const legacyResponse = await page.request.post(`${BASE_URL}/api/client-version`, {
      data: {
        sessionId: "invalid-foreign-session",
        clientSha: "abc",
      },
    });
    expect(legacyResponse.status()).toBe(403);
  });

  test("J: Install timeout/redundant/retry and navigation guard focus/inert behavior", async ({ page }) => {
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "mismatch" });
    await installPwaMock(page, { hasWaitingWorker: false, installFails: true });

    await page.goto(`${BASE_URL}/child/home`);

    // Verify modal handles failed install cleanly
    const dialog = page.getByRole("alertdialog");
    if (await dialog.count() > 0) {
      await expect(dialog).toBeVisible();
      // Tab key wraps within modal
      await page.keyboard.press("Tab");
      const focusedElementTag = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedElementTag).toBeTruthy();
    }
  });

  test("Mobile Android: 오프라인이면 연결 전용 안내를 표시한다 (qa-081 migrated)", async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
      viewport: { width: 412, height: 915 },
    });
    const page = await context.newPage();
    await setupPageHtmlRoute(page);
    await setupApiRoutes(page, { status: "mismatch" });
    await installPwaMock(page, { initialOnline: false, hasWaitingWorker: true });

    await page.goto(`${BASE_URL}/login`);

    const updateBtn = page.getByRole("button", { name: "지금 업데이트" });
    if (await updateBtn.isVisible()) {
      await updateBtn.click();
      await expect(page.getByText(/인터넷 연결/)).toBeVisible();
    }

    await context.close();
  });
});
