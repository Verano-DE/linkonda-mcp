import nock from "nock";
import { describe, expect, it } from "vitest";
import { API, app, appTester, authData, bundleFor, failure, KEY } from "./helpers.js";

const create = () => appTester(app.creates.create_link.operation.perform, bundleFor({ url: "https://example.com/a" }));
const answer = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  nock(API).post("/api/links").reply(status, body as never, headers);
const fail = async (status: number, body?: unknown, headers?: Record<string, string>) => {
  answer(status, body, headers);
  return failure(create);
};

const TABLE: [string, number, string][] = [
  ["INVALID_API_KEY", 401, "ExpiredAuthError"],
  ["API_KEY_REVOKED", 401, "ExpiredAuthError"],
  ["UNAUTHORIZED", 401, "ExpiredAuthError"],
  ["DESTINATION_BLOCKED", 400, "HaltedError"],
  ["INVALID_URL", 400, "HaltedError"],
  ["VALIDATION_FAILED", 400, "HaltedError"],
  ["SLUG_INVALID", 400, "HaltedError"],
  ["RESERVED_SLUG", 400, "HaltedError"],
  ["SLUG_TAKEN", 409, "HaltedError"],
  ["EXPIRES_IN_DAYS_OUT_OF_RANGE", 400, "HaltedError"],
  ["API_KEY_REQUIRES_PAID", 403, "AppError"],
  ["API_KEY_LIMIT_EXCEEDED", 403, "AppError"],
  ["EMAIL_NOT_VERIFIED", 403, "AppError"],
  ["QUOTA_EXCEEDED", 403, "AppError"],
  ["CUSTOM_SLUG_REQUIRES_PAID", 403, "AppError"],
  ["CUSTOM_EXPIRY_NOT_ALLOWED", 403, "AppError"],
  ["WEBHOOK_REQUIRES_PAID", 403, "AppError"],
  ["WEBHOOK_SUBSCRIPTION_LIMIT_EXCEEDED", 403, "AppError"],
  ["WEBHOOK_INVALID_URL", 400, "AppError"],
  ["WEBHOOK_URL_BLOCKED", 400, "AppError"],
  ["SOMETHING_NEW", 400, "AppError"],
];

