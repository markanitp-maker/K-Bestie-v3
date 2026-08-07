import webPush from 'web-push';

let initialized = false;

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

export async function sendPushNotification(subscription: webPush.PushSubscription, payload: any) {
  initWebPush();
  if (!initialized) {
    throw new Error('WEB_PUSH_NOT_CONFIGURED');
  }
  
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to send push notification', err);
    throw err;
  }
}

export function getPushErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
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
