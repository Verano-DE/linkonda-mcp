/**
 * Every string the app shows in Zapier's editor or in a Zap's history, once (spec 0144, S-1 to S-11 and E-1 to E-6).
 * They name no plan, price or limit beyond "paid plan" and the short code's format: the API enforces the plans and
 * its table changes (CLAUDE.md rule 4), and `definition.test.ts` pins that. `docs/listings/zapier.md` holds the same
 * texts for approval, and a test compares them.
 */

export const APP_DESCRIPTION =
  "Linkonda is a privacy-friendly URL shortener. Its short links count only total clicks and record nothing about who clicked.";

export const API_KEYS_URL = "https://linkonda.com/api-keys";

export const AUTH = {
  label: "API Key",
  helpText: `Create an API key at [linkonda.com/api-keys](${API_KEYS_URL}). API keys need a paid plan.`,
};

export const CREATE = {
  noun: "Short Link",
  label: "Create Short Link",
  description: "Creates a short link for a destination URL.",
  url: {
    label: "Destination URL",
    helpText: "The web address the short link leads to, starting with http:// or https://.",
  },
  slug: {
    label: "Custom Short Code",
    helpText:
      "Optional. Leave empty for a generated short code. A custom short code has 4 to 64 letters, digits, hyphens or underscores, starts and ends with a letter or digit, and needs a plan that includes custom short codes.",
  },
  expiresInDays: {
    label: "Expires After (Days)",
    helpText:
      "Optional. Leave empty for a link that doesn't expire. Setting an expiry needs a plan that includes it.",
  },
  outputs: {
    id: "Link ID",
    slug: "Short Code",
    shortUrl: "Short Link",
    expiresAt: "Expires At",
  },
};

export const TRIGGER = {
  noun: "Link Event",
  label: "New Link Event",
  description:
    "Triggers when one of your short links is created, gets a new destination, is paused, resumed or deleted, is clicked for the first time, or will expire within about a day.",
  event: {
    label: "Event",
    helpText:
      "This trigger needs a plan that includes webhooks. A first click event says only that the link was clicked; Linkonda records nothing about who clicked.",
  },
  /** Value to label. The object form shows the label alone; the array form would show each id under it. */
  choices: {
    "link.created": "Link Created",
    "link.updated": "Link Destination Changed",
    "link.paused": "Link Paused",
    "link.resumed": "Link Resumed",
    "link.deleted": "Link Deleted",
    "link.first_click": "Link Clicked for the First Time",
    "link.will_expire": "Link Expires in About a Day",
  } as Record<string, string>,
  outputs: {
    id: "Event ID",
    type: "Event Type",
    createdAt: "Event Time",
    linkId: "Link ID",
    slug: "Short Code",
    shortUrl: "Short Link",
    targetUrl: "Destination URL",
    expiresAt: "Expires At",
    creationSource: "Creation Source",
    hostname: "Custom Domain",
    clickCount: "Click Count",
  },
};

/**
 * S-7 and S-10 also name explanations for some outputs ("Empty when the link doesn't expire.", and so on). Zapier's
 * schema allows no help text on an output field (`additionalProperties: false`), so they are not shown (spec 0144,
 * Decision 13) and `docs/listings/zapier.md` says so.
 */

/** E-1 to E-6. */
export const errorWithCode = (text: string, code: string, status: number) =>
  `${text} (Linkonda error code ${code}, HTTP ${status})`;
export const errorWithoutCode = (status: number) => `Linkonda returned an error (HTTP ${status}).`;
export const errorUnavailable = (status: number) =>
  `Linkonda couldn't answer right now (HTTP ${status}). Try again later.`;
export const ERROR_UNEXPECTED = "Linkonda returned an unexpected response.";
export const ERROR_SIGNATURE = "This event wasn't processed because its signature was missing or didn't match.";
export const ERROR_EXPIRY = "Expires After (Days) must be a whole number.";
