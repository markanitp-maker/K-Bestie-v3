export const PWA_ACTIVATION_DELAY_MS = 8_000;
export const PWA_DISMISS_COOLDOWN_MS = 10 * 60 * 1_000;

export type UpdateWorkerAction = "message_waiting" | "wait_for_transition" | "refresh_registration";

type WorkerState = ServiceWorkerState | null | undefined;

export function isPwaDismissCooldownActive(dismissedAt: number, now = Date.now()): boolean {
  return dismissedAt > 0 && now - dismissedAt < PWA_DISMISS_COOLDOWN_MS;
}

export function decideUpdateWorkerAction(input: {
  waitingState?: WorkerState;
  installingState?: WorkerState;
  rememberedState?: WorkerState;
}): UpdateWorkerAction {
  if (input.waitingState === "installed") return "message_waiting";
  if (["installing", "installed", "activating"].includes(input.installingState ?? "")) {
    return "wait_for_transition";
  }
  if (input.rememberedState === "installed") return "message_waiting";
  if (input.rememberedState === "installing" || input.rememberedState === "activating") {
    return "wait_for_transition";
  }
  return "refresh_registration";
}

export function pwaUpdateCopy(state: "delayed" | "offline" | "error") {
  if (state === "offline") {
    return {
      title: "인터넷 연결이 끊겨 있어 업데이트할 수 없어요.",
      body: "연결 후 다시 시도해 주세요. 현재 버전은 계속 사용할 수 있습니다.",
      action: "다시 확인",
    };
  }
  if (state === "delayed") {
    return {
      title: "새 버전 적용이 조금 늦어지고 있어요.",
      body: "현재 버전은 계속 사용할 수 있습니다.",
      action: "새로고침",
    };
  }
  return {
    title: "새 버전을 확인하지 못했어요.",
    body: "현재 버전은 계속 사용할 수 있습니다.",
    action: "새로고침",
  };
}
