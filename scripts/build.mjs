// Builds the labs site into dist/: the index page at the root and each lab's web app under its own path.
// Run by Netlify (`npm run build`) and usable locally. Each lab's web app is built with VITE_BASE set to
// its path, so its links, assets and API calls all live under that path.

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const LABS = [
  { name: "apex", web: "apex/web" },
  { name: "noodlelab", web: "noodlelab/web" },
];

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, "site"), dist, { recursive: true });

for (const lab of LABS) {
  const web = resolve(root, lab.web);
  const run = (cmd, env = {}) => execSync(cmd, { cwd: web, stdio: "inherit", env: { ...process.env, ...env } });
  console.log(`\n== ${lab.name}: installing and building ${lab.web}`);
  run("npm ci --no-audit --no-fund");
  run("npm run build", { VITE_BASE: `/${lab.name}/` });
  cpSync(resolve(web, "dist"), resolve(dist, lab.name), { recursive: true });
}
console.log(`\nBuilt dist/ with: ${LABS.map((l) => "/" + l.name + "/").join(", ")}`);
