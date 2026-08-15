import * as http from "node:http";
import * as https from "node:https";

import {
  DEFAULT_PWA_CACHE_ASSETS,
  renderServiceWorker,
} from "../../lib/pwa/renderServiceWorker.js";

export type PwaTargetName = "v1" | "v2";
export type ClientVersionMode = "normal" | "http-503" | "malformed-json";

export interface PwaTargetConfig {
  schemaVersion: 1;
  buildId: string;
  buildStamp: string;
  deploymentId: string;
  swVersion: string;
  serviceWorkerScriptUrl: "/sw.js";
  cacheAssets?: readonly string[];
}

interface PwaProxyFaultState {
  clientVersionMode: ClientVersionMode;
  latestTargetName: PwaTargetName;
  serviceWorkerTargetName: PwaTargetName;
}

interface PwaUpdateProxyOptions {
  upstreamUrl: string;
  targets?: Readonly<Record<PwaTargetName, PwaTargetConfig>>;
}

const DEFAULT_TARGETS: Readonly<Record<PwaTargetName, PwaTargetConfig>> = {
  v1: {
    schemaVersion: 1,
    buildId: "078-dev-v1",
    buildStamp: "078-dev-v1",
    deploymentId: "dpl-078-dev-v1",
    swVersion: "kbestie-shell-078-dev-v1",
    serviceWorkerScriptUrl: "/sw.js",
  },
  v2: {
    schemaVersion: 1,
    buildId: "078-dev-v2",
    buildStamp: "078-dev-v2",
    deploymentId: "dpl-078-dev-v2",
    swVersion: "kbestie-shell-078-dev-v2",
    serviceWorkerScriptUrl: "/sw.js",
  },
};

const APPROVED_DEV_ORIGINS = new Set([
  "https://k-bestie-v3-dev.vercel.app",
]);

const assertTestOnlyRuntime = (): void => {
  if (process.env.NODE_ENV !== "test" || process.env.PWA_E2E_PROXY !== "1") {
    throw new Error(
      "PWA update proxy requires NODE_ENV=test and PWA_E2E_PROXY=1",
    );
  }
};

const parseDeployedDevUpstream = (rawUrl: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("PWA_E2E_DEV_UPSTREAM must be a valid deployed DEV URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    hostname === "app.k-bestie.com" ||
    hostname === "www.app.k-bestie.com" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    !APPROVED_DEV_ORIGINS.has(parsed.origin)
  ) {
    throw new Error(
      "PWA_E2E_DEV_UPSTREAM must exactly match an approved deployed DEV origin",
    );
  }

  return parsed;
};

const isServiceWorkerEndpoint = (pathname: string): boolean =>
  pathname === "/sw.js" || pathname === "/api/pwa/sw";

const copyProxyRequestHeaders = (
  headers: http.IncomingHttpHeaders,
  upstream: URL,
  localOrigin: string,
): http.OutgoingHttpHeaders => {
  const copied: http.OutgoingHttpHeaders = { ...headers };
  copied.host = upstream.host;
  delete copied.connection;

  if (typeof copied.origin === "string" && copied.origin === localOrigin) {
    copied.origin = upstream.origin;
  }
  if (typeof copied.referer === "string") {
    copied.referer = copied.referer.replace(localOrigin, upstream.origin);
  }

  return copied;
};

const copyProxyResponseHeaders = (
  headers: http.IncomingHttpHeaders,
  upstream: URL,
  localOrigin: string,
): http.OutgoingHttpHeaders => {
  const copied: http.OutgoingHttpHeaders = { ...headers };

  if (Array.isArray(copied["set-cookie"])) {
    copied["set-cookie"] = copied["set-cookie"].map((cookie) =>
      cookie.replace(/Domain=[^;]+;?\s*/gi, ""),
    );
  }
  if (typeof copied.location === "string") {
    copied.location = copied.location.replace(upstream.origin, localOrigin);
  }

  return copied;
};

export class PwaUpdateProxy {
  private readonly upstreamUrl: URL;
  private readonly targets: Readonly<Record<PwaTargetName, PwaTargetConfig>>;
  private faultState: Readonly<PwaProxyFaultState> = Object.freeze({
    clientVersionMode: "normal",
    latestTargetName: "v1",
    serviceWorkerTargetName: "v1",
  });
  private server: http.Server | null = null;
  private portNumber = 0;

