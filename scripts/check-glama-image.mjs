// Agent step A1 of docs/listings/mcp-directories.md (spec 0137): builds the Dockerfile on its own, starts it the way
// Glama's check does (no API key, no network) and compares what it introspects with scripts/glama-image-tools.json.
// Not part of `npm test` or scripts/verify.sh: it needs Docker and the npm registry.
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const expected = JSON.parse(readFileSync(new URL("./glama-image-tools.json", import.meta.url), "utf8"));
const tag = `linkonda-mcp-glama-check:${process.pid}`;
const container = `glama-check-${process.pid}`;
// The build gets its own, longer limit: on a cold cache the base-image pull from Docker Hub alone took minutes. The
// introspection runs on a built image and is quick, so it keeps 120 s.
const BUILD_TIMEOUT_MS = 600_000;
const INTROSPECT_TIMEOUT_MS = 120_000;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

// Rejects after `ms`, so a hang goes through the same catch and finally (cleanup) as any other failure.
function limit(promise, ms, what, onTimeout = () => {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${what} took longer than ${ms / 1000} s`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// `docker build -` with the Dockerfile on stdin gives an empty build context, as the image must build without one.
// --no-cache: the npm install layer must not pass from cache after the pinned version changes on the registry.
function build() {
  let child;
  const done = new Promise((resolve, reject) => {
    child = spawn("docker", ["build", "--no-cache", "-t", tag, "-"], { stdio: ["pipe", "inherit", "inherit"] });
    // A missing docker or a stopped daemon closes stdin early: the exit and error handlers report it, not an EPIPE.
    child.stdin.on("error", () => {});
    createReadStream(new URL("../Dockerfile", import.meta.url)).pipe(child.stdin);
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`docker build exited with ${code}`))));
  });
  return limit(done, BUILD_TIMEOUT_MS, "docker build", () => child.kill("SIGKILL"));
}

async function introspect() {
  // The SDK client sends initialize and notifications/initialized, then tools/list.
  // --init: the server is PID 1 in the container and would otherwise ignore SIGTERM.
  const transport = new StdioClientTransport({
    command: "docker",
    args: ["run", "-i", "--rm", "--init", "--name", container, "--network", "none", tag],
    cwd: root,
    stderr: "inherit",
  });
  const client = new Client({ name: "glama-image-check", version: "0.0.0" });
  try {
    await client.connect(transport);
    const info = client.getServerVersion();
    const { tools } = await client.listTools();
    return { info, names: tools.map((t) => t.name) };
  } finally {
    await client.close().catch(() => {});
  }
}

async function main() {
  await build();
  const { info, names } = await limit(introspect(), INTROSPECT_TIMEOUT_MS, "introspection");
  console.log(`serverInfo: ${JSON.stringify({ name: info?.name, version: info?.version })}`);
  console.log(`tools/list: ${names.join(", ")}`);
  if (info?.name !== "linkonda") fail(`serverInfo.name is ${info?.name}, expected linkonda`);
  if (info?.version !== expected.version) fail(`serverInfo.version is ${info?.version}, expected ${expected.version}`);
  const same = names.length === expected.tools.length && [...names].sort().join() === [...expected.tools].sort().join();
  if (!same) fail(`tools differ from scripts/glama-image-tools.json (${expected.tools.join(", ")})`);
  if (!process.exitCode) console.log(`OK: image answers initialize and lists ${names.length} tools for ${expected.version}`);
}

try {
  await main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  spawnSync("docker", ["rmi", "-f", tag], { stdio: "ignore" });
}
// After a timeout the `docker run` child can still hold the event loop open; the cleanup above has removed it.
process.exit(process.exitCode ?? 0);
