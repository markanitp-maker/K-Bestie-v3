export type SupportDiscordNotice = {
  category: "inquiry" | "suggestion" | "bug";
  requestNumber: string;
  requestId: string;
  appSurface: string | null;
  createdAt: string;
  title: string;
  content: string;
};

const DISCORD_TIMEOUT_MS = 5_000;
const CATEGORY_LABELS: Record<SupportDiscordNotice["category"], string> = {
  inquiry: "문의",
  suggestion: "건의",
  bug: "버그",
};

/**
 * Discord Embed field 는 1024 코드포인트가 상한이다.
 *
 * 1024 이하면 원문 그대로 둔다. 1023 을 상한으로 쓰면 정확히 1024 자인 내용에
 * 불필요하게 말줄임이 붙어 한 글자를 잃는다(074 §3-2).
 * 초과하면 앞 1023 자에 말줄임을 붙여 정확히 1024 를 맞춘다 — 말줄임표도 1 코드포인트다.
 */
export const DISCORD_FIELD_MAX_CHARS = 1024;

export function truncateContent(content: string, maxChars = DISCORD_FIELD_MAX_CHARS): string {
  const chars = Array.from(content);
  if (chars.length <= maxChars) {
    return content;
  }
  return chars.slice(0, maxChars - 1).join("") + "…";
}

export function buildSupportDiscordPayload(notice: SupportDiscordNotice, origin: string) {
  const adminUrl = new URL("/admin/customer-requests", origin);
  adminUrl.searchParams.set("requestId", notice.requestId);
  return {
    content: null,
    allowed_mentions: { parse: [] as string[] },
    embeds: [{
      fields: [
        { name: "유형", value: CATEGORY_LABELS[notice.category], inline: true },
        { name: "제목", value: notice.title, inline: false },
        { name: "내용", value: truncateContent(notice.content), inline: false },
      ],
      url: adminUrl.toString(),
      color: notice.category === "bug" ? 0xdc2626 : notice.category === "suggestion" ? 0xf59e0b : 0x2563eb,
    }],
  };
}

export async function notifyDiscordOfNewSupportRequest(notice: SupportDiscordNotice, origin: string) {
  const webhookUrl = process.env.DISCORD_SUPPORT_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.warn("[support-discord] DISCORD_SUPPORT_WEBHOOK_URL is not configured; skipping notification", {
      requestNumber: notice.requestNumber,
    });
    return { outcome: "not_configured" as const };
  }
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
      console.warn("[support-discord] webhook delivery failed", {
        status: response.status,
        requestNumber: notice.requestNumber,
      });
      return { outcome: "failed" as const };
    }
    return { outcome: "sent" as const };
  } catch (error) {
    console.warn("[support-discord] webhook delivery failed", {
      code: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
      requestNumber: notice.requestNumber,
    });
    return { outcome: "failed" as const };
  } finally {
    clearTimeout(timer);
  }
}

