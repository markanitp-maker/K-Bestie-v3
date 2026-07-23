// Vertex AI Gemini Live(gemini-live-2.5-flash-native-audio) WebSocket 릴레이 — Cloud Run 전용.
//
// 브라우저는 Vertex 서비스계정 자격증명을 가질 수 없으므로(하드룰③ API키 프런트 노출 금지),
// 이 서버가 자격증명을 들고 Vertex Live에 연결하고, 브라우저와는 순수 WebSocket(JSON 프레임)으로
// 오디오/전사만 중계한다. AI Studio 경로는 이 서비스를 거치지 않고 기존 그대로 동작한다
// (app/api/voice/token/route.ts가 provider별로 분기).
//
// Plan7 결정 반영:
// - Vertex 연결 실패 시 AI Studio로 자동 폴백하지 않는다 — 그냥 세션을 끝낸다.
// - 로그에는 provider/model/sessionId/성공-실패/오류코드/지연시간/transcription 수신여부만 남긴다.
//   음성 원본, 전체 대화 원문, API Key, access token, 서비스계정 인증정보는 절대 로그에 남기지 않는다.

import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, ActivityHandling, StartSensitivity } from "@google/genai";
import { verifyTicket } from "./ticket.js";
import { K_SYSTEM_PROMPT } from "./prompts.js";
import { resolveVoiceName } from "./voices.js";

const PORT = Number(process.env.PORT) || 8080;
const RELAY_SECRET = process.env.VERTEX_LIVE_RELAY_SECRET;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// 재연결 로직은 이번 라운드 범위 밖 — 넘으면 그냥 세션을 끝낸다(안전장치용 상한일 뿐).
const MAX_SESSION_MS = Number(process.env.MAX_SESSION_MS) || 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

const VERTEX_LIVE_MODEL_ID = "gemini-live-2.5-flash-native-audio";

if (!RELAY_SECRET) {
  console.error("[vertex-live-relay] VERTEX_LIVE_RELAY_SECRET not configured — refusing to start");
  process.exit(1);
}

type LogFields = {
  event: string;
  childId?: string;
  sessionId?: string;
  model?: string;
  voiceName?: string;
  code?: number | string;
  reason?: string;
  errorCode?: string;
  latencyMs?: number;
  durationMs?: number;
  received?: boolean;
  // 티켓 파싱 진단 — 원문 티켓 값은 절대 포함하지 않는다(services/vertex-live-relay/src/ticket.ts의
  // TicketDiag와 1:1 대응).
  ticketLength?: number;
  segmentCount?: number;
  version?: number | null;
  hasVoiceName?: boolean;
  parseStage?: string;
  lastMessageAgoMs?: number;
};

// 허용 필드만 받도록 타입으로 강제 — 음성 원본/전체 transcript/키/토큰/서비스계정 정보는
// 이 함수의 파라미터 자체에 없어서 구조적으로 실수로도 못 넣는다.
function log(fields: LogFields) {
  console.log(JSON.stringify({ provider: "vertex", ts: new Date().toISOString(), ...fields }));
}

function sendJson(ws: WebSocket, obj: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function createVertexClient(): GoogleGenAI {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not configured");

  const keyJson = process.env.GCP_VERTEX_SA_KEY_JSON;
  if (keyJson) {
    const credentials = JSON.parse(keyJson);
    return new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials } });
  }
  // 서비스계정 JSON을 별도로 안 넣으면 Cloud Run에 첨부된 서비스계정(ADC)을 그대로 사용한다
  // — 키 파일을 따로 관리할 필요가 없는 권장 경로(README 참고, 이번 라운드에서 IAM 설정 자체는 안 함).
  return new GoogleGenAI({ vertexai: true, project, location });
}

interface ActiveEntry {
  ws: WebSocket;
  sessionId: string;
  // @google/genai의 live.connect() 반환 타입 — 이 서비스는 독립 배포 단위라 앱의 타입 재사용이
  // 불가능하고, 여기서 쓰는 메서드(sendRealtimeInput/sendClientContent/close)만 확실하면 되므로 any.
  vertexSession: any;
  maxTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  lastPongAt: number;
  lastMessageAt: number;
}

// 아이(childId) 1명당 활성 연결 1개만 유지 — 중복 연결 방지.
const activeSessions = new Map<string, ActiveEntry>();

