/** Run the globe and its local, pre-generated biome tiles together. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const tileUrl = "http://127.0.0.1:8766/pnv-v4-global";

if (!existsSync(new URL("../.biome-data/tiles/pnv-v4-global/tilejson.json", import.meta.url))) {
  console.error("Generate the pnv-v4-global biome tiles first; see docs/global-biomes.md.");
  process.exit(1);
}

const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}

function run(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", env });
  children.add(child);
  child.on("error", (error) => {
    console.error(error.message);
    children.delete(child);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    stop(code ?? (signal ? 1 : 0));
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

run("python3", ["scripts/biomes/serve.py"]);
run(process.execPath, [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)], {
  ...process.env,
  NEXT_PUBLIC_BIOME_TILE_URL: tileUrl,
});
