/** Thin client over the Linkonda REST API. Mirrors docs/api-requests-reference.md. */
import { createRequire } from "node:module";

const DEFAULT_BASE_URL = "https://api.linkonda.com";

// `../package.json` resolves the same from src/ under tsx and from dist/ once built (as in index.ts).
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * Attribution only: the API records links made through this server as `creation_source: "mcp"` so their
 * use can be counted. It names the program and its version, nothing about the user, and grants nothing.
 */
const CLIENT_HINT = `mcp/${version}`;

export type PlanTier = "anonymous" | "free" | "plus" | "pro" | "enterprise";

/**
 * Response of `POST /api/links` and each entry of a batch create.
 *
 * Note it does **not** echo the destination — callers that want to show it must keep the URL
 * they sent. `savedToAccount` is the authoritative anonymous/authenticated signal.
 */
export type CreatedLink = {
  id: string;
  slug: string;
  shortUrl: string;
  clickCount: number;
  savedToAccount: boolean;
  tier: PlanTier;
  expiresAt: string | null;
  lifetimeUnlimited: boolean;
};

/** Batch create is partial-success: some entries can fail while others are created. */
export type BatchCreateResult = {
  ok: number;
  created: CreatedLink[];
  failed: { index: number; url: string; error: string; code?: string }[];
};

/** One destination of an A/B split link, with its own aggregate count. */
export type Variant = { key: string; targetUrl: string; weight: number; clickCount: number };

/** Entry of a 409 `SLUG_AMBIGUOUS`'s `matches`; `hostname` is null for Linkonda's own short-link host. */
export type SlugMatch = { linkId: string; hostname: string | null };

/**
 * Entry of `GET /api/links`. The destination is `targetUrl`, and paused state is a timestamp. For an A/B split link
 * `targetUrl` is only the fallback; `variants` holds each destination (`[]` for a plain link).
 */
export type AccountLink = {
  id: string;
  slug: string;
  shortUrl: string;
  targetUrl: string;
  clickCount: number;
  expiresAt: string | null;
  createdAt: string;
  pausedAt: string | null;
  abEnabled?: boolean;
  abWinnerVariant?: string | null;
  variants?: Variant[];
};

/** `GET /api/links/{slug}/stats`. `variants` is the owner's view only (by session or a paid key); null for anyone else. */
export type LinkStats = {
  clickCount: number;
  abEnabled?: boolean;
  /**
   * The owner's view only (spec 0015): true when the owner's plan has no A/B split links now, so every click goes to
   * the primary destination and the variant counts are as of the plan change. Null for anyone else; absent on older APIs.
   */
  abDormant?: boolean | null;
  abWinnerVariant?: string | null;
  variants?: Variant[] | null;
};

export type Quota = {
  tier: PlanTier;
  active: number;
  maxActive: number | null;
  unlimited: boolean;
  anonLinkTtlDays: number;
  freeLinkTtlDays: number;
  plusLinkTtlDays: number;
};

/**
 * An error the model should be able to act on.
 *
 * `code` is the API's stable machine-readable code (see the API error codes page); `hint` is
 * added here to turn the common failures into a next step rather than a dead end.
 */
export class LinkondaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "LinkondaError";
  }
}

/**
 * True for routes addressing one link by slug — `/api/links/{slug}`, but not `/api/links` itself nor the batch
 * routes. Only the real batch routes are excluded: a slug such as `batchsale` is still a link.
 */
function isSlugRoute(path: string): boolean {
  return /^\/api\/links\/[^/]+/.test(path) && !/^\/api\/links\/batch-(create|delete|patch)(?:\?|$)/.test(path);
}

/** True for `/api/links/{slug}/stats`, with or without a query. */
function isStatsRoute(path: string): boolean {
  return /^\/api\/links\/[^/?]+\/stats(?:\?|$)/.test(path);
}

export const QUOTA_HINT_ANONYMOUS =
  "Anonymous links are limited per network, and this network has reached the limit (check_quota shows it). A slot frees up when one of them expires. To create more from here, set LINKONDA_API_KEY; API keys need a paid plan (https://linkonda.com/pricing).";

