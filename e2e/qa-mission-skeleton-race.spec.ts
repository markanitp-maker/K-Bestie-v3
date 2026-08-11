import { expect, test, type Page, type Route } from "@playwright/test";

type MissionMockOptions = {
  resumed?: boolean;
  chatStatus?: number;
  startDelayMs?: number;
  shouldHang?: () => boolean;
  onStart?: (body: Record<string, unknown>) => void;
  startResponse?: (body: Record<string, unknown>, call: number) => Record<string, unknown>;
};

const CHILD_ID = "mission-skeleton-race-fixture";
const MISSION_URL = `/child/missions?childId=${CHILD_ID}&roundType=round1_day`;

const question = (roundType = "round1_day") => ({
  id: `question-${roundType}`,
  question_text: roundType === "round2_night" ? "최신 요청 질문" : "오늘 학교는 어땠어?",
  dashboard_area_tag: "daily",
  cycle_type: "daily",
  round_type: roundType,
});

const missionResponse = (resumed: boolean, roundType = "round1_day") => ({
  resumed,
  sessionId: `session-${roundType}`,
  questions: [question(roundType)],
  questionStates: resumed ? { [`question-${roundType}`]: "pending" } : undefined,
  validAnswerCount: resumed ? 1 : 0,
  progressPercent: resumed ? 20 : 0,
  requiredCount: 5,
  completed: false,
  engine_version: "v1",
  voiceMode: "stt_tts",
  liveVoiceName: "Achernar",
  childContext: null,
});

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  try {
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  } catch {
    // AbortController로 취소된 stale 요청은 브라우저가 먼저 연결을 닫을 수 있다.
  }
}

async function installMissionMocks(page: Page, options: MissionMockOptions = {}) {
  let startCalls = 0;
  let creatingCalls = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/config/child-time-restrictions") {
      await fulfillJson(route, {
        enabled: false,
        scheduleEnforced: false,
        activeRound: "round1_day",
      });
      return;
    }

    if (url.pathname === "/api/mission/start") {
      startCalls += 1;
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      if (body.checkOnly === false) creatingCalls += 1;
      options.onStart?.(body);

      if (options.shouldHang?.()) {
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      } else if (options.startDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.startDelayMs));
      }

      const roundType = typeof body.roundType === "string" ? body.roundType : "round1_day";
      const response = options.startResponse?.(body, startCalls)
        ?? missionResponse(options.resumed ?? false, roundType);
      await fulfillJson(route, response);
      return;
    }

    if (url.pathname === "/api/chat/messages" && request.method() === "GET") {
      await fulfillJson(
        route,
        options.chatStatus === 500 ? { error: "history unavailable" } : { messages: [] },
        options.chatStatus ?? 200,
      );
      return;
    }

    await fulfillJson(route, {});
  });

  return {
    startCalls: () => startCalls,
    creatingCalls: () => creatingCalls,
  };
}

async function expectNoSkeleton(page: Page): Promise<void> {
  await expect(page.getByText("미션 상태를 확인하지 못했어요")).not.toBeVisible();
  await expect(page.getByText("미션을 확인하고 있어요.")).not.toBeVisible();
}

