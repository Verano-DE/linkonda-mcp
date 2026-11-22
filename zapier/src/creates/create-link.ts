import type { Create } from "zapier-platform-core";
import { API_BASE_URL } from "../api.js";
import { CREATE_SAMPLE } from "../samples.js";
import { CREATE, ERROR_EXPIRY, ERROR_UNEXPECTED } from "../texts.js";

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").trim();

/** `/^[1-9]\d*$/` and a safe integer: `0`, `1.5`, `1e3` and 20 digits are not a number of days (AC-2). */
export function parseExpiresInDays(raw: unknown): number | undefined | "invalid" {
  const text = str(raw);
  if (text === "") return undefined;
  if (!/^[1-9]\d*$/.test(text)) return "invalid";
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : "invalid";
}

export const createLink: Create = {
  key: "create_link",
  noun: CREATE.noun,
  display: { label: CREATE.label, description: CREATE.description },
  operation: {
    inputFields: [
      { key: "url", label: CREATE.url.label, helpText: CREATE.url.helpText, type: "string", required: true },
      { key: "slug", label: CREATE.slug.label, helpText: CREATE.slug.helpText, type: "string", required: false },
      {
        key: "expiresInDays",
        label: CREATE.expiresInDays.label,
        helpText: CREATE.expiresInDays.helpText,
        type: "string",
        required: false,
      },
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData as Record<string, unknown>;
      const body: Record<string, unknown> = { url: input.url };
      const slug = str(input.slug);
      if (slug !== "") body.slug = slug;
      const days = parseExpiresInDays(input.expiresInDays);
      // Before any request: a half-typed expiry must not create a link that never expires.
      if (days === "invalid") throw new z.errors.HaltedError(ERROR_EXPIRY);
      if (days !== undefined) body.expiresInDays = days;

      const response = await z.request({
        url: `${API_BASE_URL}/api/links`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: unknown = response.data;
      const d = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
      const { id, slug: code, shortUrl, expiresAt } = d;
      let https = false;
      try {
        https = typeof shortUrl === "string" && new URL(shortUrl).protocol === "https:";
      } catch {
        https = false;
      }
      if (
        response.status !== 201 ||
        typeof id !== "string" ||
        typeof code !== "string" ||
        !https ||
        (typeof expiresAt !== "string" && expiresAt !== null)
      ) {
        throw new z.errors.Error(ERROR_UNEXPECTED, undefined, response.status);
      }
      return { id, slug: code, shortUrl, expiresAt };
    },
    sample: CREATE_SAMPLE,
    outputFields: [
      { key: "id", label: CREATE.outputs.id },
      { key: "slug", label: CREATE.outputs.slug },
      { key: "shortUrl", label: CREATE.outputs.shortUrl },
      { key: "expiresAt", label: CREATE.outputs.expiresAt },
    ],
  },
};
