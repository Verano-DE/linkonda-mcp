import nock from "nock";
import { describe, expect, it } from "vitest";
import { API, app, appTester, bundleFor, failure, KEY } from "./helpers.js";

const perform = app.creates.create_link.operation.perform;
const run = (inputData: Record<string, unknown>) => appTester(perform, bundleFor(inputData));
const created = {
  id: "abc",
  slug: "x7Kp2",
  shortUrl: "https://lnko.eu/x7Kp2",
  expiresAt: null,
  clickCount: 0,
  savedToAccount: true,
};

describe("Create Short Link", () => {
  it("sends only url when code and expiry are empty", async () => {
    const scope = nock(API, {
      reqheaders: { authorization: `Bearer ${KEY}`, accept: "application/json", "content-type": "application/json" },
    })
      .post("/api/links", (body) => JSON.stringify(body) === JSON.stringify({ url: "https://example.com/a" }))
      .reply(201, created);
    await run({ url: "https://example.com/a", slug: "  ", expiresInDays: "" });
    expect(scope.isDone()).toBe(true);
  });

  it("adds the trimmed slug and a numeric expiresInDays", async () => {
    const scope = nock(API)
      .post("/api/links", { url: "https://example.com/a", slug: "spring-sale", expiresInDays: 30 })
      .reply(201, { ...created, slug: "spring-sale", expiresAt: "2027-03-01T09:00:00.000Z" });
    await run({ url: "https://example.com/a", slug: " spring-sale ", expiresInDays: " 30 " });
    expect(scope.isDone()).toBe(true);
  });

  it("returns exactly the four keys on 201", async () => {
    nock(API).post("/api/links").reply(201, created);
    expect(await run({ url: "https://example.com/a" })).toEqual({
      id: "abc",
      slug: "x7Kp2",
      shortUrl: "https://lnko.eu/x7Kp2",
      expiresAt: null,
    });
  });

  it("a malformed 2xx is unexpected", async () => {
    const bad = [
      [201, { ...created, id: 7 }],
      [201, { ...created, shortUrl: "http://lnko.eu/x7Kp2" }],
      [201, { ...created, expiresAt: undefined }],
      [201, "not json"],
      [200, created],
    ] as const;
    for (const [status, body] of bad) {
      nock(API).post("/api/links").reply(status, body as never);
      expect(await failure(() => run({ url: "https://example.com/a" }))).toMatchObject({
        name: "AppError",
        message: "Linkonda returned an unexpected response.",
      });
    }
  });

  it("an expiry of 0, 1.5 or 20 digits halts before any request", async () => {
    for (const expiresInDays of ["0", "1.5", "12345678901234567890", "-3", "1e3", "abc"]) {
      expect(await failure(() => run({ url: "https://example.com/a", expiresInDays }))).toMatchObject({
        name: "HaltedError",
        message: "Expires After (Days) must be a whole number.",
      });
    }
    // No interceptor was set, and `disableNetConnect` would have failed a request with another error.
  });
});
