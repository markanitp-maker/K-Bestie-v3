import type {
  BrowserContext,
  Page,
  Request,
  Response,
  Worker,
} from "@playwright/test";

import {
  expect,
  getSwIdentityFromPage,
  loginAsQaChild,
  test as pwaFixtureTest,
  verifyUpstreamDevAvailable,
  waitForServiceWorkerController,
} from "./fixtures/pwaDevApp.js";
import {
  PwaUpdateProxy,
  type PwaTargetConfig,
} from "./support/pwaUpdateProxy.js";
import {
  DOCUMENT_DEPLOYMENT_META_NAME,
  parseDocumentDeploymentMarker,
  type DocumentDeploymentMarkerV1,
} from "../lib/pwa/documentDeployment.js";
import {
  parseLatestVersionMetadata,
  type LatestVersionMetadataV1,
} from "../lib/pwa/clientVersion.js";

interface TargetPair {
  v1: PwaTargetConfig;
  v2: PwaTargetConfig;
}

interface E2eFixtures {
  pwaTargets: TargetPair;
}

interface TurnIdentity {
  sessionId: string;
  clientTurnId: string | null;
}

interface TelemetryObservation {
  eventId: string;
  eventType: string;
  latestVersion: string | null;
}

interface NetworkRecorder {
  paths: string[];
  clientVersionResponses: Array<{
    page: string;
    url: string;
    status: number;
    requestCacheControl: string;
    cacheControl: string;
    contentType: string;
    body: string;
  }>;
  serviceWorkerResponses: Array<{
    page: string;
    url: string;
    status: number;
    cacheControl: string;
    body: string;
  }>;
  successTelemetry: TelemetryObservation[];
  successTelemetryResponses: Array<{
    status: number;
    ok: boolean;
    duplicate: boolean | null;
  }>;
  stop: () => void;
}

interface NavigationRecorder {
  count: number;
  reset: () => void;
  stop: () => void;
}

const REQUIRED_ENV = [
  "PWA_E2E_QA_CHILD_USERNAME",
  "QA_TEST_PASSWORD",
  "PWA_E2E_DEV_UPSTREAM",
] as const;

const MISSION_TURN_PATH = "/api/mission/v3/turn";
const FREECHAT_MESSAGE_PATH = "/api/chat/messages";
const CLIENT_VERSION_PATH = "/api/client-version";
const UPDATE_TELEMETRY_PATH = "/api/analytics/pwa-update";

const readRequiredEnv = (name: (typeof REQUIRED_ENV)[number]): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the 078 real DEV E2E`);
  }
  return value;
};

const readRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const readRequestBody = (request: Request): Record<string, unknown> | null => {
  try {
    return readRecord(request.postDataJSON());
  } catch {
    return null;
  }
};

const readTurnIdentity = (request: Request): TurnIdentity => {
  const body = readRequestBody(request);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const clientTurnId =
    typeof body?.clientTurnId === "string" ? body.clientTurnId : null;
  expect(sessionId).not.toBe("");
  return { sessionId, clientTurnId };
};

const readLatestDevMetadata = async (
  upstreamUrl: string,
): Promise<LatestVersionMetadataV1> => {
  await verifyUpstreamDevAvailable(upstreamUrl);
  const response = await fetch(new URL(CLIENT_VERSION_PATH, upstreamUrl), {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Deployed DEV client-version preflight returned HTTP ${response.status}`,
    );
  }
  const parsed = parseLatestVersionMetadata(await response.json());
  if (!parsed) {
    throw new Error("Deployed DEV returned invalid LatestVersionMetadataV1");
  }
  return parsed;
};

const createTargets = (latest: LatestVersionMetadataV1): TargetPair => ({
  v1: {
    schemaVersion: 1,
    buildId: latest.buildId,
    buildStamp: latest.buildStamp,
    deploymentId: latest.deploymentId,
    swVersion: `${latest.swVersion}-e2e-v1`,
    serviceWorkerScriptUrl: "/sw.js",
  },
  v2: {
    schemaVersion: 1,
    buildId: latest.buildId,
    buildStamp: latest.buildStamp,
    deploymentId: latest.deploymentId,
    swVersion: `${latest.swVersion}-e2e-v2`,
    serviceWorkerScriptUrl: "/sw.js",
  },
});