export const QUOTA_HINT_ACCOUNT =
  "Your plan's limit on active links is reached (check_quota shows the numbers). Paused, expired and deleted links don't count toward it: pause or delete links you no longer need, or move to a plan with a higher limit (https://linkonda.com/pricing).";

export const QUOTA_HINT_RESUME =
  "Resuming this link would go over your plan's limit on active links (check_quota shows the numbers). Pause or delete another link first, or move to a plan with a higher limit (https://linkonda.com/pricing).";

export const CUSTOM_SLUG_HINT =
  "Custom short codes are not available on any Linkonda plan, so upgrading won't enable them. Call shorten_link again without slug to get a generated short code.";

/** The API's code for a refused destination; one constant, so a typo can't silently drop the hint. */
export const DESTINATION_BLOCKED = "DESTINATION_BLOCKED" as const;

/** The API's code for a slug the account uses on more than one host; one constant, as above. */
export const SLUG_AMBIGUOUS = "SLUG_AMBIGUOUS" as const;

/**
 * The API's `DESTINATION_BLOCKED` text carries what Google's terms require of a warning based on its lists: a
 * qualifier ("suspected"), a learn-more link, "Advisory provided by Google" with its link, and a notice that the
 * lists can be wrong (Linkonda spec 0032). A model that paraphrases it can drop those, so this asks it not to.
 */
export const DESTINATION_BLOCKED_HINT =
  "Linkonda refused this destination. Relay the message above to the user as written, including any \"Advisory provided by Google\" line and its links, and don't describe the destination as certainly unsafe. Retrying the same URL gives the same answer.";

export const NOT_FOUND_HINT_LINK =
  "No link with that short code on your account. Check the slug (the part after the domain, not the full URL). A deleted link is not found. With linkId, only the link that has both that linkId and this short code is found.";

export const NOT_FOUND_HINT_STATS =
  "No link with that short code. Check the slug (the part after the domain, not the full URL). A deleted link is not found. Without host, get_link_stats looks only on Linkonda's own short-link host; for a link on a custom domain, set host to the hostname of the verified custom domain the link is on, such as links.example.com.";

export const SLUG_AMBIGUOUS_HINT_NO_MATCHES =
  "More than one of your links uses this short code, and the API's answer didn't list them. Call the tool again with the same slug and linkId set to the link you mean.";

/** The 409 `SLUG_AMBIGUOUS` hint: each candidate's linkId and host, in the API's order. Exported for backlog 0003. */
export function slugAmbiguousHint(matches: SlugMatch[]): string {
  if (matches.length === 0) return SLUG_AMBIGUOUS_HINT_NO_MATCHES;
  return [
    "More than one of your links uses this short code:",
    ...matches.map((m) => `  linkId ${m.linkId}: on ${m.hostname ?? "Linkonda's own short-link host"}`),
    "Call the tool again with the same slug and linkId set to the link you mean.",
  ].join("\n");
}

/**
 * Waiting frees no quota slot, so a quota refusal says what does. Resume is told apart from create
 * by its slug route (it needs another link out of the way); otherwise the API's `tier` wins over
 * whether a key is set, as in `check_quota`.
 */
function quotaHint(tier: string | undefined, hasKey: boolean, path: string): string {
  if (isSlugRoute(path)) return QUOTA_HINT_RESUME;
  if (tier === "anonymous") return QUOTA_HINT_ANONYMOUS;
  if (tier !== undefined || hasKey) return QUOTA_HINT_ACCOUNT;
  return QUOTA_HINT_ANONYMOUS;
}

// The daily screening allowance answers 429 with a Retry-After that runs to 00:00 UTC, so "a moment" is wrong there.
function rateLimitHint(retryAfter: string | null | undefined): string {
  const s = retryAfter != null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
  if (s === null) return "Rate limited. Wait a moment before retrying.";
  if (s <= 90) return `Rate limited. Retry in ${s} ${s === 1 ? "second" : "seconds"}.`;
  if (s <= 5400) return `Rate limited. Retry in about ${Math.ceil(s / 60)} minutes.`;
  return `Rate limited. Retry in about ${Math.ceil(s / 3600)} hours.`;
}

