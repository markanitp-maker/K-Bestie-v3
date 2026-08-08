import { expect, test, type Page } from "@playwright/test";

type PwaMock = {
  online: boolean;
  postMessageCount: number;
  updateCount: number;
};

async function installPwaMock(page: Page, online = true) {
  await page.addInitScript(({ initialOnline }) => {
    class MockWorker extends EventTarget {
      state = "installed";

      postMessage(message: { type?: string }) {
        if (message.type === "SKIP_WAITING") {
          window.__pwaMock.postMessageCount += 1;
          this.state = "activating";
          this.dispatchEvent(new Event("statechange"));
        }
      }
    }

    const worker = new MockWorker();
    const registration = new EventTarget() as EventTarget & {
      waiting: MockWorker | null;
      installing: MockWorker | null;
      active: object;
      update: () => Promise<void>;
    };
    registration.waiting = worker;
    registration.installing = null;
    registration.active = {};
    registration.update = async () => {
      window.__pwaMock.updateCount += 1;
    };

    const container = new EventTarget() as EventTarget & {
      controller: object;
      ready: Promise<typeof registration>;
      register: () => Promise<typeof registration>;
      getRegistration: () => Promise<typeof registration>;
    };
    container.controller = {};
    container.ready = Promise.resolve(registration);
    container.register = async () => registration;
    container.getRegistration = async () => registration;

    window.__pwaMock = {
      online: initialOnline,
      postMessageCount: 0,
      updateCount: 0,
    };
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => window.__pwaMock.online,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
  }, { initialOnline: online });
}

declare global {
  interface Window {
    __pwaMock: PwaMock;
  }
}

test("Desktop: 3초 경과를 실패로 오인하지 않고 실제 지연만 별도 안내한다", async ({ page }) => {
  await installPwaMock(page);
  await page.goto("/login");

  await expect(page.getByText("새로운 버전이 준비됐어요.")).toBeVisible();
  await page.getByRole("button", { name: "지금 업데이트" }).click();
  await expect.poll(() => page.evaluate(() => window.__pwaMock.postMessageCount)).toBe(1);

  await page.waitForTimeout(3_500);
  await expect(page.getByText("새 버전을 적용하지 못했어요.")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await expect(page.getByText("새 버전 적용이 조금 늦어지고 있어요.")).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText(/현재 버전은 계속 사용할 수 있습니다/)).toBeVisible();
});

test("Android: 오프라인이면 현재 앱을 유지하며 연결 전용 안내를 표시한다", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
  });
  const page = await context.newPage();
  await installPwaMock(page);
  await page.goto("/login");
  await page.evaluate(() => { window.__pwaMock.online = false; });
  await page.getByRole("button", { name: "지금 업데이트" }).click();

  await expect(page.getByText("인터넷 연결이 끊겨 있어 업데이트할 수 없어요.")).toBeVisible();
  await expect(page.getByText(/현재 버전은 계속 사용할 수 있습니다/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pwaMock.postMessageCount)).toBe(0);
  await context.close();
});

test("iOS: 나중에 닫은 뒤 foreground 재확인에도 cooldown 동안 반복 노출하지 않는다", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await installPwaMock(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "나중에" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => page.evaluate(() => window.__pwaMock.updateCount)).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await context.close();
});