const test = pwaFixtureTest.extend<E2eFixtures>({
  pwaTargets: async ({}, use) => {
    for (const name of REQUIRED_ENV) readRequiredEnv(name);
    const latest = await readLatestDevMetadata(
      readRequiredEnv("PWA_E2E_DEV_UPSTREAM"),
    );
    await use(createTargets(latest));
  },

  pwaProxy: async ({ pwaTargets }, use) => {
    const proxy = new PwaUpdateProxy({
      upstreamUrl: readRequiredEnv("PWA_E2E_DEV_UPSTREAM"),
      targets: pwaTargets,
    });
    await proxy.start();
    proxy.resetFaults();
    try {
      await use(proxy);
    } finally {
      proxy.resetFaults();
      await proxy.stop();
    }
  },
});

const createNetworkRecorder = (
  context: BrowserContext,
  pages: ReadonlyArray<{ name: string; page: Page }>,
): NetworkRecorder => {
  const paths: string[] = [];
  const successTelemetry: TelemetryObservation[] = [];
  const clientVersionResponses: NetworkRecorder["clientVersionResponses"] = [];
  const serviceWorkerResponses: NetworkRecorder["serviceWorkerResponses"] = [];
  const successTelemetryResponses: NetworkRecorder["successTelemetryResponses"] = [];
  const resolvePageName = (request: Request): string => {
    try {
      const requestPage = request.frame().page();
      return pages.find(({ page }) => page === requestPage)?.name ?? "unknown";
    } catch {
      return "service-worker";
    }
  };
  const requestListener = (request: Request): void => {
      const name = resolvePageName(request);
      const url = new URL(request.url());
      paths.push(`${name}:${request.method()}:${url.pathname}`);
      if (
        request.method() !== "POST" ||
        url.pathname !== UPDATE_TELEMETRY_PATH
      ) {
        return;
      }
      const body = readRequestBody(request);
      if (body?.event_type !== "pwa_update_success") return;
      successTelemetry.push({
        eventId: typeof body.event_id === "string" ? body.event_id : "",
        eventType: body.event_type,
        latestVersion:
          typeof body.latest_version === "string" ? body.latest_version : null,
      });
  };
  const responseListener = (response: Response): void => {
      const request = response.request();
      const name = resolvePageName(request);
      const responseUrl = new URL(response.url());
      if (
        request.method() === "GET" &&
        responseUrl.pathname === CLIENT_VERSION_PATH
      ) {
        void response
          .body()
          .then((body) => {
            clientVersionResponses.push({
              page: name,
              url: response.url(),
              status: response.status(),
              requestCacheControl:
                request.headers()["cache-control"] ?? "",
              cacheControl: response.headers()["cache-control"] ?? "",
              contentType: response.headers()["content-type"] ?? "",
              body: body.toString("utf8"),
            });
          })
          .catch(() => {});
      }
      if (
        request.method() === "GET" &&
        (responseUrl.pathname === "/sw.js" ||
          responseUrl.pathname === "/api/pwa/sw")
      ) {
        void response
          .body()
          .then((body) => {
            serviceWorkerResponses.push({
              page: name,
              url: response.url(),
              status: response.status(),
              cacheControl: response.headers()["cache-control"] ?? "",
              body: body.toString("utf8"),
            });
          })
          .catch(() => {});
      }
      if (
        request.method() !== "POST" ||
        new URL(request.url()).pathname !== UPDATE_TELEMETRY_PATH ||
        readRequestBody(request)?.event_type !== "pwa_update_success"
      ) {
        return;
      }
      void response
        .json()
        .then((value: unknown) => {
          const body = readRecord(value);
          successTelemetryResponses.push({
            status: response.status(),
            ok: body?.ok === true,
            duplicate:
              typeof body?.duplicate === "boolean" ? body.duplicate : null,
          });
        })
        .catch(() => {
          successTelemetryResponses.push({
            status: response.status(),
            ok: false,
            duplicate: null,
          });
        });
  };
  context.on("request", requestListener);
  context.on("response", responseListener);

  return {
    paths,
    clientVersionResponses,
    serviceWorkerResponses,
    successTelemetry,
    successTelemetryResponses,
    stop: () => {
      context.off("request", requestListener);
      context.off("response", responseListener);
    },
  };
};

const createNavigationRecorder = (page: Page): NavigationRecorder => {
  let count = 0;
  const listener = (frame: ReturnType<Page["mainFrame"]>): void => {
    if (frame === page.mainFrame()) count += 1;
  };
  page.on("framenavigated", listener);
  return {
    get count() {
      return count;
    },
    reset: () => {
      count = 0;
    },
    stop: () => page.off("framenavigated", listener),
  };
};

const waitForSuccessfulResponse = async (request: Request): Promise<void> => {
  const response = await request.response();
  expect(response, `No response for ${request.method()} ${request.url()}`).not.toBeNull();
  expect(response?.ok(), `HTTP ${response?.status()} for ${request.url()}`).toBe(true);
};

