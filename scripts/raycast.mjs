// node scripts/raycast.mjs <script>...  runs scripts of the Raycast extension in raycast/ (ADR 0022, spec 0143).
//
// raycast/ is its own npm package (its own lockfile, the folder that goes to raycast/extensions), but the gate every
// merge needs is scripts/verify.sh, which runs only each repo's own typecheck, lint and test scripts and has no hook
// for a nested package. So mcp's scripts call this, and `lint` also carries raycast's offline `build`. Backlog 0156
// removes this wiring if the extension gets a repo of its own.
//
// - A missing raycast/node_modules gets `npm ci --ignore-scripts` first (verify.sh's rule for a repo; no install
//   script of that tree runs on the operator's machine). Without network that fails, as verify's own `npm ci` does.
// - `build` runs with HOME set to a temporary directory, removed afterwards: `ray build` creates ~/.config/raycast
//   under os.homedir(), and the gate must change nothing outside the repo.
// - It stops at the first failing script and names it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "raycast");
const scripts = process.argv.slice(2);
if (scripts.length === 0) {
  console.error("usage: node scripts/raycast.mjs <script>...");
  process.exit(2);
}

function run(args, env = process.env) {
  return spawnSync("npm", args, { cwd: dir, env, stdio: "inherit" }).status === 0;
}

function fail(what) {
  console.error(`\nraycast: \`${what}\` failed (mcp/raycast)`);
  process.exit(1);
}

if (!existsSync(join(dir, "node_modules"))) {
  console.log("\n\u001b[1m▶ raycast: npm ci\u001b[0m");
  if (!run(["ci", "--ignore-scripts"])) fail("npm ci --ignore-scripts");
}

for (const script of scripts) {
  console.log(`\n\u001b[1m▶ raycast: ${script}\u001b[0m`);
  let home;
  let ok;
  // process.exit skips `finally`, so the outcome is known first, the temporary HOME removed, and only then fail().
  try {
    const env = { ...process.env };
    if (script === "build") {
      home = mkdtempSync(join(tmpdir(), "raycast-home-"));
      env.HOME = home;
    }
    ok = run(["run", "--silent", script], env);
  } finally {
    if (home) rmSync(home, { recursive: true, force: true });
  }
  if (!ok) fail(`npm run ${script}`);
}
