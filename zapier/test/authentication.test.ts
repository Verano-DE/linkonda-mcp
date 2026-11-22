import nock from "nock";
import { describe, expect, it } from "vitest";
import { API, app, appTester, authData, failure, KEY } from "./helpers.js";

describe("authentication", () => {
  it("the connection test sends GET /api/quota with the trimmed key", async () => {
    const scope = nock(API, { reqheaders: { authorization: `Bearer ${KEY}`, accept: "application/json" } })
      .get("/api/quota")
      .reply(200, { tier: "pro" });
    await appTester(app.authentication.test, { authData });
    expect(scope.isDone()).toBe(true);
  });

  it("INVALID_API_KEY and a Free key's API_KEY_REQUIRES_PAID fail the connection", async () => {
    nock(API).get("/api/quota").reply(401, { error: "Invalid API key.", code: "INVALID_API_KEY" });
    expect(await failure(() => appTester(app.authentication.test, { authData }))).toMatchObject({
      name: "ExpiredAuthError",
    });
    nock(API).get("/api/quota").reply(403, { error: "API keys need a paid plan.", code: "API_KEY_REQUIRES_PAID" });
    expect(await failure(() => appTester(app.authentication.test, { authData }))).toMatchObject({
      name: "AppError",
      code: "API_KEY_REQUIRES_PAID",
      status: 403,
    });
  });
});
