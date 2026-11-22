import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import schema from "zapier-platform-schema";
import { describe, expect, it } from "vitest";
import { app } from "./helpers.js";
import { CREATE_SAMPLE, TRIGGER_SAMPLE } from "../src/samples.js";
import { TRIGGER_KEYS } from "../src/triggers/link-event.js";
import * as texts from "../src/texts.js";

const root = new URL("../", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");
const harness = existsSync(join(root, "../../docs"));
const kitPath = join(root, "../../docs/listings/zapier.md");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** Every string in the app definition, with where it is. */
function strings(value: unknown, path = "app"): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`));
  }
  return [];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SMALL = new Set(["a", "an", "the", "for", "in", "of", "to", "and", "or", "on"]);
const titleCase = (label: string) =>
  label
    .split(" ")
    .filter((w) => /[A-Za-z]/.test(w))
    .every((w, i) => (i > 0 && SMALL.has(w) ? true : /^\(?[A-Z]/.test(w)));

describe("the app definition", () => {
  it("the app passes Zapier's schema validation", () => {
    // The CLI's `validate` sends functions as this placeholder string; JSON would drop them and fail "requires perform".
    const serialized = JSON.parse(JSON.stringify(app, (_k, v) => (typeof v === "function" ? "$func$2$f$" : v)));
    const result = schema.validateAppDefinition(serialized);
    expect(result.errors.map((e: { stack: string }) => e.stack)).toEqual([]);
  });

  it("the version equals package.json's", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(app.version).toBe(pkg.version);
  });

  it("title-case labels; the trigger description starts \"Triggers when \"", () => {
    const labels = strings(app)
      .filter(([path]) => /\.(label|noun)$/.test(path))
      .map(([, v]) => v);
    expect(labels.length).toBeGreaterThan(10);
    for (const label of labels) expect(titleCase(label), label).toBe(true);
    expect(app.triggers.link_event.display.description.startsWith("Triggers when ")).toBe(true);
  });

  it("the description has 40 to 140 characters and starts \"Linkonda is a\"", () => {
    expect(texts.APP_DESCRIPTION.length).toBeGreaterThanOrEqual(40);
    expect(texts.APP_DESCRIPTION.length).toBeLessThanOrEqual(140);
    expect(texts.APP_DESCRIPTION.startsWith("Linkonda is a")).toBe(true);
  });

  it("samples carry exactly their output keys, ISO-8601 times", () => {
    const create = app.creates.create_link.operation;
    expect(Object.keys(create.sample).sort()).toEqual(create.outputFields.map((f: { key: string }) => f.key).sort());
    expect(Object.keys(CREATE_SAMPLE).sort()).toEqual(["expiresAt", "id", "shortUrl", "slug"]);
    expect(CREATE_SAMPLE.expiresAt).toMatch(ISO);
    const trigger = app.triggers.link_event.operation;
    expect(Object.keys(trigger.sample).sort()).toEqual([...TRIGGER_KEYS].sort());
    expect(trigger.outputFields.map((f: { key: string }) => f.key).sort()).toEqual([...TRIGGER_KEYS].sort());
    expect(TRIGGER_SAMPLE.createdAt).toMatch(ISO);
  });

  it("apiKey is the only auth field, a required password", () => {
    expect(app.authentication.type).toBe("custom");
    expect(app.authentication.fields).toEqual([
      expect.objectContaining({ key: "apiKey", type: "password", required: true }),
    ]);
    expect(app.authentication).not.toHaveProperty("connectionLabel");
  });

  it("the app's texts name no plan, price or limit", () => {
    // "paid plan" and the short code's format are the two things S-4 and S-6 say; the API enforces the rest (rule 4).
    const allowed = /paid plan|plan that includes|a plan that includes/gi;
    for (const [path, text] of [...strings(app), ...Object.entries(texts).flatMap(([k, v]) => strings(v, k))]) {
      const rest = text.replace(allowed, "");
      expect(rest, path).not.toMatch(/\b(free|starter|plus|pro|business|enterprise)\b/i);
      expect(rest, path).not.toMatch(/[$€£]|\bprice|\bper (month|year|day)\b|\/month/i);
      expect(rest, path).not.toMatch(/\b\d+ (links|requests|webhooks|keys)\b/i);
    }
  });

  it("src logs, caches and stores nothing and names no other host", () => {
    const files = walk(join(root, "src")).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    const allowedUrls = [
      "https://api.linkonda.com",
      "https://linkonda.com/api-keys",
      `https://lnko.eu/${"spring-sale"}`,
      "https://example.com/spring-sale",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\bconsole\b|\bz\.console\b|\bz\.cache\b|\bz\.stashFile\b|\bstashFile\b/);
      for (const url of source.match(/https?:\/\/[A-Za-z0-9][^\s"'`)\]]*/g) ?? []) {
        expect(
          allowedUrls.some((ok) => url === ok || url.startsWith(`${ok}/`) || url.startsWith(`${ok})`)),
          `${file}: ${url}`,
        ).toBe(true);
      }
    }
  });

  it("the logo is a 256 × 256 RGBA PNG", () => {
    const png = readFileSync(join(root, "assets/logo-256.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(256);
    expect(png.readUInt32BE(20)).toBe(256);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // colour type: RGBA
  });

  // The harness is the directory holding docs/ above this repo; a standalone checkout of mcp (its own CI) has none.
  // Decided on the harness, not on the kit file: inside the harness a renamed or missing kit fails the test.
  it.skipIf(!harness)("the kit's texts equal the app's", () => {
    const readme = read("README.md");
    const kit = readFileSync(kitPath, "utf8");
    expect(kit).toContain(readme.trim());
    const mustAppear = [
      texts.APP_DESCRIPTION,
      texts.AUTH.helpText,
      texts.CREATE.description,
      texts.CREATE.url.helpText,
      texts.CREATE.slug.helpText,
      texts.CREATE.expiresInDays.helpText,
      texts.TRIGGER.description,
      texts.TRIGGER.event.helpText,
      ...Object.values(texts.TRIGGER.choices),
      texts.errorWithCode("<API error>", "<CODE>", 0).replace("0", "<status>"),
      texts.ERROR_UNEXPECTED,
      texts.ERROR_SIGNATURE,
      texts.ERROR_EXPIRY,
      texts.errorWithoutCode(0).replace("0", "<status>"),
      texts.errorUnavailable(0).replace("0", "<status>"),
    ];
    for (const text of mustAppear) expect(kit, text).toContain(text);
  });
});
