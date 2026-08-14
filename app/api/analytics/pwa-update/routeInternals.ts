export function isValidJsonContentType(contentType: string | null): boolean {
  if (!contentType || typeof contentType !== "string") return false;
  const parts = contentType.split(";");
  const baseType = parts[0].trim().toLowerCase();
  if (baseType !== "application/json") return false;

  if (parts.length === 1) {
    return true;
  }
  if (parts.length > 2) {
    return false;
  }

  const param = parts[1].trim();
  if (!/^charset=/i.test(param)) {
    return false;
  }

  const rawVal = param.slice(8);
  if (rawVal.length === 0) {
    return false; // Reject charset= (empty value)
  }
  if (rawVal.includes("'")) {
    return false; // Reject single quotes completely
  }

  if (rawVal.startsWith('"')) {
    if (!rawVal.endsWith('"') || rawVal.length < 2) {
      return false; // Unbalanced double quote
    }
    const inner = rawVal.slice(1, -1).toLowerCase();
    return inner === "utf-8" || inner === "utf8";
  }

  if (rawVal.includes('"')) {
    return false; // Stray double quote
  }
  const val = rawVal.toLowerCase();
  return val === "utf-8" || val === "utf8";
}

const GENUINE_AUTH_ERROR_NAMES = new Set([
  "authsessionmissingerror",
  "authinvalidcredentialserror",
  "authinvalidtokenresponseerror",
  "sessionmissingerror",
  "invalidtokenerror",
  "tokenexpirederror",
  "jwtexpirederror",
]);

const GENUINE_AUTH_ERROR_CODES = new Set([
  "session_not_found",
  "session_expired",
  "bad_jwt",
  "jwt_expired",
  "invalid_jwt",
  "invalid_token",
  "token_expired",
  "invalid_credentials",
  "user_not_found",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "not_authenticated",
  "unauthorized",
  "auth_session_missing",
  "no_authorization",
  "bad_oauth_callback",
  "otp_expired",
  "flow_state_not_found",
  "flow_state_expired",
]);

export function isGenuineNoSessionAuthError(
  error:
    | { status?: number; message?: string; name?: string; code?: string }
    | null
    | undefined,
): boolean {
  if (!error) return true;
  if (typeof error.status !== "number") return false;
  if (error.status !== 400 && error.status !== 401) return false;

  const name = (error.name || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const code = (error.code || "").trim().toLowerCase().replace(/-/g, "_");

  if (name && GENUINE_AUTH_ERROR_NAMES.has(name)) {
    return true;
  }
  if (code && GENUINE_AUTH_ERROR_CODES.has(code)) {
    return true;
  }

  return false;
}

export async function readJsonStreamWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; data: unknown } | { ok: false; status: 400 | 413 }> {
  const body = request.body;
  if (!body) {
    return { ok: false, status: 400 };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          return { ok: false, status: 413 };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (totalBytes === 0) {
    return { ok: false, status: 400 };
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(combined);
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch {
    return { ok: false, status: 400 };
  }
}
