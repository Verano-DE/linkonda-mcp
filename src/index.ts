#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DESTINATION_BLOCKED,
  DESTINATION_BLOCKED_HINT,
  LinkondaClient,
  LinkondaError,
  QUOTA_HINT_ACCOUNT,
} from "./api.js";
import { formatLinkList, formatStats } from "./format.js";

const apiKey = process.env.LINKONDA_API_KEY?.trim() || undefined;
const client = new LinkondaClient(apiKey, process.env.LINKONDA_API_BASE_URL);

// Read the version rather than hardcoding it: a literal here silently goes stale on every
// release, so clients get told a version that no longer matches the package they installed.
// `../package.json` resolves the same from src/ under tsx and from dist/ once built.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({ name: "linkonda", version });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Turns a failure into something the model can act on rather than retry blindly — the API's
 * stable `code` plus, where we have one, the concrete next step.
 */
function fail(error: unknown): ToolResult {
  if (error instanceof LinkondaError) {
    const parts = [error.message];
    if (error.code) parts.push(`(code: ${error.code})`);
    if (error.hint) parts.push(`\n${error.hint}`);
    return { content: [{ type: "text", text: parts.join(" ") }], isError: true };
  }
  return { content: [{ type: "text", text: `Unexpected error: ${String(error)}` }], isError: true };
}

/** update_link and delete_link take the same `linkId`, described once so the two can't drift apart. */
const LINK_ID_DESCRIPTION =
  "Optional. Needed only when more than one of your links uses this short code, on different hosts: " +
  "the call then fails with SLUG_AMBIGUOUS and lists each link's linkId. Call again with the same " +
  "slug and the linkId of the link you mean.";

const ANON_NOTE =
  "\n\nNote: this link was created anonymously — it expires automatically and is not saved to an account. " +
  "Set LINKONDA_API_KEY to keep links permanently and manage them.";