const readDocumentMarker = async (
  page: Page,
): Promise<DocumentDeploymentMarkerV1> => {
  const content = await page
    .locator(`meta[name="${DOCUMENT_DEPLOYMENT_META_NAME}"]`)
    .getAttribute("content");
  const parsed = parseDocumentDeploymentMarker(content);
  expect(parsed).not.toBeNull();
  return parsed as DocumentDeploymentMarkerV1;
};

const expectController = async (
  page: Page,
  target: PwaTargetConfig,
): Promise<void> => {
  await expect
    .poll(async () => getSwIdentityFromPage(page, "controller"), {
      timeout: 30_000,
    })
    .toMatchObject({
      buildId: target.buildId,
      swVersion: target.swVersion,
    });
};

const expectHomeReady = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(/\/child\/home(?:[/?#]|$)/, { timeout: 30_000 });
  await expect(page.getByText("케이와 친해지는 30일").first()).toBeVisible({
    timeout: 30_000,
  });
};

const bootAuthenticatedPair = async (
  context: BrowserContext,
  pageA: Page,
  pageB: Page,
  proxy: PwaUpdateProxy,
  targets: TargetPair,
): Promise<void> => {
  expect(context.pages()).toHaveLength(2);
  await loginAsQaChild(pageA, proxy.origin);
  await waitForServiceWorkerController(pageA);
  await expectController(pageA, targets.v1);
  await expectHomeReady(pageA);

  await pageB.goto(`${proxy.origin}/child/home`, {
    waitUntil: "domcontentloaded",
  });
  await waitForServiceWorkerController(pageB);
  await expectController(pageB, targets.v1);
  await expectHomeReady(pageB);

  const marker = await readDocumentMarker(pageB);
  expect(marker).toMatchObject({
    buildId: targets.v2.buildId,
    buildStamp: targets.v2.buildStamp,
    deploymentId: targets.v2.deploymentId,
  });
};

const waitForUpdateModalAfterTargetSwitch = async (
  context: BrowserContext,
  pageA: Page,
  pageB: Page,
  proxy: PwaUpdateProxy,
): Promise<Worker> => {
  await pageA.bringToFront();
  await pageB.waitForTimeout(5_200);
  const workerPromise = context.waitForEvent("serviceworker", {
    timeout: 30_000,
  });
  proxy.setLatestTarget("v2");
  proxy.setServiceWorkerTarget("v2");
  await pageB.bringToFront();
  // A real document reload remounts the product registrar. The test never calls
  // registration.update() itself; the deployed app discovers and installs v2.
  await pageB.reload({ waitUntil: "domcontentloaded" });
  await expectHomeReady(pageB);
  await expect(pageB.getByRole("alertdialog")).toBeVisible({ timeout: 30_000 });
  await expect(
    pageB.getByRole("button", { name: "업데이트", exact: true }),
  ).toBeEnabled();
  return workerPromise;
};

const expectHazardDefersActivation = async (
  pageA: Page,
  pageB: Page,
  targets: TargetPair,
  network: NetworkRecorder,
  navigationA: NavigationRecorder,
  navigationB: NavigationRecorder,
): Promise<void> => {
  const navigationBeforeA = navigationA.count;
  const navigationBeforeB = navigationB.count;
  await pageB
    .getByRole("button", { name: "업데이트", exact: true })
    .click();
  await expect(pageB.getByRole("alertdialog")).toBeVisible({ timeout: 20_000 });
  await expect(
    pageB.getByRole("button", { name: "다시 업데이트", exact: true }),
  ).toBeEnabled({ timeout: 20_000 });
  await expect(pageA.getByRole("alertdialog")).toBeHidden();
  await expectController(pageA, targets.v1);
  await expectController(pageB, targets.v1);
  expect(navigationA.count).toBe(navigationBeforeA);
  expect(navigationB.count).toBe(navigationBeforeB);
  expect(network.successTelemetry).toHaveLength(0);
};

const focusSafePageAndWaitForRetryModal = async (
  pageA: Page,
  pageB: Page,
): Promise<void> => {
  await pageA.bringToFront();
  await pageB.waitForTimeout(5_200);
  await pageB.bringToFront();
  await expect(pageB.getByRole("alertdialog")).toBeVisible({ timeout: 30_000 });
  await expect(
    pageB.getByRole("button", { name: /^(업데이트|다시 업데이트)$/ }),
  ).toBeEnabled();
};

const readPageUpdateRequests = (
  network: NetworkRecorder,
  pageName: string,
  afterIndex: number,
): string[] =>
  network.paths.slice(afterIndex).filter(
    (entry) =>
      entry === `${pageName}:GET:${CLIENT_VERSION_PATH}` ||
      entry.endsWith(":GET:/sw.js") ||
      entry.endsWith(":GET:/api/pwa/sw"),
  );

const activateOnSafePages = async (
  pageA: Page,
  pageB: Page,
  proxy: PwaUpdateProxy,
  targets: TargetPair,
  network: NetworkRecorder,
  navigationA: NavigationRecorder,
  navigationB: NavigationRecorder,
): Promise<void> => {
  await focusSafePageAndWaitForRetryModal(pageA, pageB);
  navigationA.reset();
  navigationB.reset();
  const requestIndex = network.paths.length;
  await pageB
    .getByRole("button", { name: /^(업데이트|다시 업데이트)$/ })
    .click();

  await expectController(pageA, targets.v2);
  await expectController(pageB, targets.v2);
  await expect(pageB.getByRole("alertdialog")).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => network.successTelemetry.length, { timeout: 20_000 }).toBe(1);
  await expect
    .poll(() => network.successTelemetryResponses.length, { timeout: 20_000 })
    .toBe(1);
  expect(network.successTelemetryResponses[0]).toMatchObject({
    status: 200,
    ok: true,
  });
  const updateRequests = readPageUpdateRequests(network, "B", requestIndex);
  const latestRequestIndex = updateRequests.indexOf(
    `B:GET:${CLIENT_VERSION_PATH}`,
  );
  const workerRequestIndex = updateRequests.findIndex(
    (entry) => entry.endsWith(":GET:/sw.js") || entry.endsWith(":GET:/api/pwa/sw"),
  );
  expect(latestRequestIndex).toBeGreaterThanOrEqual(0);
  expect(workerRequestIndex).toBeGreaterThan(latestRequestIndex);
  expect(navigationA.count).toBeLessThanOrEqual(1);
  expect(navigationB.count).toBeLessThanOrEqual(1);
  expectClientVersionCacheContract(network);

  const response = await pageB.request.get(
    `${proxy.origin}${CLIENT_VERSION_PATH}`,
    { headers: { "Cache-Control": "no-cache" } },
  );
  expect(response.ok()).toBe(true);
  const server = parseLatestVersionMetadata(await response.json());
  expect(server).not.toBeNull();
  const documentMarker = await readDocumentMarker(pageB);
  const controller = await getSwIdentityFromPage(pageB, "controller");
  const success = network.successTelemetry[0];
  expect(success.eventId).not.toBe("");
  expect(new Set(network.successTelemetry.map((event) => event.eventId)).size).toBe(1);
  expect(success.latestVersion).toBe(targets.v2.buildId);
  expect(server).toMatchObject({
    schemaVersion: 1,
    buildId: targets.v2.buildId,
    buildStamp: targets.v2.buildStamp,
    deploymentId: targets.v2.deploymentId,
    swVersion: targets.v2.swVersion,
    serviceWorkerScriptUrl: targets.v2.serviceWorkerScriptUrl,
  });
  expect(documentMarker).toMatchObject({
    buildId: targets.v2.buildId,
    buildStamp: targets.v2.buildStamp,
    deploymentId: targets.v2.deploymentId,
  });
  expect(controller).toMatchObject({
    buildId: targets.v2.buildId,
    swVersion: targets.v2.swVersion,
  });
};

const waitForMissionSendReady = async (page: Page): Promise<void> => {
  const input = page.getByPlaceholder("케이에게 텍스트로 답하기...");
  await expect(input).toBeVisible({ timeout: 45_000 });

  const resumeButton = page.getByRole("button", {
    name: /▶️?\s*미션 이어하기/,
  });
  const statusPanel = page.locator('[data-ui="text-mode-voice-state"]');

  await expect
    .poll(
      async () => {
        if (await resumeButton.isVisible().catch(() => false)) {
          await resumeButton.click().catch(() => {});
        }
        const text = (await statusPanel.textContent().catch(() => "")) ?? "";
        return text.includes("대기 중");
      },
      { timeout: 45_000, intervals: [200, 500, 1000] },
    )
    .toBe(true);

  await expect(input).toBeEnabled({ timeout: 10_000 });
};

const enterMissionTextMode = async (page: Page, origin: string): Promise<void> => {
  await page.goto(`${origin}/child/missions`, { waitUntil: "domcontentloaded" });
  const entryButton = page.getByRole("button", {
    name: /새 미션 시작하기|진행 중인 미션 이어하기/,
  });
  await expect(entryButton).toBeVisible({ timeout: 45_000 });
  await entryButton.click();
  const textModeButton = page.getByRole("button", {
    name: "텍스트로 답하기",
    exact: true,
  });
  await expect(textModeButton).toBeVisible({ timeout: 45_000 });
  await expect(textModeButton).toBeEnabled({ timeout: 45_000 });
  await textModeButton.click();
  await expect(
    page.getByPlaceholder("케이에게 텍스트로 답하기..."),
  ).toBeVisible({ timeout: 45_000 });
  await waitForMissionSendReady(page);
};

const sendMissionText = async (page: Page, text: string): Promise<Request> => {
  await waitForMissionSendReady(page);
  const input = page.getByPlaceholder("케이에게 텍스트로 답하기...");
  await input.fill(text);
  const sendButton = page.getByRole("button", { name: "전송", exact: true });
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === MISSION_TURN_PATH,
    { timeout: 45_000 },
  );
  await sendButton.click();
  return requestPromise;
};