  public constructor(options: PwaUpdateProxyOptions) {
    this.upstreamUrl = parseDeployedDevUpstream(options.upstreamUrl);
    this.targets = options.targets ?? DEFAULT_TARGETS;
  }

  public async start(): Promise<void> {
    assertTestOnlyRuntime();
    if (this.server) return;

    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(502, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
        }
        response.end(
          JSON.stringify({
            error: "DEV upstream proxy failure",
            cause: error instanceof Error ? error.message : "Unknown proxy error",
          }),
        );
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("PWA update proxy failed to bind a loopback port"));
          return;
        }
        this.portNumber = address.port;
        resolve();
      });
    });

    this.server = server;
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) {
      this.portNumber = 0;
      this.resetFaults();
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } finally {
      this.portNumber = 0;
      this.resetFaults();
    }
  }

  public setTarget(targetName: PwaTargetName): void {
    this.setLatestTarget(targetName);
    this.setServiceWorkerTarget(targetName);
    this.setClientVersionMode("normal");
  }

  public setClientVersionMode(mode: ClientVersionMode): void {
    this.faultState = Object.freeze({
      ...this.faultState,
      clientVersionMode: mode,
    });
  }

  public setLatestTarget(targetName: PwaTargetName): void {
    this.faultState = Object.freeze({
      ...this.faultState,
      latestTargetName: targetName,
    });
  }

  public setServiceWorkerTarget(targetName: PwaTargetName): void {
    this.faultState = Object.freeze({
      ...this.faultState,
      serviceWorkerTargetName: targetName,
    });
  }

  public resetFaults(): void {
    this.faultState = Object.freeze({
      clientVersionMode: "normal",
      latestTargetName: "v1",
      serviceWorkerTargetName: "v1",
    });
  }

  public getTarget(): Readonly<PwaTargetConfig> {
    return this.targets[this.faultState.latestTargetName];
  }

  public get origin(): string {
    if (!this.portNumber) {
      throw new Error("PWA update proxy has not started");
    }
    return `http://127.0.0.1:${this.portNumber}`;
  }

  public get upstreamOrigin(): string {
    return this.upstreamUrl.origin;
  }

  private async handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", this.origin);
    const requestFaults = Object.freeze({ ...this.faultState });

    if (request.method === "GET" && isServiceWorkerEndpoint(requestUrl.pathname)) {
      const target = this.targets[requestFaults.serviceWorkerTargetName];
      const body = renderServiceWorker({
        buildId: target.buildId,
        buildStamp: target.buildStamp,
        swVersion: target.swVersion,
        cacheAssets: target.cacheAssets ?? DEFAULT_PWA_CACHE_ASSETS,
      });
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0, s-maxage=0",
        Pragma: "no-cache",
        Expires: "0",
        "Service-Worker-Allowed": "/",
      });
      response.end(body);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/client-version") {
      if (requestFaults.clientVersionMode === "http-503") {
        response.writeHead(503, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        });
        response.end(JSON.stringify({ error: "client-version unavailable" }));
        return;
      }

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      if (requestFaults.clientVersionMode === "malformed-json") {
        response.end(Buffer.from('{"schemaVersion":1', "utf8"));
        return;
      }

      const target = this.targets[requestFaults.latestTargetName];
      response.end(JSON.stringify(target));
      return;
    }

    await this.forwardToUpstream(request, response);
  }

  private async forwardToUpstream(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const upstreamRequest = https.request(
        {
          protocol: "https:",
          hostname: this.upstreamUrl.hostname,
          port: this.upstreamUrl.port || 443,
          method: request.method,
          path: request.url,
          headers: copyProxyRequestHeaders(
            request.headers,
            this.upstreamUrl,
            this.origin,
          ),
          servername: this.upstreamUrl.hostname,
        },
        (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            copyProxyResponseHeaders(
              upstreamResponse.headers,
              this.upstreamUrl,
              this.origin,
            ),
          );
          upstreamResponse.pipe(response);
          upstreamResponse.once("end", resolve);
          upstreamResponse.once("error", reject);
        },
      );

      upstreamRequest.once("error", reject);
      request.pipe(upstreamRequest);
    });
  }
}
