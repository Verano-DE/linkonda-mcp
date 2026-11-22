import type { Authentication } from "zapier-platform-core";
import { API_BASE_URL } from "./api.js";
import { AUTH } from "./texts.js";

/**
 * One field, the API key (S-4). No `connectionLabel`: the API has no endpoint that names the account, and the label
 * would only be the key's owner's email, which this app has no reason to read (spec 0144 Decision 6).
 */
export const authentication: Authentication = {
  type: "custom",
  fields: [{ key: "apiKey", label: AUTH.label, type: "password", required: true, helpText: AUTH.helpText }],
  // `GET /api/quota` takes the key without an Origin header and answers 200 for any valid key; a refusal is mapped to
  // `ExpiredAuthError` or the plan error by `mapErrors`, which Zapier shows when the user connects.
  test: async (z) => {
    await z.request({ url: `${API_BASE_URL}/api/quota`, method: "GET" });
    return { connected: true };
  },
};