const enterFreeChatTextMode = async (page: Page, origin: string): Promise<void> => {
  await page.goto(`${origin}/chat`, { waitUntil: "domcontentloaded" });
  const startButton = page.getByRole("button", {
    name: "케이와 대화 시작하기",
    exact: true,
  });
  await expect(startButton).toBeVisible({ timeout: 45_000 });
  await startButton.click();
  const textModeButton = page.getByRole("button", {
    name: "텍스트로 답하기",
    exact: true,
  });
  await expect(textModeButton).toBeVisible({ timeout: 45_000 });
  await expect(textModeButton).toBeEnabled({ timeout: 45_000 });
  await textModeButton.click();
  await expect(
    page.getByPlaceholder("케이에게 텍스트로 답하기..."),
  ).toBeVisible();
};

const sendFreeChatText = async (page: Page, text: string): Promise<Request> => {
  const requestPromise = page.waitForRequest(
    (request) => {
      if (
        request.method() !== "POST" ||
        new URL(request.url()).pathname !== FREECHAT_MESSAGE_PATH
      ) {
        return false;
      }
      return readRequestBody(request)?.role === "child";
    },
    { timeout: 45_000 },
  );
  const input = page.getByPlaceholder("케이에게 텍스트로 답하기...");
  await input.fill(text);
  await page.getByRole("button", { name: "전송", exact: true }).click();
  return requestPromise;
};

