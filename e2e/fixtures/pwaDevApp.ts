import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { PwaUpdateProxy } from "../support/pwaUpdateProxy.js";

export interface PwaDevAppFixtures {
  pwaProxy: PwaUpdateProxy;
  twoPages: {
    context: BrowserContext;
    pageA: Page;
    pageB: Page;
  };
}

interface PwaQaEnvironment {
  childUsername: string;
  password: string;
  upstreamUrl: string;
}

const readRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the 078 DEV E2E`);
  }
  return value;
};

const readPwaQaEnvironment = (): PwaQaEnvironment => ({
  childUsername: readRequiredEnv("PWA_E2E_QA_CHILD_USERNAME"),
  password: readRequiredEnv("QA_TEST_PASSWORD"),
  upstreamUrl: readRequiredEnv("PWA_E2E_DEV_UPSTREAM"),
});

export const verifyUpstreamDevAvailable = async (
  upstreamUrl: string,
): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(upstreamUrl, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (response.status < 200 || response.status >= 500) {
      throw new Error(`DEV availability check returned HTTP ${response.status}`);
    }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown network error";
    throw new Error(`Deployed DEV is unavailable: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
};

export const loginAsQaChild = async (
  page: Page,
  origin: string,
): Promise<void> => {
  const qa = readPwaQaEnvironment();
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });

  const usernameInput = page.getByPlaceholder("아이 아이디를 입력하세요");
  const passwordInput = page.getByPlaceholder("비밀번호를 입력하세요");
  await usernameInput.waitFor({ state: "visible", timeout: 15_000 });
  await usernameInput.fill(qa.childUsername);
  await passwordInput.fill(qa.password);

  const loginButton = page.getByRole("button", { name: "로그인", exact: true });
  await expect(loginButton).toBeEnabled({ timeout: 10_000 });
  await loginButton.click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
};

interface ServiceWorkerIdentity {
  protocol: number;
  buildId: string;
  swVersion: string;
  workerNonce: string | null;
}

export const getSwIdentityFromPage = async (
  page: Page,
  target: "controller" | "waiting" = "controller",
): Promise<ServiceWorkerIdentity | null> =>
  page.evaluate(async (targetType) => {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    const worker =
      targetType === "waiting"
        ? registration?.waiting
        : navigator.serviceWorker.controller;
    if (!worker) return null;

    return new Promise<ServiceWorkerIdentity | null>((resolve) => {
      const channel = new MessageChannel();
      const requestNonce = crypto.randomUUID();
      const timer = setTimeout(() => resolve(null), 3_000);
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        clearTimeout(timer);
        const data = event.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          resolve(null);
          return;
        }
        const record = data as Record<string, unknown>;
        if (
          record.protocol !== 1 ||
          record.type !== "PWA_IDENTITY_RESPONSE" ||
          record.requestNonce !== requestNonce ||
          typeof record.buildId !== "string" ||
          typeof record.swVersion !== "string" ||
          typeof record.workerNonce !== "string"
        ) {
          resolve(null);
          return;
        }
        resolve({
          protocol: 1,
          buildId: record.buildId,
          swVersion: record.swVersion,
          workerNonce: record.workerNonce,
        });
      };
      worker.postMessage(
        {
          protocol: 1,
          type: "PWA_GET_IDENTITY",
          requestNonce,
        },
        [channel.port2],
      );
    });
  }, target);

export const waitForServiceWorkerController = async (
  page: Page,
  timeoutMs = 15_000,
): Promise<void> => {
  await page.waitForFunction(
    () => Boolean(navigator.serviceWorker?.controller),
    undefined,
    { timeout: timeoutMs },
  );
};

export const test = base.extend<PwaDevAppFixtures>({
  pwaProxy: async ({}, use) => {
    const qa = readPwaQaEnvironment();
    const proxy = new PwaUpdateProxy({ upstreamUrl: qa.upstreamUrl });
    await verifyUpstreamDevAvailable(proxy.upstreamOrigin);
    await proxy.start();
    proxy.resetFaults();
    try {
      await use(proxy);
    } finally {
      proxy.resetFaults();
      await proxy.stop();
    }
  },

  twoPages: async ({ browser, pwaProxy }, use) => {
    const context = await browser.newContext({
      baseURL: pwaProxy.origin,
      serviceWorkers: "allow",
      viewport: { width: 1280, height: 800 },
    });
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    try {
      await use({ context, pageA, pageB });
    } finally {
      await context.close();
    }
  },
});

export { expect };