/** Exported so it can be unit-tested without a stub API (backlog 0003). */
export function hintFor(
  status: number,
  code: string | undefined,
  hasKey: boolean,
  path: string,
  extra: { tier?: string; retryAfter?: string | null; matches?: SlugMatch[] } = {},
): string | undefined {
  // Before the status branches: the code alone decides, whatever the status (400, or a batch entry's).
  if (code === DESTINATION_BLOCKED) return DESTINATION_BLOCKED_HINT;
  if (code === SLUG_AMBIGUOUS) return slugAmbiguousHint(extra.matches ?? []);
  // M-3 to M-5 (spec 0015, Q-0060): the plans that have API keys and bulk creation, and what to do about a key beyond
  // the plan's count. They name plans, so they change with the API's table.
  if (code === "API_KEY_REQUIRES_PAID") {
    return "This API key belongs to a Free account. API keys need the Starter, Pro or Business plan: https://linkonda.com/pricing";
  }
  if (code === "BATCH_CREATE_REQUIRES_PRO") {
    return "Creating links in bulk needs the Pro or Business plan (https://linkonda.com/pricing). Use shorten_link for one URL at a time.";
  }
  // The server sends no `POST /api/api-keys`, so this is always a key beyond the account's count, on any status.
  if (code === "API_KEY_LIMIT_EXCEEDED") {
    return "This account has more API keys than its plan allows, and this key is not among the oldest that keep working. Revoke an older key at https://linkonda.com/api-keys, or put an older key in LINKONDA_API_KEY.";
  }
  // Both codes mean the same today: no plan has custom codes, so the API's "requires a paid plan" would send a
  // Free caller to upgrade for nothing.
  if (code === "CUSTOM_SLUG_UNSUPPORTED" || code === "CUSTOM_SLUG_REQUIRES_PAID") {
    return CUSTOM_SLUG_HINT;
  }
  if (status === 401) {
    return hasKey
      ? "The LINKONDA_API_KEY appears to be invalid or revoked. Create a new key in the Linkonda dashboard."
      : "This action needs an API key. Set LINKONDA_API_KEY in the MCP server config — create one at https://linkonda.com/api-keys (paid plans).";
  }
  if (status === 404) {
    // A 404 means two different things here. On a slug route the link is missing (stats look on one host, the
    // link routes among the account's own links); anywhere else the route itself is missing, which in practice
    // means the base URL points somewhere wrong.
    if (isStatsRoute(path)) return NOT_FOUND_HINT_STATS;
    if (isSlugRoute(path)) return NOT_FOUND_HINT_LINK;
    return "That API endpoint does not exist. Check LINKONDA_API_BASE_URL — it should point at a Linkonda API host (default https://api.linkonda.com).";
  }
  if (status === 429) {
    return code === "QUOTA_EXCEEDED" ? quotaHint(extra.tier, hasKey, path) : rateLimitHint(extra.retryAfter);
  }
  return undefined;
}

