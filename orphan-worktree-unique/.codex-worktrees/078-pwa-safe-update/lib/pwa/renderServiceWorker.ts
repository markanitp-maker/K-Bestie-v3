export interface RenderServiceWorkerOptions {
  buildId: string;
  buildStamp: string;
  swVersion: string;
  cacheAssets: readonly string[];
}

export function renderServiceWorker(options: RenderServiceWorkerOptions): string {
  const { buildId, buildStamp, swVersion, cacheAssets } = options;

  return `const CACHE_NAME = ${JSON.stringify(swVersion)};
const BUILD_ID = ${JSON.stringify(buildId)};
const BUILD_STAMP = ${JSON.stringify(buildStamp)};
const SW_INSTANCE_NONCE = crypto.randomUUID();

const PRECACHE_ASSETS = ${JSON.stringify(cacheAssets)};

const handledProposals = new Set();
let activeConsensusSession = null;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const results = await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          try {
            await cache.add(url);
            return url;
          } catch (err) {
            console.warn("[SW] Precache failed:", url, err);
            throw err;
          }
        })
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        throw new Error("[SW] Precache failed for " + failures.length + " assets");
      }
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      const results = await Promise.allSettled(
        cacheNames.map(async (name) => {
          if (name.startsWith("kbestie-shell-") && name !== CACHE_NAME) {
            console.log("[SW] Cleaning up old cache:", name);
            await caches.delete(name);
          }
        })
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.warn("[SW] Cache cleanup had " + failures.length + " failures");
      }
      await self.clients.claim();
    })
  );
});

function isSameOriginClient(source) {
  if (!source || !source.url) return false;
  try {
    const clientUrl = new URL(source.url);
    return clientUrl.origin === self.location.origin;
  } catch {
    return false;
  }
}

function notifyStaleAsset(clientId, pathname) {
  if (!clientId || !pathname || typeof pathname !== "string") return;
  if (!pathname.startsWith("/_next/static/") || pathname.includes("?") || pathname.includes("#")) return;
  if (/[\\x00-\\x1F\\x7F]/.test(pathname)) return;
  self.clients.get(clientId).then((client) => {
    if (client && isSameOriginClient(client)) {
      client.postMessage({
        protocol: 1,
        type: "K_STALE_ASSET",
        requestNonce: crypto.randomUUID(),
        buildId: BUILD_ID,
        workerNonce: SW_INSTANCE_NONCE,
        pathname: pathname,
        status: 404
      });
    }
  }).catch(() => {});
}

async function getWindowClients() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return clients.filter((client) => isSameOriginClient(client));
}

function executeSinglePass({ proposalId, passId, expectedClients, clientNonces, requestNonce, proposal }) {
  return new Promise((resolve) => {
    const expectedIdsSet = new Set(expectedClients.map((c) => c.id));
    const receivedVotes = new Map();

    const session = {
      proposalId,
      passId,
      expectedIdsSet,
      clientNonces,
      receivedVotes,
      resolve,
    };

    activeConsensusSession = session;

    const timerId = setTimeout(() => {
      if (activeConsensusSession === session) {
        activeConsensusSession = null;
        resolve({ ok: false, reason: "Consensus vote timeout" });
      }
    }, 2000);

    session.finish = (res) => {
      clearTimeout(timerId);
      if (activeConsensusSession === session) {
        activeConsensusSession = null;
      }
      resolve(res);
    };

    for (const client of expectedClients) {
      const voteNonce = clientNonces.get(client.id);
      try {
        client.postMessage({
          protocol: 1,
          type: "PWA_TAB_PREPARE",
          requestNonce,
          proposal,
          passId,
          voteNonce,
          targetBuild: BUILD_ID,
          targetSwVersion: CACHE_NAME,
          workerNonce: SW_INSTANCE_NONCE,
          expiresAt: proposal.expiresAt,
        });
      } catch {}
    }
  });
}

async function runTwoPassConsensus(requestNonce, proposal, privatePort) {
  const proposalId = proposal.proposalId;

  function sendAbort(reason) {
    const abortMsg = {
      protocol: 1,
      type: "PWA_ACTIVATION_ABORTED",
      requestNonce,
      proposalId,
      reason,
    };
    if (privatePort) {
      try { privatePort.postMessage(abortMsg); } catch {}
    }
  }

  if (handledProposals.has(proposalId)) {
    sendAbort("Proposal already handled");
    return;
  }

  if (proposal.targetBuild !== BUILD_ID || proposal.workerNonce !== SW_INSTANCE_NONCE) {
    sendAbort("Target build or worker nonce mismatch");
    return;
  }

  if (proposal.expiresAt && Date.now() >= proposal.expiresAt) {
    sendAbort("Proposal expired");
    return;
  }

  let passAttempt = 0;
  const MAX_PASS_ATTEMPTS = 5;
  let consecutiveStablePasses = 0;
  let lastClientIdsSet = null;

  while (passAttempt < MAX_PASS_ATTEMPTS) {
    passAttempt++;

    const currentClients = await getWindowClients();
    if (currentClients.length === 0) {
      sendAbort("No active window clients found");
      return;
    }

    const currentSet = new Set(currentClients.map((c) => c.id));
    const currentPassId = crypto.randomUUID();

    if (lastClientIdsSet !== null) {
      const isSameSet =
        lastClientIdsSet.size === currentSet.size &&
        [...lastClientIdsSet].every((id) => currentSet.has(id));

      if (!isSameSet) {
        consecutiveStablePasses = 0;
      }
    }

    lastClientIdsSet = currentSet;

    const clientNonces = new Map();
    for (const client of currentClients) {
      clientNonces.set(client.id, crypto.randomUUID());
    }

    const passResult = await executeSinglePass({
      proposalId,
      passId: currentPassId,
      expectedClients: currentClients,
      clientNonces,
      requestNonce,
      proposal,
    });

    if (!passResult.ok) {
      sendAbort(passResult.reason);
      return;
    }

    const postVoteClients = await getWindowClients();
    const postVoteSet = new Set(postVoteClients.map((c) => c.id));

    const setStillSame =
      currentSet.size === postVoteSet.size &&
      [...currentSet].every((id) => postVoteSet.has(id));

    if (!setStillSame) {
      consecutiveStablePasses = 0;
      lastClientIdsSet = postVoteSet;
      continue;
    }

    consecutiveStablePasses++;

    if (consecutiveStablePasses >= 2) {
      if (!handledProposals.has(proposalId)) {
        handledProposals.add(proposalId);
        self.skipWaiting();
        const commitMsg = {
          protocol: 1,
          type: "PWA_ACTIVATION_COMMITTED",
          requestNonce,
          proposalId,
          workerNonce: SW_INSTANCE_NONCE,
        };
        if (privatePort) {
          try { privatePort.postMessage(commitMsg); } catch {}
        }
      }
      return;
    }
  }

  sendAbort("Client set failed to stabilize across passes");
}

self.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  if (!isSameOriginClient(event.source)) return;

  const data = event.data;

  if (data.protocol === 1 && data.type === "PWA_GET_IDENTITY") {
    if (typeof data.requestNonce !== "string" || !data.requestNonce.trim()) return;
    const responseMsg = {
      protocol: 1,
      type: "PWA_IDENTITY_RESPONSE",
      requestNonce: data.requestNonce,
      buildId: BUILD_ID,
      swVersion: CACHE_NAME,
      workerNonce: SW_INSTANCE_NONCE,
    };
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(responseMsg);
    } else if (event.source) {
      event.source.postMessage(responseMsg);
    }
    return;
  }

  if (data.type === "GET_VERSION" || data.action === "GET_VERSION") {
    const responseMsg = {
      protocol: 0,
      type: "VERSION_RESPONSE",
      version: BUILD_ID,
      buildId: BUILD_ID,
      swVersion: CACHE_NAME,
      workerNonce: null,
      requestNonce: typeof data.requestNonce === "string" ? data.requestNonce : null,
    };
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(responseMsg);
    } else if (event.source) {
      event.source.postMessage(responseMsg);
    }
    return;
  }

  if (data.protocol === 1 && data.type === "PWA_PREPARE_ACTIVATION") {
    const { requestNonce, proposal } = data;
    const privatePort = event.ports && event.ports[0] ? event.ports[0] : null;
    if (requestNonce && proposal) {
      event.waitUntil(runTwoPassConsensus(requestNonce, proposal, privatePort));
    }
    return;
  }

  if (data.protocol === 1 && (data.type === "PWA_TAB_ACK" || data.type === "PWA_TAB_NACK" || data.type === "PWA_TAB_VOTE_ACK" || data.type === "PWA_TAB_VOTE_NACK")) {
    if (!activeConsensusSession) return;
    const session = activeConsensusSession;

    if (!event.source || !event.source.id) return;
    const senderClientId = event.source.id;

    if (data.proposalId !== session.proposalId) return;
    if (data.passId && data.passId !== session.passId) return;

    if (!session.expectedIdsSet.has(senderClientId)) {
      session.finish({ ok: false, reason: "Unexpected client ID" });
      return;
    }

    const expectedNonce = session.clientNonces.get(senderClientId);
    if (!expectedNonce || (data.voteNonce && data.voteNonce !== expectedNonce)) {
      session.finish({ ok: false, reason: "Invalid vote nonce or pass replay" });
      return;
    }

    if (session.receivedVotes.has(senderClientId)) {
      session.finish({ ok: false, reason: "Duplicate vote from client" });
      return;
    }

    if (data.type === "PWA_TAB_NACK" || data.type === "PWA_TAB_VOTE_NACK" || data.status !== "ACK_SAFE") {
      session.finish({ ok: false, reason: data.reason || data.status || "NACK received" });
      return;
    }

    session.receivedVotes.set(senderClientId, expectedNonce);

    if (session.receivedVotes.size === session.expectedIdsSet.size) {
      session.finish({ ok: true });
    }
    return;
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isHTMLNavigation = event.request.mode === "navigate" || event.request.destination === "document";
  const isRSCRequest = url.searchParams.has("_rsc") || event.request.headers.has("RSC");
  const isNextDataRequest = url.pathname.startsWith("/_next/data/");

  if (
    isHTMLNavigation ||
    isRSCRequest ||
    isNextDataRequest ||
    url.pathname.startsWith("/api/") ||
    url.hostname.includes(".supabase.co") ||
    event.request.method !== "GET" ||
    event.request.headers.has("Authorization")
  ) {
    if (isHTMLNavigation) {
      event.respondWith(
        fetch(event.request).catch(() => caches.match("/offline"))
      );
    }
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  const isPrecacheAsset = PRECACHE_ASSETS.includes(url.pathname);
  const isNextStatic = url.pathname.startsWith("/_next/static/");

  if (isPrecacheAsset || isNextStatic) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (isNextStatic && networkResponse && networkResponse.status === 404) {
            notifyStaleAsset(event.clientId, url.pathname);
          }
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        });
      })
    );
    return;
  }

  return;
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const title = data.title || "새로운 알림이 도착했습니다.";
    const options = {
      body: data.body,
      icon: "/icons/icon-192-v4.png",
      badge: "/icons/icon-192-v4.png",
      data: { url: data.url || "/", notificationId: data.notificationId || data.notification_id || null },
    };
    event.waitUntil((async () => {
      await self.registration.showNotification(title, options);
      try {
        const response = await fetch("/api/notifications?limit=1", { credentials: "include", cache: "no-store" });
        if (response.ok) {
          const inbox = await response.json();
          const unreadCount = Number(inbox.unreadCount || 0);
          if (unreadCount > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(unreadCount);
          if (unreadCount === 0 && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
        }
      } catch (error) {
        console.warn("[SW] badge sync failed", error);
      }
    })());
  } catch (e) {
    console.error("Error parsing push data", e);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  const notificationId = event.notification.data && event.notification.data.notificationId;
  event.waitUntil(
    (async () => {
      if (notificationId) {
        try {
          const response = await fetch("/api/notifications/" + encodeURIComponent(notificationId) + "/read", {
            method: "POST",
            credentials: "include",
          });
          if (response.ok) {
            const result = await response.json();
            const unreadCount = Number(result.unreadCount || 0);
            if (unreadCount > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(unreadCount);
            if (unreadCount === 0 && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
          }
        } catch (error) {
          console.warn("[SW] notification read sync failed", error);
        }
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const targetUrl = new URL(target, self.location.origin).href;
      const sameOrigin = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (sameOrigin) {
        if ("navigate" in sameOrigin) await sameOrigin.navigate(targetUrl);
        return sameOrigin.focus();
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
`;
}