const exitConversationToHome = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "뒤로가기", exact: true }).click();
  await expectHomeReady(page);
};

const expectRetryableVerificationFailure = async (
  page: Page,
  network: NetworkRecorder,
): Promise<void> => {
  const retryButton = page.getByRole("button", {
    name: "다시 업데이트",
    exact: true,
  });
  await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 30_000 });
  await expect(retryButton).toBeEnabled();
  expect(network.successTelemetry).toHaveLength(0);
};

const expectLatestResponse = async (
  network: NetworkRecorder,
  status: number,
  afterIndex: number,
): Promise<NetworkRecorder["clientVersionResponses"][number]> => {
  await expect
    .poll(
      () =>
        network.clientVersionResponses.slice(afterIndex).filter(
          (response) => response.status === status,
        ).length,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  const response = network.clientVersionResponses.slice(afterIndex).findLast(
    (entry) => entry.status === status,
  );
  expect(response).toBeDefined();
  expect(new URL(response?.url ?? "http://invalid").pathname).toBe(
    CLIENT_VERSION_PATH,
  );
  expect(response?.requestCacheControl).toMatch(/(?:no-cache|no-store)/);
  expect(response?.cacheControl).toContain("no-store");
  return response as NetworkRecorder["clientVersionResponses"][number];
};

const expectClientVersionCacheContract = (
  network: NetworkRecorder,
): void => {
  expect(network.clientVersionResponses.length).toBeGreaterThan(0);
  for (const response of network.clientVersionResponses) {
    expect(new URL(response.url).pathname).toBe(CLIENT_VERSION_PATH);
    expect(response.requestCacheControl).toMatch(/(?:no-cache|no-store)/);
    expect(response.cacheControl).toContain("no-store");
  }
};

const forceExternalWaitingWorkerActivation = async (
  worker: Worker,
): Promise<void> => {
  // Explicit external-controller fault injector only. Normal NACK/success paths
  // never call worker APIs and use the product modal/button exclusively.
  await worker.evaluate(async () => {
    const scope = globalThis as unknown as {
      skipWaiting: () => Promise<void>;
    };
    await scope.skipWaiting();
  });
};

test.describe.serial("078 PWA safe update - real deployed DEV UI", () => {
  test.setTimeout(240_000);

  test("Mission in-flight turn blocks activation, preserves the session, then activates once on safe UI", async ({
    twoPages,
    pwaProxy,
    pwaTargets,
  }) => {
    const { context, pageA, pageB } = twoPages;
    const network = createNetworkRecorder(context, [
      { name: "A", page: pageA },
      { name: "B", page: pageB },
    ]);
    const navigationA = createNavigationRecorder(pageA);
    const navigationB = createNavigationRecorder(pageB);
    try {
      await bootAuthenticatedPair(
        context,
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
      );
      await enterMissionTextMode(pageA, pwaProxy.origin);
      const firstText = `오늘 가장 재미있었던 일은 친구와 이야기한 거야 ${Date.now()}`;
      const firstRequest = await sendMissionText(pageA, firstText);
      const firstTurn = readTurnIdentity(firstRequest);

      await waitForUpdateModalAfterTargetSwitch(
        context,
        pageA,
        pageB,
        pwaProxy,
      );
      await expectHazardDefersActivation(
        pageA,
        pageB,
        pwaTargets,
        network,
        navigationA,
        navigationB,
      );

      await waitForSuccessfulResponse(firstRequest);
      const secondRequest = await sendMissionText(
        pageA,
        `그리고 다음에는 같이 운동장에서도 놀고 싶어 ${Date.now()}`,
      );
      await waitForSuccessfulResponse(secondRequest);
      const secondTurn = readTurnIdentity(secondRequest);
      expect(secondTurn.sessionId).toBe(firstTurn.sessionId);
      expect(secondTurn.clientTurnId).not.toBe(firstTurn.clientTurnId);

      await exitConversationToHome(pageA);
      await activateOnSafePages(
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
        network,
        navigationA,
        navigationB,
      );
      expect(network.paths).toContain(`A:POST:${MISSION_TURN_PATH}`);
      expect(
        network.paths.some(
          (entry) =>
            entry.endsWith(":GET:/sw.js") ||
            entry.endsWith(":GET:/api/pwa/sw"),
        ),
      ).toBe(true);
    } finally {
      pwaProxy.resetFaults();
      navigationA.stop();
      navigationB.stop();
      network.stop();
    }
  });

  test("Free Chat pending message blocks activation, keeps the same session, then activates once after real exit", async ({
    twoPages,
    pwaProxy,
    pwaTargets,
  }) => {
    const { context, pageA, pageB } = twoPages;
    const network = createNetworkRecorder(context, [
      { name: "A", page: pageA },
      { name: "B", page: pageB },
    ]);
    const navigationA = createNavigationRecorder(pageA);
    const navigationB = createNavigationRecorder(pageB);
    try {
      await bootAuthenticatedPair(
        context,
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
      );
      await enterFreeChatTextMode(pageA, pwaProxy.origin);
      const firstRequest = await sendFreeChatText(
        pageA,
        `오늘은 만들기 놀이를 해서 신났어 ${Date.now()}`,
      );
      const firstTurn = readTurnIdentity(firstRequest);

      await waitForUpdateModalAfterTargetSwitch(
        context,
        pageA,
        pageB,
        pwaProxy,
      );
      await expectHazardDefersActivation(
        pageA,
        pageB,
        pwaTargets,
        network,
        navigationA,
        navigationB,
      );

      await waitForSuccessfulResponse(firstRequest);
      const secondRequest = await sendFreeChatText(
        pageA,
        `다음에는 종이로 큰 로봇도 만들어 보고 싶어 ${Date.now()}`,
      );
      await waitForSuccessfulResponse(secondRequest);
      const secondTurn = readTurnIdentity(secondRequest);
      expect(secondTurn.sessionId).toBe(firstTurn.sessionId);

      await exitConversationToHome(pageA);
      await activateOnSafePages(
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
        network,
        navigationA,
        navigationB,
      );
      expect(network.paths).toContain(`A:POST:${FREECHAT_MESSAGE_PATH}`);
    } finally {
      pwaProxy.resetFaults();
      navigationA.stop();
      navigationB.stop();
      network.stop();
    }
  });

  test("5xx latest verification retains the blocking modal with zero success and a working retry", async ({
    twoPages,
    pwaProxy,
    pwaTargets,
  }) => {
    const { context, pageA, pageB } = twoPages;
    const network = createNetworkRecorder(context, [
      { name: "A", page: pageA },
      { name: "B", page: pageB },
    ]);
    const navigationA = createNavigationRecorder(pageA);
    const navigationB = createNavigationRecorder(pageB);
    try {
      await bootAuthenticatedPair(
        context,
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
      );
      await waitForUpdateModalAfterTargetSwitch(
        context,
        pageA,
        pageB,
        pwaProxy,
      );
      const responseIndex = network.clientVersionResponses.length;
      const requestIndex = network.paths.length;
      const navigationBeforeA = navigationA.count;
      const navigationBeforeB = navigationB.count;
      pwaProxy.setClientVersionMode("http-503");
      await pageB
        .getByRole("button", { name: "업데이트", exact: true })
        .click();
      await expectRetryableVerificationFailure(pageB, network);
      const failedResponse = await expectLatestResponse(
        network,
        503,
        responseIndex,
      );
      expect(failedResponse.contentType).toContain("application/json");
      expect(JSON.parse(failedResponse.body)).toEqual({
        error: "client-version unavailable",
      });
      expect(readPageUpdateRequests(network, "B", requestIndex)).toEqual([
        `B:GET:${CLIENT_VERSION_PATH}`,
      ]);
      await expectController(pageA, pwaTargets.v1);
      await expectController(pageB, pwaTargets.v1);
      expect(navigationA.count).toBe(navigationBeforeA);
      expect(navigationB.count).toBe(navigationBeforeB);

      pwaProxy.setClientVersionMode("normal");
      await activateOnSafePages(
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
        network,
        navigationA,
        navigationB,
      );
    } finally {
      pwaProxy.resetFaults();
      navigationA.stop();
      navigationB.stop();
      network.stop();
    }
  });

  test("Malformed latest metadata retains the blocking modal with zero success and a working retry", async ({
    twoPages,
    pwaProxy,
    pwaTargets,
  }) => {
    const { context, pageA, pageB } = twoPages;
    const network = createNetworkRecorder(context, [
      { name: "A", page: pageA },
      { name: "B", page: pageB },
    ]);
    const navigationA = createNavigationRecorder(pageA);
    const navigationB = createNavigationRecorder(pageB);
    try {
      await bootAuthenticatedPair(
        context,
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
      );
      await waitForUpdateModalAfterTargetSwitch(
        context,
        pageA,
        pageB,
        pwaProxy,
      );
      const responseIndex = network.clientVersionResponses.length;
      const requestIndex = network.paths.length;
      const navigationBeforeA = navigationA.count;
      const navigationBeforeB = navigationB.count;
      pwaProxy.setClientVersionMode("malformed-json");
      await pageB
        .getByRole("button", { name: "업데이트", exact: true })
        .click();
      await expectRetryableVerificationFailure(pageB, network);
      const malformedResponse = await expectLatestResponse(
        network,
        200,
        responseIndex,
      );
      expect(malformedResponse.contentType).toContain("application/json");
      expect(() => JSON.parse(malformedResponse.body)).toThrow();
      expect(readPageUpdateRequests(network, "B", requestIndex)).toEqual([
        `B:GET:${CLIENT_VERSION_PATH}`,
      ]);
      await expectController(pageA, pwaTargets.v1);
      await expectController(pageB, pwaTargets.v1);
      expect(navigationA.count).toBe(navigationBeforeA);
      expect(navigationB.count).toBe(navigationBeforeB);

      pwaProxy.setClientVersionMode("normal");
      await activateOnSafePages(
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
        network,
        navigationA,
        navigationB,
      );
    } finally {
      pwaProxy.resetFaults();
      navigationA.stop();
      navigationB.stop();
      network.stop();
    }
  });

  test("Controller identity mismatch retains the marker-backed modal with zero success and a working retry", async ({
    twoPages,
    pwaProxy,
    pwaTargets,
  }) => {
    const { context, pageA, pageB } = twoPages;
    const network = createNetworkRecorder(context, [
      { name: "A", page: pageA },
      { name: "B", page: pageB },
    ]);
    const navigationA = createNavigationRecorder(pageA);
    const navigationB = createNavigationRecorder(pageB);
    try {
      await bootAuthenticatedPair(
        context,
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
      );
      await waitForUpdateModalAfterTargetSwitch(
        context,
        pageA,
        pageB,
        pwaProxy,
      );
      const responseIndex = network.clientVersionResponses.length;
      const workerIndex = network.serviceWorkerResponses.length;
      const requestIndex = network.paths.length;
      const navigationBeforeA = navigationA.count;
      const navigationBeforeB = navigationB.count;
      pwaProxy.setLatestTarget("v2");
      pwaProxy.setServiceWorkerTarget("v1");
      await pageB
        .getByRole("button", { name: "업데이트", exact: true })
        .click();
      await expectRetryableVerificationFailure(pageB, network);
      const latestResponse = await expectLatestResponse(
        network,
        200,
        responseIndex,
      );
      expect(JSON.parse(latestResponse.body)).toEqual(pwaTargets.v2);
      await expect
        .poll(
          () =>
            network.serviceWorkerResponses
              .slice(workerIndex)
              .filter((response) =>
                response.body.includes(pwaTargets.v1.swVersion),
              ).length,
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
      const wrongWorkerResponse = network.serviceWorkerResponses
        .slice(workerIndex)
        .findLast((response) =>
          response.body.includes(pwaTargets.v1.swVersion),
        );
      expect(wrongWorkerResponse).toBeDefined();
      expect(new URL(wrongWorkerResponse?.url ?? "http://invalid").pathname).toMatch(
        /^\/(?:sw\.js|api\/pwa\/sw)$/,
      );
      expect(wrongWorkerResponse?.status).toBe(200);
      expect(wrongWorkerResponse?.cacheControl).toContain("no-store");
      const updateRequests = readPageUpdateRequests(network, "B", requestIndex);
      const latestRequestIndex = updateRequests.indexOf(
        `B:GET:${CLIENT_VERSION_PATH}`,
      );
      const workerRequestIndex = updateRequests.findIndex(
        (entry) =>
          entry.endsWith(":GET:/sw.js") || entry.endsWith(":GET:/api/pwa/sw"),
      );
      expect(latestRequestIndex).toBeGreaterThanOrEqual(0);
      expect(workerRequestIndex).toBeGreaterThan(latestRequestIndex);
      await expectController(pageA, pwaTargets.v1);
      await expectController(pageB, pwaTargets.v1);
      expect(navigationA.count).toBe(navigationBeforeA);
      expect(navigationB.count).toBe(navigationBeforeB);

      pwaProxy.setServiceWorkerTarget("v2");
      await activateOnSafePages(
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
        network,
        navigationA,
        navigationB,
      );
    } finally {
      pwaProxy.resetFaults();
      navigationA.stop();
      navigationB.stop();
      network.stop();
    }
  });

  test("An externally activated real waiting worker defers on active Mission and reconciles after safe return", async ({
    twoPages,
    pwaProxy,
    pwaTargets,
  }) => {
    const { context, pageA, pageB } = twoPages;
    const network = createNetworkRecorder(context, [
      { name: "A", page: pageA },
      { name: "B", page: pageB },
    ]);
    const navigationA = createNavigationRecorder(pageA);
    try {
      await bootAuthenticatedPair(
        context,
        pageA,
        pageB,
        pwaProxy,
        pwaTargets,
      );
      await enterMissionTextMode(pageA, pwaProxy.origin);
      const firstRequest = await sendMissionText(
        pageA,
        `지금 미션 대화를 계속하고 있어 ${Date.now()}`,
      );
      const firstTurn = readTurnIdentity(firstRequest);
      const waitingWorker = await waitForUpdateModalAfterTargetSwitch(
        context,
        pageA,
        pageB,
        pwaProxy,
      );

      const navigationBefore = navigationA.count;
      await forceExternalWaitingWorkerActivation(waitingWorker);
      await expectController(pageA, pwaTargets.v2);
      await pageA.waitForTimeout(1_000);
      expect(navigationA.count).toBe(navigationBefore);
      await expect(pageA.getByRole("alertdialog")).toBeHidden();
      expect(network.successTelemetry).toHaveLength(0);

      await waitForSuccessfulResponse(firstRequest);
      const secondRequest = await sendMissionText(
        pageA,
        `컨트롤러가 바뀌어도 같은 미션에서 계속 말할 수 있어 ${Date.now()}`,
      );
      await waitForSuccessfulResponse(secondRequest);
      expect(readTurnIdentity(secondRequest).sessionId).toBe(firstTurn.sessionId);

      await exitConversationToHome(pageA);
      await expect(pageA.getByRole("alertdialog")).toBeHidden({ timeout: 20_000 });
      await pageA.getByRole("link", { name: /미션 진행/ }).click();
      const resumeButton = pageA.getByRole("button", {
        name: /진행 중인 미션 이어하기/,
      });
      await expect(resumeButton).toBeVisible({ timeout: 30_000 });
      await resumeButton.click();
      await expect(
        pageA.getByRole("button", {
          name: "텍스트로 답하기",
          exact: true,
        }),
      ).toBeVisible({ timeout: 30_000 });
      expect(network.successTelemetry).toHaveLength(0);
      expectClientVersionCacheContract(network);
    } finally {
      pwaProxy.resetFaults();
      navigationA.stop();
      network.stop();
    }
  });
});
