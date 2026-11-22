import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Spec 0137: the files Glama and the directory kit rely on. Read from the repo root, no Docker, no network.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json")) as { version: string; files: string[] };
const dockerfile = read("Dockerfile");

const semver = (v: string) => v.split(".").map(Number) as [number, number, number];
const notAbove = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!;
  return true;
};

describe("listing files", () => {
  it("glama.json has the schema's required fields", () => {
    const glama = JSON.parse(read("glama.json")) as { $schema?: unknown; maintainers?: unknown };
    expect(glama.$schema).toBe("https://glama.ai/mcp/schemas/server.json");
    const m = glama.maintainers;
    expect(Array.isArray(m) && m.length > 0).toBe(true);
    const list = m as unknown[];
    expect(list.every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    expect(new Set(list).size).toBe(list.length);
  });

  it("the Dockerfile pins a released-looking version not above package.json's", () => {
    const args = dockerfile.match(/^ARG LINKONDA_MCP_VERSION=(.*)$/gm) ?? [];
    expect(args).toHaveLength(1);
    const pin = /=(.*)$/.exec(args[0]!)![1]!;
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
    // Only x.y.z: a prerelease such as 0.2.0-beta.1 would parse to NaN and fail misleadingly.
    expect(notAbove(pin, pkg.version.split(/[-+]/)[0]!)).toBe(true);
    expect(dockerfile).toMatch(/^RUN npm install -g @veranoapp\/linkonda-mcp@\$\{LINKONDA_MCP_VERSION\}$/m);
    expect(dockerfile).not.toMatch(/^\s*(COPY|ADD)\b/im);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["linkonda-mcp"\]$/m);
  });

  it("the Dockerfile sets no API key or base URL", () => {
    expect(dockerfile).not.toContain("LINKONDA_API_KEY");
    expect(dockerfile).not.toContain("LINKONDA_API_BASE_URL");
  });

  it("the image tool list belongs to the pinned version", () => {
    const pin = /^ARG LINKONDA_MCP_VERSION=(.*)$/m.exec(dockerfile)![1];
    const tools = JSON.parse(read("scripts/glama-image-tools.json")) as { version: string; tools: string[] };
    expect(tools.version).toBe(pin);
    expect(tools.tools.length).toBeGreaterThan(0);
  });

  it("the npm package still ships only dist", () => {
    expect(pkg.files).toEqual(["dist"]);
    const build = JSON.parse(read("tsconfig.build.json")) as { exclude?: string[] };
    expect(build.exclude).toContain("src/**/*.test.ts");
  });
});
