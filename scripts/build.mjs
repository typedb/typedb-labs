// Builds the labs site into dist/: the index page at the root and each lab's web app under its own path.
// Run by Netlify (`npm run build`) and usable locally. Each lab's web app is built with VITE_BASE set to
// its path, so its links, assets and API calls all live under that path. Every page then gets the main
// site's top bar (scripts/chrome.mjs); the labs themselves know nothing about it.

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { applyChrome, buildChrome } from "./chrome.mjs";

// fill: the app fills the viewport without scrolling (see applyChrome).
const LABS = [
  { name: "apex", title: "Project Apex", web: "apex/web" },
  { name: "nuts-and-volts", title: "Nuts &amp; Volts", web: "nuts-and-volts/web", fill: true },
];

// On Windows a lower-case drive letter makes Vite bundle some packages twice (two Reacts: a blank page).
const root = resolve(import.meta.dirname, "..").replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const dist = resolve(root, "dist");
// --index-only rebuilds the index page and the shared styles, and keeps the labs already in dist/.
const indexOnly = process.argv.includes("--index-only");
if (!indexOnly) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, "site"), dist, { recursive: true, filter: (src) => !src.endsWith(".scss") });

const chrome = await buildChrome(dist);
applyChrome(resolve(dist, "index.html"), chrome, { footer: true });

for (const lab of indexOnly ? [] : LABS) {
  const web = resolve(root, lab.web);
  const run = (cmd, env = {}) => execSync(cmd, { cwd: web, stdio: "inherit", env: { ...process.env, ...env } });
  console.log(`\n== ${lab.name}: installing and building ${lab.web}`);
  run("npm ci --no-audit --no-fund");
  run("npm run build", { VITE_BASE: `/${lab.name}/` });
  cpSync(resolve(web, "dist"), resolve(dist, lab.name), { recursive: true });
  applyChrome(resolve(dist, lab.name, "index.html"), chrome, { name: lab.name, title: lab.title, fill: lab.fill });
}
console.log(indexOnly ? "Rebuilt the index page" : `\nBuilt dist/ with: ${LABS.map((l) => "/" + l.name + "/").join(", ")}`);
