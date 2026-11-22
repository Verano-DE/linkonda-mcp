import { createHmac } from "node:crypto";
import nock from "nock";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { retryTiming } from "../src/unsubscribe.js";
import { EVENT_KEYS, TRIGGER_KEYS, verifySignature } from "../src/triggers/link-event.js";
import { API, app, appTester, authData, bundleFor, failure, KEY } from "./helpers.js";

const op = app.triggers.link_event.operation;
const HOOK = "https://hooks.zapier.com/hooks/standard/1/abc/";
const SECRET = `whsec_${"ab".repeat(32)}`;

describe("subscribe and unsubscribe", () => {
  it("subscribe posts targetUrl and event and keeps only id and secret", async () => {
    const scope = nock(API, { reqheaders: { authorization: `Bearer ${KEY}`, "content-type": "application/json" } })
      .post("/api/webhooks/subscriptions", { url: HOOK, event: "link.created" })
      .reply(201, {
        id: "whs_abc",
        event: "link.created",
        url: HOOK,
        secret: SECRET,
        createdAt: "2026-11-22T09:00:00.000Z",
      });
    const out = await appTester(op.performSubscribe, bundleFor({ event: "link.created" }, { targetUrl: HOOK }));
    expect(out).toEqual({ id: "whs_abc", secret: SECRET });
    expect(scope.isDone()).toBe(true);
  });

  it("a subscribe answer without id or a whsec_ secret is unexpected", async () => {
    for (const body of [
      { secret: SECRET },
      { id: "whs_abc" },
      { id: "whs_abc", secret: "abc" },
      { id: 4, secret: SECRET },
    ]) {
      nock(API).post("/api/webhooks/subscriptions").reply(201, body);
      expect(
        await failure(() => appTester(op.performSubscribe, bundleFor({ event: "link.created" }, { targetUrl: HOOK }))),
      ).toMatchObject({ name: "AppError", message: "Linkonda returned an unexpected response." });
    }
  });

  it("WEBHOOK_REQUIRES_PAID stops the subscribe", async () => {
    nock(API)
      .post("/api/webhooks/subscriptions")
      .reply(403, { error: "Webhooks need the Pro or Business plan.", code: "WEBHOOK_REQUIRES_PAID" });
    expect(
      await failure(() => appTester(op.performSubscribe, bundleFor({ event: "link.created" }, { targetUrl: HOOK }))),
    ).toMatchObject({ name: "AppError", code: "WEBHOOK_REQUIRES_PAID", status: 403 });
  });

  it("unsubscribe deletes the stored id", async () => {
    const scope = nock(API, { reqheaders: { authorization: `Bearer ${KEY}` } })
      .delete("/api/webhooks/subscriptions/whs_a%2Fb")
      .reply(200, { ok: true });
    await appTester(op.performUnsubscribe, bundleFor({ event: "link.created" }, { subscribeData: { id: "whs_a/b" } }));
    expect(scope.isDone()).toBe(true);
  });

  it("unsubscribe ends on WEBHOOK_SUBSCRIPTION_NOT_FOUND", async () => {
    nock(API)
      .delete("/api/webhooks/subscriptions/whs_x")
      .reply(404, { error: "Not found.", code: "WEBHOOK_SUBSCRIPTION_NOT_FOUND" });
    await expect(
      appTester(op.performUnsubscribe, bundleFor({}, { subscribeData: { id: "whs_x" } })),
    ).resolves.toBeDefined();
  });

  it("… on API_KEY_REVOKED and INVALID_API_KEY", async () => {
    for (const code of ["API_KEY_REVOKED", "INVALID_API_KEY"]) {
      nock(API).delete("/api/webhooks/subscriptions/whs_x").reply(401, { error: "No.", code });
      await expect(
        appTester(op.performUnsubscribe, bundleFor({}, { subscribeData: { id: "whs_x" } })),
      ).resolves.toBeDefined();
    }
    // The exception is for unsubscribe only, and only for these answers.
    nock(API).delete("/api/webhooks/subscriptions/whs_x").reply(401, { error: "No.", code: "UNAUTHORIZED" });
    expect(await failure(() => appTester(op.performUnsubscribe, bundleFor({}, { subscribeData: { id: "whs_x" } })))).toMatchObject({
      name: "ExpiredAuthError",
    });
    nock(API).post("/api/webhooks/subscriptions").reply(401, { error: "No.", code: "API_KEY_REVOKED" });
    expect(
      await failure(() => appTester(op.performSubscribe, bundleFor({ event: "link.created" }, { targetUrl: HOOK }))),
    ).toMatchObject({ name: "ExpiredAuthError" });
  });

  describe("unsubscribe retries (spec 0163)", () => {
    const PATH = "/api/webhooks/subscriptions/whs_x";
    const run = () => appTester(op.performUnsubscribe, bundleFor({}, { subscribeData: { id: "whs_x" } }));
    /** Records the waits and resolves at once. */
    const waits = () => {
      const spy = vi.spyOn(retryTiming, "wait").mockResolvedValue(undefined);
      onTestFinished(() => spy.mockRestore());
      return spy;
    };

    it("unsubscribe retries a 5xx and ends on the next 200", async () => {
      const spy = waits();
      const scope = nock(API).delete(PATH).reply(503, { error: "x" }).delete(PATH).reply(200, { ok: true });
      await run();
      expect(scope.isDone()).toBe(true);
      expect(spy.mock.calls.map((c) => c[0])).toEqual([1000]);
    });

    it("unsubscribe retries a transport error", async () => {
      const spy = waits();
      const scope = nock(API).delete(PATH).replyWithError("socket hang up").delete(PATH).reply(200, { ok: true });
      await run();
      expect(scope.isDone()).toBe(true);
      expect(spy.mock.calls.map((c) => c[0])).toEqual([1000]);
    });

    // A real 4.1 s delay on purpose: the only proof that core honours the per-attempt `timeout`.
    it("unsubscribe retries an attempt with no answer within 4 seconds", async () => {
      const spy = waits();
      const scope = nock(API).delete(PATH).delay(4100).reply(200, { ok: true }).delete(PATH).reply(200, { ok: true });
      await run();
      expect(scope.isDone()).toBe(true);
      expect(spy.mock.calls.map((c) => c[0])).toEqual([1000]);
    }, 10_000);

    it("a gone answer on a retry ends without error", async () => {
      waits();
      const scope = nock(API)
        .delete(PATH)
        .reply(503, { error: "x" })
        .delete(PATH)
        .reply(404, { error: "Not found.", code: "WEBHOOK_SUBSCRIPTION_NOT_FOUND" });
      await expect(run()).resolves.toBeDefined();
      expect(scope.isDone()).toBe(true);
    });

    it("unsubscribe does not retry a 429", async () => {
      const spy = waits();
      const scope = nock(API).delete(PATH).reply(429, { error: "Too many requests", code: "RATE_LIMITED" }, { "Retry-After": "7" });
      expect(await failure(run)).toMatchObject({ name: "ThrottledError", delay: 7 });
      expect(scope.isDone()).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it("unsubscribe stops at once on any other answer", async () => {
      const spy = waits();
      nock(API).delete(PATH).reply(403, { error: "No.", code: "EMAIL_NOT_VERIFIED" });
      expect(await failure(run)).toMatchObject({ name: "AppError", code: "EMAIL_NOT_VERIFIED", status: 403 });
      nock(API).delete(PATH).reply(401, { error: "No.", code: "UNAUTHORIZED" });
      expect(await failure(run)).toMatchObject({ name: "ExpiredAuthError" });
      expect(nock.pendingMocks()).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("subscribe makes one attempt on a 5xx", async () => {
    const spy = vi.spyOn(retryTiming, "wait").mockResolvedValue(undefined);
    onTestFinished(() => spy.mockRestore());
    const scope = nock(API).post("/api/webhooks/subscriptions").reply(503, { error: "x" });
    expect(
      await failure(() => appTester(op.performSubscribe, bundleFor({ event: "link.created" }, { targetUrl: HOOK }))),
    ).toMatchObject({ status: 503 });
    expect(scope.isDone()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
const envelope = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "evt_1",
    type: "link.created",
    createdAt: "2026-11-22T09:00:00.000Z",
    data: { slug: "spring-sale", shortUrl: "https://lnko.eu/spring-sale", targetUrl: "https://example.com/a", ...data },
    ...over,
  });
const deliver = (
  content: string | undefined,
  headers: Record<string, string>,
  event = "link.created",
  subscribeData: Record<string, unknown> | undefined = { id: "whs_a", secret: SECRET },
) =>
  appTester(op.perform, {
    authData,
    inputData: { event },
    subscribeData,
    rawRequest: { headers, content },
  } as never);
const signed = (content: string) => ({ "Http-X-Linkonda-Signature": sign(content) });
const HALT = { name: "HaltedError", message: "This event wasn't processed because its signature was missing or didn't match." };

describe("an event arrives", () => {
  it("a signed event has exactly the eleven keys", async () => {
    const content = envelope({}, { expiresAt: null });
    const [item, ...rest] = (await deliver(content, signed(content))) as Record<string, unknown>[];
    expect(rest).toEqual([]);
    expect(Object.keys(item!).sort()).toEqual([...TRIGGER_KEYS].sort());
    expect(TRIGGER_KEYS).toHaveLength(11);
    expect(item).toEqual({
      id: "evt_1",
      type: "link.created",
      createdAt: "2026-11-22T09:00:00.000Z",
      linkId: null,
      slug: "spring-sale",
      shortUrl: "https://lnko.eu/spring-sale",
      targetUrl: "https://example.com/a",
      expiresAt: null,
      creationSource: null,
      hostname: null,
      clickCount: null,
    });
  });

  it("data can't override id, type or createdAt", async () => {
    const content = envelope({}, { id: "evil", type: "link.deleted", createdAt: "1999-01-01T00:00:00.000Z", extra: 1 });
    const [item] = (await deliver(content, signed(content))) as Record<string, unknown>[];
    expect(item).toMatchObject({ id: "evt_1", type: "link.created", createdAt: "2026-11-22T09:00:00.000Z" });
    expect(item).not.toHaveProperty("extra");
  });

  const bodyToSign = envelope();
  it.each([
    ["no signature header", bodyToSign, {}, undefined],
    ["another secret", bodyToSign, { "Http-X-Linkonda-Signature": sign(bodyToSign, "whsec_other") }, undefined],
    ["another body", bodyToSign, { "Http-X-Linkonda-Signature": sign(`${bodyToSign} `) }, undefined],
    ["no body", undefined, signed(bodyToSign), undefined],
    ["no stored secret", bodyToSign, signed(bodyToSign), { id: "whs_a" }],
    ["no subscribe data", bodyToSign, signed(bodyToSign), {}],
  ] as const)("a missing or wrong signature halts: %s", async (_name, body, headers, subscribeData) => {
    const extra = subscribeData === undefined ? { id: "whs_a", secret: SECRET } : subscribeData;
    expect(await failure(() => deliver(body, { ...headers }, "link.created", extra))).toMatchObject(HALT);
  });

  it("a signature of another length halts before timingSafeEqual", async () => {
    const content = envelope();
    // `timingSafeEqual` throws on unequal lengths; a different error name would show the check was reached.
    for (const value of ["sha256=abc", `${sign(content)}00`, "", "sha256="]) {
      expect(await failure(() => deliver(content, { "Http-X-Linkonda-Signature": value }))).toMatchObject(HALT);
    }
    expect(verifySignature({ "x-linkonda-signature": "short" }, "{}", SECRET)).toBe(false);
  });

  it("the header is found in any case, with or without Http-", async () => {
    const content = envelope();
    for (const name of ["X-Linkonda-Signature", "x-linkonda-signature", "Http-X-Linkonda-Signature", "HTTP-X-LINKONDA-SIGNATURE"]) {
      const out = (await deliver(content, { [name]: sign(content) })) as unknown[];
      expect(out, name).toHaveLength(1);
    }
  });

  it("another event type returns nothing", async () => {
    const content = envelope({ type: "link.deleted" });
    expect(await deliver(content, signed(content), "link.created")).toEqual([]);
  });

  it("an unsigned event of another type still halts (nothing is read before the check)", async () => {
    const content = envelope({ type: "link.deleted" });
    expect(await failure(() => deliver(content, {}, "link.created"))).toMatchObject(HALT);
  });
});

const link = (n: number) => ({
  id: `id${n}`,
  slug: `s${n}`,
  shortUrl: `https://lnko.eu/s${n}`,
  targetUrl: `https://example.com/${n}`,
  clickCount: 9,
  expiresAt: n === 1 ? "2027-01-01T00:00:00.000Z" : null,
  createdAt: `2026-11-0${n}T09:00:00.000Z`,
  hostname: null,
});

describe("samples", () => {
  it("performList asks for three links", async () => {
    const scope = nock(API, { reqheaders: { authorization: `Bearer ${KEY}`, accept: "application/json" } })
      .get("/api/links")
      .query({ limit: "3" })
      .reply(200, { links: [link(1), link(2), link(3)] });
    const out = (await appTester(op.performList, bundleFor({ event: "link.created" }))) as unknown[];
    expect(out).toHaveLength(3);
    expect(scope.isDone()).toBe(true);
  });

  it("performList fills only each event's keys", async () => {
    // Only Date is faked, so nock's timers still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T10:00:00.000Z"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    for (const [event, keys] of Object.entries(EVENT_KEYS)) {
      nock(API).get("/api/links").query({ limit: "3" }).reply(200, { links: [link(1)] });
      const [item] = (await appTester(op.performList, bundleFor({ event }))) as Record<string, unknown>[];
      expect(Object.keys(item!).sort(), event).toEqual([...TRIGGER_KEYS].sort());
      expect(item).toMatchObject({ id: "sample_id1", type: event });
      const filled = Object.keys(item!).filter(
        (k) => !["id", "type", "createdAt"].includes(k) && item![k] !== null,
      );
      // `expiresAt` of this link is a string, so it counts; `creationSource` is never filled (the list has none).
      const expected = keys.filter((k) => k !== "creationSource");
      expect(filled.sort(), event).toEqual([...expected].sort());
      expect(item!.createdAt, event).toBe(event === "link.created" ? "2026-11-01T09:00:00.000Z" : "2026-11-22T10:00:00.000Z");
      if (event === "link.first_click") expect(item!.clickCount).toBe(1);
      if (event === "link.will_expire") expect(item!.linkId).toBe("id1");
    }
  });

  it("performList with no links returns nothing", async () => {
    nock(API).get("/api/links").query({ limit: "3" }).reply(200, { links: [] });
    expect(await appTester(op.performList, bundleFor({ event: "link.created" }))).toEqual([]);
  });
});
