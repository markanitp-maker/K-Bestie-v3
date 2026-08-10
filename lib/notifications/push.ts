import webPush from 'web-push';

let initialized = false;
const PUSH_TIMEOUT_MS = 10_000;

type PushErrorLike = {
  body?: unknown;
  code?: unknown;
  endpoint?: unknown;
  headers?: unknown;
  message?: unknown;
  statusCode?: unknown;
};

const SAFE_RESPONSE_HEADER_NAMES = ["content-type", "www-authenticate"] as const;

type SafePushResponseHeaders = Partial<Record<(typeof SAFE_RESPONSE_HEADER_NAMES)[number], string>>;

function initWebPush() {
  if (initialized) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.VAPID_PRIVATE_KEY || '';
  
  if (publicKey && privateKey) {
    webPush.setVapidDetails(
      'mailto:admin@kbestie.local',
      publicKey,
      privateKey
    );
    initialized = true;
  }
}

export async function sendPushNotification(subscription: webPush.PushSubscription, payload: unknown) {
  initWebPush();
  if (!initialized) {
    throw new Error('WEB_PUSH_NOT_CONFIGURED');
  }

  const startedAt = Date.now();
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload), { timeout: PUSH_TIMEOUT_MS });
  } catch (err) {
    const statusCode = getPushErrorStatus(err);
    const provider = getPushProvider(err);
    const reason = getPushErrorReason(err);
    const headers = getPushErrorHeaders(err);
    const code = getPushErrorCode(err);
    console.error('[push] provider_error', {
      statusCode,
      reason,
      headers,
      provider,
      elapsedMs: Date.now() - startedAt,
      code,
    });
    throw err;
  }
}

export function getPushErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const statusCode = (error as PushErrorLike).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

export function getPushErrorCode(error: unknown): string {
  if (isPushTimeout(error)) return "PUSH_TIMEOUT";
  const statusCode = getPushErrorStatus(error);
  return statusCode === null ? "PUSH_FAILED" : `PUSH_${statusCode}`;
}

export function getPushErrorReason(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const body = (error as PushErrorLike).body;
  const bodyText = Buffer.isBuffer(body)
    ? body.toString("utf8")
    : typeof body === "string"
      ? body
      : null;
  if (!bodyText) return null;

  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const reason = (parsed as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}

export function getPushErrorHeaders(error: unknown): SafePushResponseHeaders {
  if (typeof error !== "object" || error === null) return {};
  const headers = (error as PushErrorLike).headers;
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) return {};

  const safeHeaders: SafePushResponseHeaders = {};
  for (const name of SAFE_RESPONSE_HEADER_NAMES) {
    const value = (headers as Record<string, unknown>)[name];
    if (typeof value === "string") safeHeaders[name] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      safeHeaders[name] = value.join(", ");
    }
  }
  return safeHeaders;
}

function getPushProvider(error: unknown): "apple" | "fcm" | "mozilla" | "unknown" {
  if (typeof error !== "object" || error === null) return "unknown";
  const endpoint = (error as PushErrorLike).endpoint;
  if (typeof endpoint !== "string") return "unknown";

  try {
    const hostname = new URL(endpoint).hostname;
    if (hostname === "web.push.apple.com") return "apple";
    if (hostname === "fcm.googleapis.com") return "fcm";
    if (hostname.endsWith(".mozilla.com")) return "mozilla";
  } catch {
    // Do not log malformed endpoints because subscription URLs are sensitive.
  }
  return "unknown";
}

export function isPushTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as PushErrorLike;
  return code === "ETIMEDOUT" || (typeof message === "string" && message.toLowerCase().includes("socket timeout"));
}

export async function sendPushNotificationWithRetry(
  subscription: webPush.PushSubscription,
  payload: unknown,
  maxAttempts = 2
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendPushNotification(subscription, payload);
      return attempt;
    } catch (error) {
      lastError = error;
      const status = getPushErrorStatus(error);
      if (status === 404 || status === 410 || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
