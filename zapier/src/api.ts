/**
 * Every request the app makes goes through here: the headers, the host check and the mapping of the API's answers to
 * Zapier's errors (spec 0144, AC-1, AC-3, AC-7).
 *
 * Copies of the same knowledge live in `mcp/src/api.ts` (`hintFor`), `mcp/raycast/src/lib/api.ts` (`failureFor`) and
 * `extension/src/lib/api.ts`; each cites the others, and a change to an error code they branch on is checked in all of
 * them (ADR 0022 Decision 4, ADR 0023). This package imports nothing from any of them.
 *
 * The key is sent only in `Authorization` and is kept out of every message: Zapier keeps it and shows it nowhere, and
 * this file drops it from the API's text should the API ever echo it. No client hint is sent (spec 0143 Decision 2),
 * so the API records a link made here as `api`.
 */
import type { AfterResponseMiddleware, BeforeRequestMiddleware, ZObject } from "zapier-platform-core";
import { errorUnavailable, errorWithCode, errorWithoutCode, ERROR_UNEXPECTED } from "./texts.js";

export const API_BASE_URL = "https://api.linkonda.com";

/** The longest API text shown; `DESTINATION_BLOCKED` is exempt (see `messageFor`). */
const MAX_API_TEXT = 500;

/** Zapier asks the user to reconnect. */
const EXPIRED_AUTH = new Set(["INVALID_API_KEY", "API_KEY_REVOKED", "UNAUTHORIZED"]);
/** This item's data is wrong; the Zap stays on. */
const HALTED = new Set([
  "DESTINATION_BLOCKED",
  "INVALID_URL",
  "VALIDATION_FAILED",
  "SLUG_INVALID",
  "RESERVED_SLUG",
  "SLUG_TAKEN",
  "EXPIRES_IN_DAYS_OUT_OF_RANGE",
]);

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** The key as the user typed it, without the spaces a paste brings. */
export const apiKeyOf = (authData: Record<string, string> | undefined): string => (authData?.apiKey ?? "").trim();

export const beforeRequest: BeforeRequestMiddleware = (request, z, bundle) => {
  // Before anything leaves: no request goes to another host, whatever a later change builds (AC-7).
  if (!request.url.startsWith(`${API_BASE_URL}/`)) throw new z.errors.Error(ERROR_UNEXPECTED);
  const key = apiKeyOf(bundle.authData);
  request.headers = {
    ...request.headers,
    Accept: "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  // A redirect would carry the Authorization header to wherever it points; the afterResponse below answers it as E-4.
  request.redirect = "manual";
  request.skipThrowForStatus = true;
  // Core 18 and later throw on 429 before afterResponse; `RATE_LIMITED` is mapped there, with its Retry-After.
  (request as { throwForThrottlingEarly?: boolean }).throwForThrottlingEarly = false;
  return request;
};

/** E-1 (code and text) or E-2 (no code), with the key removed. */
function messageFor(code: string | undefined, text: string | undefined, status: number, key: string): string {
  if (code === undefined || text === undefined || text === "") return errorWithoutCode(status);
  let clean = key ? text.split(key).join("") : text;
  // The refusal text for a flagged destination carries Google's attribution and notice at its end (ADR 0012): a cut
  // would drop what Google's terms require. The API bounds that text itself.
  if (code !== "DESTINATION_BLOCKED") clean = clean.slice(0, MAX_API_TEXT);
  return errorWithCode(clean, code, status);
}

/** The delay Zapier waits on `RATE_LIMITED`: `Retry-After` when whole seconds, else a minute. */
function throttleDelay(retryAfter: string | null | undefined): number {
  return retryAfter !== null && retryAfter !== undefined && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : 60;
}

/** Answers that end an unsubscribe without an error (R-3: a revoked key's subscriptions are gone). */
export function isGoneAnswer(status: number, code: string | undefined): boolean {
  return (
    (status === 404 && code === "WEBHOOK_SUBSCRIPTION_NOT_FOUND") ||
    (status === 401 && (code === "INVALID_API_KEY" || code === "API_KEY_REVOKED"))
  );
}

/** Map every non-2xx answer; the code decides whatever the status, except 5xx (AC-3). */
export const mapErrors: AfterResponseMiddleware = (response, z, bundle) => {
  const status = response.status;
  if (status >= 200 && status < 300) return response;
  const data: unknown = response.data;
  // Unsubscribe marks its request: a subscription already gone is the outcome it wanted (AC-3's exception).
  if (response.request?.middlewareData?.unsubscribe === true) {
    const code = typeof data === "object" && data !== null ? asString((data as { code?: unknown }).code) : undefined;
    if (isGoneAnswer(status, code)) return response;
    // A 5xx is retried by `unsubscribeWithRetry`, which throws it after the last attempt (spec 0163 AC-5).
    if (status >= 500) return response;
  }
  throw errorFor(z, status, data, response.headers?.get("retry-after"), apiKeyOf(bundle.authData));
};

export function errorFor(
  z: ZObject,
  status: number,
  data: unknown,
  retryAfter: string | null | undefined,
  key: string,
): Error {
  const body = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const code = asString(body.code);
  if (status >= 500) return new z.errors.Error(errorUnavailable(status), code, status);
  if (status >= 300 && status < 400) return new z.errors.Error(ERROR_UNEXPECTED, undefined, status);
  const message = messageFor(code, asString(body.error), status, key);
  if (code !== undefined && EXPIRED_AUTH.has(code)) return new z.errors.ExpiredAuthError(message);
  if (code === "RATE_LIMITED") return new z.errors.ThrottledError(message, throttleDelay(retryAfter));
  if (code !== undefined && HALTED.has(code)) return new z.errors.HaltedError(message);
  return new z.errors.Error(message, code, status);
}
