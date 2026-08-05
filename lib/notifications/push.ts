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
    console.error('WebPush not initialized (missing VAPID keys)');
    return;
  }
  
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to send push notification', err);
    throw err;
  }
}
