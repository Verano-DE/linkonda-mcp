// node scripts/nested.mjs <dir> <script>...  runs scripts of a nested npm package of this repo (ADR 0023, which amends
// ADR 0022 Decision 2; specs 0143 and 0144): `raycast` (Raycast extension) or `zapier` (Zapier app).
//
// Each is its own npm package (its own lockfile, the folder that goes to raycast/extensions or to Zapier), but the gate
// every merge needs is scripts/verify.sh, which runs only each repo's own typecheck, lint and test scripts and has no
// hook for a nested package. So mcp's scripts call this. Backlog 0156 removes this wiring if a package gets a repo of
// its own.
//
// - A missing <dir>/node_modules gets `npm ci --ignore-scripts` first (verify.sh's rule for a repo; no install
//   script of that tree runs on the operator's machine). Without network that fails, as verify's own `npm ci` does.
// - Raycast's `build` runs with HOME set to a temporary directory, removed afterwards: `ray build` creates
//   ~/.config/raycast under os.homedir(), and the gate must change nothing outside the repo (`needsTempHome`).
// - It stops at the first failing script and names it.
// - The script only runs when executed: the unit test imports `needsTempHome` without starting anything.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Only raycast's `build` writes under HOME; zapier's build is `tsc`. */
export function needsTempHome(dir, script) {
  return dir === "raycast" && script === "build";
}

function main() {
  const [name, ...scripts] = process.argv.slice(2);
  if (!name || scripts.length === 0) {
    console.error("usage: node scripts/nested.mjs <dir> <script>...");
    process.exit(2);
  }
  if (!["raycast", "zapier"].includes(name)) {
    console.error(`nested: unknown package "${name}" (raycast or zapier)`);
    process.exit(2);
  }
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", name);

  const run = (args, env = process.env) => spawnSync("npm", args, { cwd: dir, env, stdio: "inherit" }).status === 0;

  const fail = (what) => {
    console.error(`\n${name}: \`${what}\` failed (mcp/${name})`);
    process.exit(1);
  };

  if (!existsSync(join(dir, "node_modules"))) {
    console.log(`\n\u001b[1m▶ ${name}: npm ci\u001b[0m`);
    if (!run(["ci", "--ignore-scripts"])) fail("npm ci --ignore-scripts");
  }

  for (const script of scripts) {
    console.log(`\n\u001b[1m▶ ${name}: ${script}\u001b[0m`);
    let home;
    let ok;
    // process.exit skips `finally`, so the outcome is known first, the temporary HOME removed, and only then fail().
    try {
      const env = { ...process.env };
      if (needsTempHome(name, script)) {
        home = mkdtempSync(join(tmpdir(), `${name}-home-`));
        env.HOME = home;
      }
      ok = run(["run", "--silent", script], env);
    } finally {
      if (home) rmSync(home, { recursive: true, force: true });
    }
    if (!ok) fail(`npm run ${script}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
