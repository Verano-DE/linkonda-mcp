/**
 * Tool output for get_link_stats and list_links. Pure functions with no I/O, kept out of index.ts (which connects
 * stdio on import) so they can be unit-tested on their own (backlog 0003).
 */
import type { AccountLink, LinkStats, Variant } from "./api.js";

/**
 * `GET /api/links` stops at the 100 most recently created links (`.top(100)`) and has no cursor until backlog 0013,
 * so a full page is the only sign that older links exist.
 */
export const LIST_CAP = 100;

export const LIST_CAP_NOTE =
  "The list stops at the 100 most recently created links; older ones, if any, are not shown.";

export const AB_COUNTS_OWNER_ONLY =
  "This is an A/B split link. Each variant's count is shown only to the link's owner, through an API key of that account on a paid plan.";

/** `(weight 50%)`, or `(weight 50%, winner)` for the declared winner, which takes every click whatever the weights. */
function weightLabel(v: Variant, winner: string | null | undefined): string {
  return `(weight ${v.weight}%${v.key === winner ? ", winner" : ""})`;
}

/** `host` is the trimmed value the request sent, or undefined for Linkonda's own short-link host. */
export function formatStats(slug: string, host: string | undefined, stats: LinkStats): string {
  const lines = [`${host ? `${host}/${slug}` : slug} has been followed ${stats.clickCount} time(s).`];
  if (Array.isArray(stats.variants) && stats.variants.length > 0) {
    lines.push(
      "Per variant:",
      ...stats.variants.map(
        (v) => `  ${v.key}: ${v.clickCount} time(s) -> ${v.targetUrl} ${weightLabel(v, stats.abWinnerVariant)}`,
      ),
    );
  } else if (stats.abEnabled === true && stats.variants == null) {
    lines.push(AB_COUNTS_OWNER_ONLY);
  }
  return lines.join("\n");
}

export function formatLinkList(links: AccountLink[]): string {
  if (links.length === 0) return "No links on this account yet.";
  const lines = links.flatMap((l) => {
    const bits = [`${l.shortUrl} -> ${l.targetUrl}`, `${l.clickCount} clicks`];
    if (l.pausedAt) bits.push("paused");
    if (l.expiresAt) bits.push(`expires ${l.expiresAt}`);
    // For an A/B split link `targetUrl` is only the fallback, so each destination follows on its own line.
    const variants = (Array.isArray(l.variants) ? l.variants : []).map(
      (v) => `    ${v.key}: ${v.clickCount} clicks -> ${v.targetUrl} ${weightLabel(v, l.abWinnerVariant)}`,
    );
    return [bits.join("  |  "), ...variants];
  });
  if (links.length >= LIST_CAP) lines.push("", LIST_CAP_NOTE);
  return lines.join("\n");
}