export class LinkondaClient {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey?: string,
    baseUrl: string = DEFAULT_BASE_URL,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  get authenticated(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * @param auth `required` rejects before the round trip when no key is set; `optional` sends the
   * key when present (the API then answers for that account rather than anonymously); `never`
   * deliberately omits it so the request is treated as anonymous.
   */
  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; auth: "required" | "optional" | "never" } = { auth: "optional" },
  ): Promise<T> {
    if (options.auth === "required" && !this.apiKey) {
      throw new LinkondaError(
        "This tool requires a Linkonda API key.",
        401,
        "NO_API_KEY",
        hintFor(401, undefined, false, path),
      );
    }

    const headers: Record<string, string> = { Accept: "application/json", "X-Linkonda-Client": CLIENT_HINT };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    // When an Authorization header is present the API validates only the key and never falls
    // back to a session, so a bad key fails cleanly instead of acting as someone else.
    if (this.apiKey && options.auth !== "never") headers.Authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (cause) {
      throw new LinkondaError(
        `Could not reach the Linkonda API at ${this.baseUrl}: ${(cause as Error).message}`,
        0,
      );
    }

    const text = await response.text();
    const payload = text ? safeJson(text) : undefined;

    if (!response.ok) {
      const code = typeof payload?.code === "string" ? payload.code : undefined;
      const message =
        (typeof payload?.message === "string" && payload.message) ||
        (typeof payload?.error === "string" && payload.error) ||
        `Request failed with HTTP ${response.status}`;
      // `tier`, Retry-After and `matches` are read only to choose the hint.
      const hint = hintFor(response.status, code, this.authenticated, path, {
        tier: typeof payload?.tier === "string" ? payload.tier : undefined,
        retryAfter: response.headers.get("retry-after"),
        matches: code === SLUG_AMBIGUOUS ? slugMatches(payload?.matches) : undefined,
      });
      throw new LinkondaError(message, response.status, code, hint);
    }

    return payload as T;
  }

  /** Anonymous when no key is set: 10 links per network, expiring after the anon TTL. */
  createLink(input: { url: string; expiresInDays?: number; slug?: string }) {
    return this.request<CreatedLink>("POST", "/api/links", { body: input, auth: "optional" });
  }

  /** Batch create is not available anonymously, and is partial-success — always read `failed`. */
  createLinks(links: { url: string; expiresInDays?: number }[]) {
    return this.request<BatchCreateResult>("POST", "/api/links/batch-create", {
      body: { links },
      auth: "required",
    });
  }

  listLinks() {
    return this.request<{ links: AccountLink[] }>("GET", "/api/links", { auth: "required" });
  }

  /** `linkId` picks one of the account's links sharing this slug (on different hosts); see `SLUG_AMBIGUOUS`. */
  updateLink(slug: string, patch: { url?: string; paused?: boolean }, linkId?: string) {
    return this.request<{ shortUrl?: string }>(
      "PATCH",
      `/api/links/${encodeURIComponent(slug)}${query("linkId", linkId)}`,
      { body: patch, auth: "required" },
    );
  }

  deleteLink(slug: string, linkId?: string) {
    return this.request<unknown>("DELETE", `/api/links/${encodeURIComponent(slug)}${query("linkId", linkId)}`, {
      auth: "required",
    });
  }

  /**
   * Public endpoint — returns the total redirect count and nothing about who followed the link; `variants` only
   * to the owner. `host` names a custom domain; without it the API looks on Linkonda's own short-link host.
   */
  getStats(slug: string, host?: string) {
    return this.request<LinkStats>(
      "GET",
      `/api/links/${encodeURIComponent(slug)}/stats${query("host", host)}`,
      { auth: "optional" },
    );
  }

  getQuota() {
    return this.request<Quota>("GET", "/api/quota", { auth: "optional" });
  }
}

/**
 * `?name=value` when `value` is non-empty after trimming, else nothing: empty means absent, as the API treats an
 * empty `linkId` as none, so the request stays byte-equal to one without the argument.
 */
function query(name: "linkId" | "host", value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? `?${new URLSearchParams({ [name]: trimmed })}` : "";
}

/**
 * The 409 `SLUG_AMBIGUOUS` body's `matches`, read only to tell the model which linkIds it can pass. Entries
 * without a usable linkId are dropped; a missing or empty `hostname` means Linkonda's own short-link host.
 */
function slugMatches(raw: unknown): SlugMatch[] {
  if (!Array.isArray(raw)) return [];
  const out: SlugMatch[] = [];
  for (const m of raw) {
    if (typeof m !== "object" || m === null) continue;
    const { linkId, hostname } = m as Record<string, unknown>;
    if (typeof linkId !== "string" || linkId === "") continue;
    out.push({ linkId, hostname: typeof hostname === "string" && hostname !== "" ? hostname : null });
  }
  return out;
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