describe("error mapping", () => {
  it.each(TABLE)("maps %s (HTTP %i) to its Zapier error %s", async (code, status, name) => {
    const got = await fail(status, { error: `Text for ${code}.`, code });
    expect(got.name, code).toBe(name);
    expect(got.message, code).toBe(`Text for ${code}. (Linkonda error code ${code}, HTTP ${status})`);
    if (name === "AppError") expect(got).toMatchObject({ code, status });
  });

  it("unsubscribe still fails on a 404 without WEBHOOK_SUBSCRIPTION_NOT_FOUND", async () => {
    const unsubscribe = () => appTester(app.triggers.link_event.operation.performUnsubscribe, bundleFor({}, { subscribeData: { id: "whs_x" } }));
    nock(API).delete("/api/webhooks/subscriptions/whs_x").reply(404, { error: "Nope.", code: "NOT_FOUND" });
    expect(await failure(unsubscribe)).toMatchObject({ name: "AppError", code: "NOT_FOUND", status: 404 });
    nock(API).delete("/api/webhooks/subscriptions/whs_x").reply(404, "<html>");
    expect(await failure(unsubscribe)).toMatchObject({ message: "Linkonda returned an error (HTTP 404).", status: 404 });
  });

  it("unsubscribe fails on a 5xx, even with a code that would end it", async () => {
    nock(API).delete("/api/webhooks/subscriptions/whs_x").reply(503, { error: "x", code: "WEBHOOK_SUBSCRIPTION_NOT_FOUND" });
    expect(
      await failure(() =>
        appTester(app.triggers.link_event.operation.performUnsubscribe, bundleFor({}, { subscribeData: { id: "whs_x" } })),
      ),
    ).toMatchObject({ message: "Linkonda couldn't answer right now (HTTP 503). Try again later.", status: 503 });
  });

  it("the code decides, except 5xx", async () => {
    // A 200-class code on another status still follows its row; a 5xx never does.
    expect(await fail(500, { error: "x", code: "INVALID_API_KEY" })).toMatchObject({ name: "AppError", status: 500 });
    expect(await fail(418, { error: "x", code: "INVALID_API_KEY" })).toMatchObject({ name: "ExpiredAuthError" });
    expect(await fail(403, { error: "x", code: "SLUG_TAKEN" })).toMatchObject({ name: "HaltedError" });
    expect(await fail(503, { error: "x", code: "RATE_LIMITED" })).toMatchObject({
      name: "AppError",
      message: "Linkonda couldn't answer right now (HTTP 503). Try again later.",
    });
  });

  it("RATE_LIMITED waits Retry-After seconds, or 60", async () => {
    const body = { error: "Too many requests.", code: "RATE_LIMITED" };
    expect(await fail(429, body, { "Retry-After": "17" })).toMatchObject({ name: "ThrottledError", delay: 17 });
    expect(await fail(429, body, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" })).toMatchObject({ delay: 60 });
    expect(await fail(429, body)).toMatchObject({ name: "ThrottledError", delay: 60 });
    expect(await fail(429, body, { "Retry-After": "1.5" })).toMatchObject({ delay: 60 });
  });

  it("no code shows the HTTP status", async () => {
    expect(await fail(400, { error: "Nope." })).toMatchObject({
      name: "AppError",
      message: "Linkonda returned an error (HTTP 400).",
      status: 400,
    });
    expect(await fail(404, "<html>")).toMatchObject({ message: "Linkonda returned an error (HTTP 404)." });
  });

  it("a redirect is unexpected", async () => {
    answer(302, "", { Location: "https://evil.example/steal" });
    expect(await failure(create)).toMatchObject({
      name: "AppError",
      message: "Linkonda returned an unexpected response.",
      status: 302,
    });
  });

  it("DESTINATION_BLOCKED keeps Google's attribution", async () => {
    const text = `Google Web Risk lists that destination as a suspected unsafe site, so it cannot be shortened. ${"Notice. ".repeat(60)}Advisory provided by Google: https://docs.cloud.google.com/web-risk/docs/advisory`;
    expect(text.length).toBeGreaterThan(500);
    const got = await fail(400, { error: text, code: "DESTINATION_BLOCKED" });
    expect(got.name).toBe("HaltedError");
    expect(got.message).toContain("Advisory provided by Google: https://docs.cloud.google.com/web-risk/docs/advisory");
  });

  it("API text is cut at 500", async () => {
    const got = await fail(400, { error: "a".repeat(2000), code: "VALIDATION_FAILED" });
    expect(got.message).toBe(`${"a".repeat(500)} (Linkonda error code VALIDATION_FAILED, HTTP 400)`);
  });

  it("no message carries the key or the secret", async () => {
    const got = await fail(400, { error: `Bad key ${KEY} and whsec_abc`, code: "VALIDATION_FAILED" });
    expect(got.full).not.toContain(KEY);
    const noCode = await fail(500, `oops ${KEY}`);
    expect(noCode.full).not.toContain(KEY);
  });

  it("the key never goes to another host", async () => {
    const send = (url: string) =>
      appTester(
        async (z) => (await z.request({ url, method: "GET" })).status,
        { authData },
      );
    for (const url of ["https://evil.example/api/links", "http://api.linkonda.com/api/links", "https://api.linkonda.com.evil.example/x"]) {
      expect(await failure(() => send(url))).toMatchObject({ message: "Linkonda returned an unexpected response." });
    }
    // Reaching the right host still works, with the key.
    const scope = nock(API, { reqheaders: { authorization: `Bearer ${KEY}` } }).get("/api/quota").reply(200, {});
    expect(await send(`${API}/api/quota`)).toBe(200);
    expect(scope.isDone()).toBe(true);
  });
});