async function handleConnection(ws: WebSocket, childId: string, voiceName: string) {
  const sessionId = crypto.randomUUID();
  const connectedAt = Date.now();

  const prev = activeSessions.get(childId);
  if (prev) {
    log({ event: "superseded", childId, sessionId: prev.sessionId });
    try { prev.ws.close(4000, "superseded_by_new_connection"); } catch { /* 이미 닫힌 경우 무시 */ }
    try { prev.vertexSession?.close(); } catch { /* 이미 닫힌 경우 무시 */ }
    if (prev.heartbeatTimer) clearInterval(prev.heartbeatTimer);
    if (prev.maxTimer) clearTimeout(prev.maxTimer);
  }

  const entry: ActiveEntry = {
    ws,
    sessionId,
    vertexSession: null,
    maxTimer: null,
    heartbeatTimer: null,
    lastPongAt: Date.now(),
    lastMessageAt: Date.now(),
  };
  activeSessions.set(childId, entry);

  let cleaned = false;
  function cleanup(reason: string) {
    if (cleaned) return;
    cleaned = true;
    if (activeSessions.get(childId) === entry) activeSessions.delete(childId);
    if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
    if (entry.maxTimer) clearTimeout(entry.maxTimer);
    try { entry.vertexSession?.close(); } catch { /* 이미 닫힌 경우 무시 */ }
    try { ws.close(); } catch { /* 이미 닫힌 경우 무시 */ }
    log({ event: "session_end", childId, sessionId, reason, durationMs: Date.now() - connectedAt });
  }

  entry.maxTimer = setTimeout(() => {
    sendJson(ws, { type: "error", message: "max_session_duration_exceeded" });
    cleanup("max_duration_exceeded");
  }, MAX_SESSION_MS);

  entry.heartbeatTimer = setInterval(() => {
    if (Date.now() - entry.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      log({ event: "heartbeat_timeout", childId, sessionId });
      cleanup("heartbeat_timeout");
      return;
    }
    sendJson(ws, { type: "ping" });
  }, HEARTBEAT_INTERVAL_MS);

  let ai: GoogleGenAI;
  try {
    ai = createVertexClient();
  } catch (err) {
    log({ event: "connect_failed", childId, sessionId, errorCode: (err as Error).message });
    sendJson(ws, { type: "error", message: "vertex_credentials_error" });
    cleanup("credentials_error");
    return;
  }

  const connectStartedAt = Date.now();
  try {
    const vertexSession = await ai.live.connect({
      model: VERTEX_LIVE_MODEL_ID,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          languageCode: "ko-KR",
        },
        // 수동 VAD 설정 적용 (서버 자동 감지 비활성화, 클라이언트에서 activityStart/activityEnd 전송)
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: true,
          },
        },
        systemInstruction: { parts: [{ text: K_SYSTEM_PROMPT }] },
      },
      callbacks: {
        onopen: () => {
          log({
            event: "vertex_open",
            childId,
            sessionId,
            model: VERTEX_LIVE_MODEL_ID,
            voiceName,
            latencyMs: Date.now() - connectStartedAt,
          });
          sendJson(ws, { type: "ready" });
        },
        onmessage: (msg: any) => {
          const sc = msg.serverContent;
          if (sc?.inputTranscription?.text) log({ event: "input_transcription", childId, sessionId, received: true });
          if (sc?.outputTranscription?.text) log({ event: "output_transcription", childId, sessionId, received: true });
          sendJson(ws, {
            type: "message",
            payload: {
              data: msg.data,
              serverContent: sc
                ? {
                    turnComplete: sc.turnComplete,
                    inputTranscription: sc.inputTranscription,
                    outputTranscription: sc.outputTranscription,
                  }
                : undefined,
              usageMetadata: msg.usageMetadata,
            },
          });
        },
        onerror: (e: { message?: string }) => {
          log({ event: "vertex_error", childId, sessionId, errorCode: e.message ?? "unknown" });
          sendJson(ws, { type: "error", message: "vertex_connection_failed" });
          cleanup("vertex_error");
        },
        onclose: (e: { code?: number; reason?: string }) => {
          log({ event: "vertex_close", childId, sessionId, code: e.code, reason: e.reason });
          cleanup("vertex_close");
        },
      },
    });
    entry.vertexSession = vertexSession;
  } catch (err) {
    log({ event: "connect_failed", childId, sessionId, errorCode: (err as Error).message });
    sendJson(ws, { type: "error", message: "vertex_connection_failed" });
    cleanup("connect_exception");
    return;
  }

  ws.on("message", (raw) => {
    let parsed: { type?: string; data?: string; text?: string } | undefined;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!parsed?.type) return;

    if (["audio", "activityStart", "activityEnd", "text"].includes(parsed.type)) {
      entry.lastMessageAt = Date.now();
    }

    if (parsed.type === "audio" && typeof parsed.data === "string") {
      entry.vertexSession?.sendRealtimeInput({ audio: { data: parsed.data, mimeType: "audio/pcm;rate=16000" } });
    } else if (parsed.type === "activityStart") {
      entry.vertexSession?.sendRealtimeInput({ activityStart: {} });
    } else if (parsed.type === "activityEnd") {
      entry.vertexSession?.sendRealtimeInput({ activityEnd: {} });
    } else if (parsed.type === "text" && typeof parsed.text === "string") {
      entry.vertexSession?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: parsed.text }] }],
        turnComplete: true,
      });
    } else if (parsed.type === "pong") {
      entry.lastPongAt = Date.now();
    }
  });

  ws.on("close", (code, reason) => {
    log({
      event: "client_close",
      childId,
      sessionId,
      code,
      reason: reason ? reason.toString() : undefined,
      lastMessageAgoMs: Date.now() - entry.lastMessageAt
    });
    cleanup("client_close");
  });
  ws.on("error", () => {
    cleanup("client_ws_error");
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  if (url.pathname !== "/live") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const origin = req.headers.origin ?? "";
  if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    log({ event: "origin_rejected", reason: origin || "(no origin header)" });
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  const ticket = url.searchParams.get("ticket") ?? "";
  const result = verifyTicket(ticket, RELAY_SECRET as string);
  if (!result.valid || !result.childId) {
    // 원문 티켓 값은 절대 남기지 않는다 — 파싱 진단 필드만 기록(무엇이 왜 실패했는지 특정 가능).
    log({ event: "ticket_rejected", reason: result.reason, ...result.diag });
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  // voiceName은 서명된 티켓(v1)에서만 가져온다 — legacy 티켓(voiceName 없음)은 기본값으로
  // 대체된다. Google 공식 30개 목록 기준으로 다시 한번 검증해 없거나 미지원이면 기본
  // 목소리(Achernar)로 대체한다.
  const voiceName = resolveVoiceName(result.voiceName);
  if (result.voiceName !== voiceName) {
    log({ event: "voice_fallback", childId: result.childId, voiceName, ...result.diag });
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    void handleConnection(ws, result.childId as string, voiceName);
  });
});

server.listen(PORT, () => {
  log({ event: "listening", reason: `port ${PORT}` });
});