test.describe("Mission initialization generation guard", () => {
  test("resumed=false 신규 세션은 시작 대기 UI로 수렴하고 생성 요청을 만들지 않는다", async ({ page }) => {
    const calls = await installMissionMocks(page, { resumed: false });
    await page.goto(MISSION_URL);

    await expect(page.getByRole("button", { name: "새 미션 시작하기" })).toBeVisible();
    await expectNoSkeleton(page);
    expect(calls.creatingCalls()).toBe(0);
  });

  test("박서둥 동등 resumed=true fixture는 느린 복원 뒤 실제 Mission UI까지 진입한다", async ({ page }) => {
    const calls = await installMissionMocks(page, { resumed: true, startDelayMs: 900 });
    await page.goto(MISSION_URL);

    const resume = page.getByRole("button", { name: /진행 중인 미션 이어하기/ });
    await expect(resume).toBeVisible({ timeout: 5_000 });
    // 케이 마스코트 캔버스의 진입 애니메이션이 일시적으로 이 버튼 위를 덮어 클릭을
    // 가로챌 수 있다(장식용 오버레이일 뿐 실제 클릭 대상과 무관) — force로 우회.
    await resume.click({ force: true });
    await expect(page.getByRole("button", { name: "텍스트로 답하기" })).toBeEnabled({ timeout: 5_000 });
    await expectNoSkeleton(page);
    expect(calls.creatingCalls()).toBe(1);
  });

  test("초기 요청 abort와 dev effect 재실행에서 stale 응답이 최신 상태를 덮어쓰지 않는다", async ({ page }) => {
    await installMissionMocks(page);
    const observedBodies: Record<string, unknown>[] = [];

    await page.route("**/api/mission/start", async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      observedBodies.push(body);
      const roundType = String(body.roundType ?? "round1_day");
      if (roundType === "round1_day") await new Promise((resolve) => setTimeout(resolve, 1_200));
      await fulfillJson(route, missionResponse(roundType === "round2_night", roundType));
    });

    await page.goto(MISSION_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(100);
    await page.evaluate((childId) => {
      window.history.pushState({}, "", `/child/missions?childId=${childId}&roundType=round2_night`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, CHILD_ID);

    const resume = page.getByRole("button", { name: /진행 중인 미션 이어하기/ });
    await expect(resume).toBeVisible({ timeout: 4_000 });
    await page.waitForTimeout(1_500);
    await expect(resume).toBeVisible();
    await expect(page.getByRole("button", { name: "새 미션 시작하기" })).not.toBeVisible();
    expect(observedBodies.length).toBeGreaterThanOrEqual(2);
    expect(observedBodies.every((body) => body.checkOnly === true)).toBe(true);
  });

  test("chat history API 실패는 핵심 resumed 세션 진입을 차단하지 않는다", async ({ page }) => {
    await installMissionMocks(page, { resumed: true, chatStatus: 500 });
    await page.goto(MISSION_URL);

    await expect(page.getByRole("button", { name: /진행 중인 미션 이어하기/ })).toBeVisible();
    await expectNoSkeleton(page);
  });

  test("IndexedDB read 지연은 복원되고 실패는 서버 세션 fallback으로 수렴한다", async ({ page }) => {
    await page.addInitScript(() => {
      const originalOpen = indexedDB.open.bind(indexedDB);
      Object.defineProperty(indexedDB, "open", {
        configurable: true,
        value(name: string, version?: number) {
          const request = version === undefined ? originalOpen(name) : originalOpen(name, version);
          let delayedHandler: ((this: IDBRequest, event: Event) => unknown) | null = null;
          Object.defineProperty(request, "onsuccess", {
            configurable: true,
            get: () => null,
            set(handler: ((this: IDBRequest, event: Event) => unknown) | null) {
              delayedHandler = handler;
              request.addEventListener("success", (event) => {
                setTimeout(() => delayedHandler?.call(request, event), 700);
              }, { once: true });
            },
          });
          return request;
        },
      });
    });
    await installMissionMocks(page, { resumed: true });
    await page.goto(MISSION_URL);
    await expect(page.getByRole("button", { name: /진행 중인 미션 이어하기/ })).toBeVisible({ timeout: 4_000 });

    const failedPage = await page.context().newPage();
    await failedPage.addInitScript(() => {
      Object.defineProperty(indexedDB, "open", {
        configurable: true,
        value() {
          throw new Error("fixture IndexedDB failure");
        },
      });
    });
    await installMissionMocks(failedPage, { resumed: true });
    await failedPage.goto(MISSION_URL);
    await expect(failedPage.getByRole("button", { name: /진행 중인 미션 이어하기/ })).toBeVisible();
    await expectNoSkeleton(failedPage);
  });

});

test.describe("Mission initialization generation guard — watchdog", () => {
  // 로컬 next dev의 PWA 서비스워커가 내비게이션 수 초 후 controller_changed를 일으켜
  // 페이지를 강제 새로고침하는 경우가 있다(Production/실제 Dev 배포에서는 SW 파일
  // 내용이 실제로 바뀔 때만 일어나는 정상 동작). 이 테스트는 8초 동안 같은 리액트
  // 트리가 살아있는 것 자체가 전제라 SW 노이즈만 이 그룹에서 차단한다 — 다른
  // 테스트에도 적용하면 무관한 클릭 인터셉션 회귀가 생겨 범위를 좁혔다.
  test.use({ serviceWorkers: "block" });

  test("8초 watchdog은 error/retry로 전환하고 retry generation은 정상 복구한다", async ({ page }) => {
    let hanging = true;
    const calls = await installMissionMocks(page, {
      resumed: true,
      shouldHang: () => hanging,
    });
    await page.goto(MISSION_URL, { waitUntil: "domcontentloaded" });

    // MISSION_LOADING_WATCHDOG_MS(8s)는 effect가 실제로 mount된 시점부터 재는데,
    // 여기 goto()는 domcontentloaded까지만 기다리므로 그 이후의 hydration/effect
    // 시작 지연이 더해진다. 실제 네트워크 환경에서는 이 여유가 더 필요할 수 있어
    // 8s에 딱 맞추지 않고 여유를 둔다.
    await expect(page.getByText("미션 상태를 확인하지 못했어요")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/미션을 불러오는 데 시간이 오래 걸리고 있어요/)).toBeVisible();
    hanging = false;
    await page.getByRole("button", { name: "다시 시도" }).click();

    await expect(page.getByRole("button", { name: /진행 중인 미션 이어하기/ })).toBeVisible({ timeout: 4_000 });
    await page.waitForTimeout(4_500);
    await expect(page.getByRole("button", { name: /진행 중인 미션 이어하기/ })).toBeVisible();
    expect(calls.creatingCalls()).toBe(0);
  });
});