server.registerTool(
  "shorten_link",
  {
    title: "Shorten a URL",
    description:
      "Create a short link for a URL. Works without an API key (anonymous links expire and are " +
      "not saved to an account). When a short link is followed, Linkonda counts the click and " +
      "records nothing about the visitor: no IP address, location, device data or referrer. Use " +
      "when the user wants a short or shareable URL, or a link for a QR code.",
    inputSchema: {
      url: z.string().url().describe("The destination URL to shorten. Must be absolute, e.g. https://example.com/page"),
      expiresInDays: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Optional. The link stops redirecting after this many days: it then answers 410 Gone, " +
            "stays on the account, and its short URL is never reused. Needs the Pro or Business " +
            "plan. Omit it on other plans: links made with an API key then don't expire, and " +
            "anonymous links expire after the anonymous lifetime (check_quota shows it).",
        ),
      // Starter, Pro and Business accounts can set it (Linkonda spec 0023); rules and refusals come from the API.
      slug: z
        .string()
        .optional()
        .describe(
          "Optional. A custom short code for the link, such as spring-sale: 4 to 64 letters, digits, " +
            "hyphens or underscores, starting and ending with a letter or digit. Needs LINKONDA_API_KEY " +
            "from an account on the Starter, Pro or Business plan. Some words are reserved. A short code " +
            "is never given out again, even after its link is deleted or expires, and it can't be changed " +
            "later. Omit it to get a generated short code.",
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ url, expiresInDays, slug }) => {
    try {
      const link = await client.createLink({ url, expiresInDays, slug });
      // The API does not echo the destination back, so report the URL we sent.
      const lines = [`Short URL: ${link.shortUrl}`, `Destination: ${url}`];
      if (link.expiresAt) lines.push(`Expires: ${link.expiresAt}`);
      else if (link.lifetimeUnlimited) lines.push("Expires: never");
      return ok(lines.join("\n") + (link.savedToAccount ? "" : ANON_NOTE));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "shorten_links_bulk",
  {
    title: "Shorten many URLs at once",
    description:
      "Create up to 100 short links in a single request. Needs an API key from an account on the " +
      "Pro or Business plan; on other plans, call shorten_link once per URL.",
    inputSchema: {
      links: z
        .array(
          z.object({
            url: z.string().url().describe("Destination URL"),
            expiresInDays: z.number().int().positive().optional(),
          }),
        )
        .min(1)
        .max(100)
        .describe("Up to 100 links to create."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ links }) => {
    try {
      const result = await client.createLinks(links);
      // Partial success is normal here: a quota or validation failure on one entry does not
      // fail the request. Reporting only `created` would silently lose the rest.
      //
      // `created` entries carry no index and the array is compacted, so position N of `created`
      // is not input N once anything fails. The API processes entries in order, so rebuild the
      // mapping from the input indices that are absent from `failed`.
      const failedIndices = new Set(result.failed.map((f) => f.index));
      const createdInputIndices = links
        .map((_, index) => index)
        .filter((index) => !failedIndices.has(index));

      const sections = [
        `Created ${result.created.length} of ${links.length} link(s):`,
        ...result.created.map((link, position) => {
          const inputIndex = createdInputIndices[position];
          const url = inputIndex === undefined ? undefined : links[inputIndex]?.url;
          return `  ${link.shortUrl} -> ${url ?? "(destination unknown)"}`;
        }),
      ];
      if (result.failed.length > 0) {
        sections.push(
          "",
          `${result.failed.length} failed:`,
          ...result.failed.map(
            (f) => `  [${f.index}] ${f.url}: ${f.error}${f.code ? ` (${f.code})` : ""}`,
          ),
        );
        // Once, however many entries hit it: retrying won't help, freeing a slot will.
        if (result.failed.some((f) => f.code === "QUOTA_EXCEEDED")) sections.push("", QUOTA_HINT_ACCOUNT);
        // Also once: each failed line already carries the API's text whole, attribution and links included.
        if (result.failed.some((f) => f.code === DESTINATION_BLOCKED)) sections.push("", DESTINATION_BLOCKED_HINT);
      }
      return ok(sections.join("\n"));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "list_links",
  {
    title: "List my short links",
    description:
      "List the 100 most recently created short links on the authenticated account (paused and " +
      "expired ones included, deleted ones not), with their destinations and total redirect " +
      "counts. Requires an API key.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const { links } = await client.listLinks();
      return ok(formatLinkList(links ?? []));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "update_link",
  {
    title: "Update or pause a short link",
    description:
      "Change a short link's destination, or pause/resume it. A paused link stops redirecting but " +
      "is not deleted. Requires an API key. Changing the destination requires a paid plan.",
    inputSchema: {
      slug: z.string().describe("The link's short code (the part after the domain)."),
      linkId: z.string().optional().describe(LINK_ID_DESCRIPTION),
      url: z.string().url().optional().describe("New destination URL."),
      paused: z.boolean().optional().describe("true to stop the link redirecting, false to resume it."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ slug, linkId, url, paused }) => {
    if (url === undefined && paused === undefined) {
      return { content: [{ type: "text", text: "Provide `url`, `paused`, or both." }], isError: true };
    }
    // Empty means absent: an empty `linkId` makes the API behave as if none was sent.
    const id = linkId?.trim() || undefined;
    try {
      const res = await client.updateLink(slug, { url, paused }, id);
      // The short URL is on the link's own host, which tells two links with this slug apart.
      const shortUrl = typeof res?.shortUrl === "string" && res.shortUrl !== "" ? res.shortUrl : undefined;
      return ok(`Updated ${shortUrl ?? slug}.`);
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "delete_link",
  {
    title: "Delete a short link",
    description:
      "Delete a short link. This can't be undone: the short URL stops working immediately, anyone " +
      "who already has it gets a 404, and the link leaves the account's list. Its short URL is " +
      "never given to another link. Prefer update_link with paused:true if the link might be " +
      "needed again. Requires an API key.",
    inputSchema: {
      slug: z.string().describe("The link's short code (the part after the domain)."),
      linkId: z.string().optional().describe(LINK_ID_DESCRIPTION),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  async ({ slug, linkId }) => {
    // Empty means absent: an empty `linkId` makes the API behave as if none was sent.
    const id = linkId?.trim() || undefined;
    try {
      await client.deleteLink(slug, id);
      // DELETE answers only `{ ok: true }`, so the linkId is what tells two links with this slug apart.
      return ok(id ? `Deleted ${slug} (linkId ${id}).` : `Deleted ${slug}.`);
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "get_link_stats",
  {
    title: "Get a short link's click count",
    description:
      "Return the total number of times a short link has been followed. Linkonda stores no " +
      "per-visitor information, so there is no geographic, device or referrer breakdown to " +
      "report. For an A/B split link it also returns each variant's count, but only to the " +
      "link's owner, through that account's API key (paid plans). Without host it looks the " +
      "short code up on Linkonda's own short-link host; set host for a link on a custom domain. " +
      "No API key needed for the total.",
    inputSchema: {
      slug: z.string().describe("The link's short code (the part after the domain)."),
      host: z
        .string()
        .optional()
        .describe(
          "Optional. The hostname of the custom domain the link is on, such as links.example.com, " +
            "without https:// or a path. Omit it for a link on Linkonda's own short-link host.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ slug, host }) => {
    // Sent as given, trimmed: the API normalises the hostname or answers 404.
    const h = host?.trim() || undefined;
    try {
      return ok(formatStats(slug, h, await client.getStats(slug, h)));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "check_quota",
  {
    title: "Check remaining link allowance",
    description:
      "Report how many links are live and how many the current plan allows. Without an API key " +
      "this reports the anonymous allowance. Use it before a bulk create to check for room.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const quota = await client.getQuota();
      const cap = quota.unlimited ? "unlimited" : String(quota.maxActive ?? "unknown");
      const lines = [`Plan: ${quota.tier}`, `Links live: ${quota.active} of ${cap}`];
      // Trust the API's tier rather than whether a key was configured — same authoritative
      // signal `shorten_link` takes from `savedToAccount`.
      if (quota.tier === "anonymous") {
        lines.push(
          "Running anonymously — links expire after " +
            `${quota.anonLinkTtlDays} days. Set LINKONDA_API_KEY for permanent links.`,
        );
      }
      return ok(lines.join("\n"));
    } catch (error) {
      return fail(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
