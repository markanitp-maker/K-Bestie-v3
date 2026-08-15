export type SupportDiscordNotice = {
  category: "inquiry" | "suggestion" | "bug";
  requestNumber: string;
  requestId: string;
  appSurface: string | null;
  createdAt: string;
};

const DISCORD_TIMEOUT_MS = 5_000;
const CATEGORY_LABELS: Record<SupportDiscordNotice["category"], string> = {
  inquiry: "📨 새로운 문의",
  suggestion: "💡 새로운 건의",
  bug: "🐞 새로운 버그 신고",
};

export function buildSupportDiscordPayload(notice: SupportDiscordNotice, origin: string) {
  const source = notice.appSurface === "landing"
    ? "랜딩페이지"
    : notice.appSurface === "child_app"
      ? "아이 앱"
      : notice.appSurface === "parent_app"
        ? "부모 앱"
        : "앱";
  const adminUrl = new URL("/admin/customer-requests", origin);
  adminUrl.searchParams.set("requestId", notice.requestId);
  return {
    content: null,
    allowed_mentions: { parse: [] as string[] },
    embeds: [{
      title: CATEGORY_LABELS[notice.category],
      fields: [
        { name: "접수번호", value: notice.requestNumber, inline: true },
        { name: "출처", value: source, inline: true },
        { name: "접수시각", value: notice.createdAt, inline: false },
      ],
      url: adminUrl.toString(),
      color: notice.category === "bug" ? 0xdc2626 : notice.category === "suggestion" ? 0xf59e0b : 0x2563eb,
    }],
  };
}

export async function notifyDiscordOfNewSupportRequest(notice: SupportDiscordNotice, origin: string) {
  const webhookUrl = process.env.DISCORD_SUPPORT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return { outcome: "not_configured" as const };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSupportDiscordPayload(notice, origin)),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("[support-discord] webhook failed", { status: response.status, requestNumber: notice.requestNumber });
      return { outcome: "failed" as const };
    }
    return { outcome: "sent" as const };
  } catch (error) {
    console.error("[support-discord] webhook failed", {
      code: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
      requestNumber: notice.requestNumber,
    });
    return { outcome: "failed" as const };
  } finally {
    clearTimeout(timer);
  }
}
