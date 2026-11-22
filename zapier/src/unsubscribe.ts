/**
 * `performUnsubscribe`'s request, with retries (spec 0163). Zapier calls unsubscribe once when a Zap is turned off and
 * documents no retry of a failure, so a transient 5xx or a timeout would leave the hook URL and secret stored until
 * a 410 that may never come. The schedule: 4 attempts, waits of 1, 2 and 4 s, 4 s per attempt, so at most 23 s of
 * Zapier's 30 s. Only this request retries; subscribe, create, list and the connection test make one attempt each.
 *
 * Every attempt is the same request (0144 AC-4). A 200, and the answers `mapErrors` counts as gone (404
 * `WEBHOOK_SUBSCRIPTION_NOT_FOUND`, 401 `INVALID_API_KEY` or `API_KEY_REVOKED`), end it on any attempt: a 404 on a
 * later attempt also covers an earlier one that timed out after the API had committed. Any other answer, 429
 * included, is final and `mapErrors` throws it at once. Only a 5xx (returned by `mapErrors` for this request, whatever
 * its body) or no answer is tried again.
 */
import type { Bundle, ZObject } from "zapier-platform-core";
import { API_BASE_URL, apiKeyOf, errorFor } from "./api.js";

export const UNSUBSCRIBE_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
/** Core passes `timeout` to node-fetch, which rejects with a `FetchError` (`request-timeout`) when it passes. */
export const UNSUBSCRIBE_ATTEMPT_TIMEOUT_MS = 4000;

/** The wait between attempts; tests replace `wait` so they don't sit through the schedule. */
export const retryTiming = {
  wait: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** An error Zapier's own classes made (from `mapErrors` or `beforeRequest`): final, never a transport failure. */
function isZapierError(z: ZObject, e: unknown): boolean {
  // `z.errors` holds a helper that is not a class, so only a function with a prototype is tested.
  return Object.values(z.errors).some((C) => typeof C === "function" && typeof C.prototype === "object" && e instanceof C);
}

export async function unsubscribeWithRetry(z: ZObject, bundle: Bundle, id: string): Promise<void> {
  const url = `${API_BASE_URL}/api/webhooks/subscriptions/${encodeURIComponent(id)}`;
  for (let attempt = 0; ; attempt++) {
    let failed: { error: unknown } | { status: number; data: unknown };
    try {
      const response = await z.request({
        url,
        method: "DELETE",
        timeout: UNSUBSCRIBE_ATTEMPT_TIMEOUT_MS,
        // `mapErrors` lets a subscription that is already gone count as ended (AC-3's exception), and hands a 5xx
        // back to this loop instead of throwing it.
        middlewareData: { unsubscribe: true },
      });
      if (response.status < 500) return;
      failed = { status: response.status, data: response.data };
    } catch (e) {
      if (isZapierError(z, e)) throw e;
      failed = { error: e };
    }
    const delay = UNSUBSCRIBE_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      if ("error" in failed) throw failed.error;
      throw errorFor(z, failed.status, failed.data, null, apiKeyOf(bundle.authData));
    }
    await retryTiming.wait(delay);
  }
}
