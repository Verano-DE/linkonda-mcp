import { createHmac, timingSafeEqual } from "node:crypto";
import type { Trigger } from "zapier-platform-core";
import { API_BASE_URL } from "../api.js";
import { TRIGGER_SAMPLE } from "../samples.js";
import { unsubscribeWithRetry } from "../unsubscribe.js";
import { ERROR_SIGNATURE, ERROR_UNEXPECTED, TRIGGER } from "../texts.js";

/** The eight keys read from an event's `data`; the three of the envelope come first in `TRIGGER_KEYS`. */
export const DATA_KEYS = [
  "linkId",
  "slug",
  "shortUrl",
  "targetUrl",
  "expiresAt",
  "creationSource",
  "hostname",
  "clickCount",
] as const;
type DataKey = (typeof DATA_KEYS)[number];
export const TRIGGER_KEYS = ["id", "type", "createdAt", ...DATA_KEYS] as const;

/**
 * The keys each event's `data` always has: the contract's table (spec 0144, kept by 0158). `hostname` (custom domain),
 * and `shortUrl` on a pause or resume done in bulk, come only sometimes, so they are not here. `performList` fills
 * only these, so a sample never shows a key the real event may lack.
 */
export const EVENT_KEYS: Record<string, readonly DataKey[]> = {
  "link.created": ["slug", "shortUrl", "targetUrl", "creationSource", "expiresAt"],
  "link.updated": ["slug", "shortUrl", "targetUrl"],
  "link.paused": ["slug"],
  "link.resumed": ["slug"],
  "link.deleted": ["slug"],
  "link.first_click": ["slug", "clickCount"],
  "link.will_expire": ["linkId", "slug", "targetUrl", "expiresAt"],
};

/** The Zap's "Event" field. */
const eventOf = (bundle: { inputData: object }): unknown => (bundle.inputData as { event?: unknown }).event;

const SIGNATURE_HEADERS = new Set(["x-linkonda-signature", "http-x-linkonda-signature"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Fail closed (Decision 4): a hook URL that leaked must not start Zaps. Any missing piece, a length difference or a
 * mismatch is false; there is no path that skips the check. The lengths are compared first because `timingSafeEqual`
 * throws on unequal lengths.
 */
export function verifySignature(
  headers: Record<string, unknown> | undefined,
  content: unknown,
  secret: unknown,
): boolean {
  if (typeof content !== "string" || content === "" || typeof secret !== "string" || secret === "") return false;
  let received: string | undefined;
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (SIGNATURE_HEADERS.has(name.toLowerCase()) && typeof value === "string") received = value;
  }
  if (received === undefined) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(content, "utf8").digest("hex")}`, "utf8");
  const actual = Buffer.from(received.trim(), "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const KEY_TYPES: Partial<Record<(typeof TRIGGER_KEYS)[number], "datetime" | "integer">> = {
  createdAt: "datetime",
  expiresAt: "datetime",
  clickCount: "integer",
};

export const linkEvent: Trigger = {
  key: "link_event",
  noun: TRIGGER.noun,
  display: { label: TRIGGER.label, description: TRIGGER.description },
  operation: {
    type: "hook",
    inputFields: [
      {
        key: "event",
        label: TRIGGER.event.label,
        helpText: TRIGGER.event.helpText,
        required: true,
        choices: TRIGGER.choices,
      },
    ],
    performSubscribe: async (z, bundle) => {
      const response = await z.request({
        url: `${API_BASE_URL}/api/webhooks/subscriptions`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: bundle.targetUrl, event: eventOf(bundle) }),
      });
      const data: unknown = response.data;
      const d = isObject(data) ? data : {};
      if (response.status !== 201 || typeof d.id !== "string" || typeof d.secret !== "string" || !d.secret.startsWith("whsec_")) {
        throw new z.errors.Error(ERROR_UNEXPECTED, undefined, response.status);
      }
      // Exactly these two: Zapier keeps them as `subscribeData` and the URL is the one Zapier already has.
      return { id: d.id, secret: d.secret };
    },
    performUnsubscribe: async (z, bundle) => {
      const id = bundle.subscribeData?.id;
      // Nothing was stored: nothing to end.
      if (typeof id !== "string") return {};
      await unsubscribeWithRetry(z, bundle, id);
      return {};
    },
    perform: async (z, bundle) => {
      const stored = bundle.subscribeData as { secret?: unknown } | undefined;
      const raw = bundle.rawRequest;
      if (!verifySignature(raw?.headers, raw?.content, stored?.secret)) {
        throw new z.errors.HaltedError(ERROR_SIGNATURE);
      }
      let envelope: unknown;
      try {
        envelope = JSON.parse(raw!.content!);
      } catch {
        throw new z.errors.HaltedError(ERROR_UNEXPECTED);
      }
      if (!isObject(envelope) || typeof envelope.id !== "string" || typeof envelope.type !== "string") {
        throw new z.errors.HaltedError(ERROR_UNEXPECTED);
      }
      if (envelope.type !== eventOf(bundle)) return [];
      const data = isObject(envelope.data) ? envelope.data : {};
      const out: Record<string, unknown> = {};
      // Only the eight keys, so a `data` key named id, type or createdAt can't override the envelope's.
      for (const key of DATA_KEYS) out[key] = data[key] ?? null;
      return [
        {
          id: envelope.id,
          type: envelope.type,
          createdAt: typeof envelope.createdAt === "string" ? envelope.createdAt : null,
          ...out,
        },
      ];
    },
    performList: async (z, bundle) => {
      const response = await z.request({ url: `${API_BASE_URL}/api/links?limit=3`, method: "GET" });
      const data: unknown = response.data;
      const links = isObject(data) ? data.links : undefined;
      if (!Array.isArray(links)) throw new z.errors.Error(ERROR_UNEXPECTED, undefined, response.status);
      const event = String(eventOf(bundle));
      const keys = EVENT_KEYS[event] ?? [];
      const now = new Date().toISOString();
      return links.filter(isObject).map((link) => {
        const from: Record<DataKey, unknown> = {
          linkId: link.id,
          slug: link.slug,
          shortUrl: link.shortUrl,
          targetUrl: link.targetUrl,
          expiresAt: link.expiresAt,
          // The list has no creation source (AC-6).
          creationSource: null,
          hostname: null,
          clickCount: 1,
        };
        const item: Record<string, unknown> = {
          id: `sample_${String(link.id)}`,
          type: event,
          createdAt: event === "link.created" && typeof link.createdAt === "string" ? link.createdAt : now,
        };
        for (const key of DATA_KEYS) item[key] = keys.includes(key) ? (from[key] ?? null) : null;
        return item;
      });
    },
    sample: TRIGGER_SAMPLE,
    outputFields: TRIGGER_KEYS.map((key) => {
      const type = KEY_TYPES[key];
      return { key, label: TRIGGER.outputs[key], ...(type ? { type } : {}) };
    }),
  },
};
