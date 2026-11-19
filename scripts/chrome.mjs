// The typedb.com look for labs pages: the main site's top bar, footer, fonts and styles, taken from the
// typedb-web submodule (typedb-web/common) the same way the docs site takes them. The top bar and footer
// are rendered at build time from the main site's CMS, so a rebuild picks up navigation changes.

import { build } from "esbuild";
import * as sass from "sass";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const common = resolve(root, "typedb-web/common/src");
const scripts = resolve(common, "scripts");
const MAIN_SITE = "https://typedb.com";

const HEAD = `<link rel="stylesheet" href="/_site/css/chrome.css" />
<script src="https://kit.fontawesome.com/f7ba4755e0.js" crossorigin="anonymous"></script>
<script defer src="/_site/chrome.js"></script>
`;

/** Writes the shared assets to dist/_site and returns the rendered top bar and footer. */
export async function buildChrome(dist) {
  if (!existsSync(common)) throw new Error("typedb-web is missing: run `git submodule update --init`");
  const out = resolve(dist, "_site");
  mkdirSync(resolve(out, "css"), { recursive: true });

  for (const name of ["chrome", "index"]) {
    const { css } = sass.compile(resolve(root, `site/${name}.scss`), {
      loadPaths: [resolve(common, "styles")],
      style: "compressed",
    });
    writeFileSync(resolve(out, `css/${name}.css`), css);
  }
  // The stylesheets refer to these as ../fonts and ../icons.
  cpSync(resolve(common, "fonts"), resolve(out, "fonts"), { recursive: true });
  cpSync(resolve(common, "icons"), resolve(out, "icons"), { recursive: true });

  await build({
    stdin: {
      contents: `import { setupTopbarListeners } from "./topbar/setup-topbar-listeners"; setupTopbarListeners();`,
      resolveDir: scripts,
    },
    bundle: true,
    minify: true,
    outfile: resolve(out, "chrome.js"),
  });

  const generators = await build({
    stdin: {
      contents: `export { topbar, getTopbarData } from "./topbar"; export { generateFooter, getFooterData } from "./footer";`,
      resolveDir: scripts,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const { topbar, getTopbarData, generateFooter, getFooterData } = await import(
    `data:text/javascript;base64,${Buffer.from(generators.outputFiles[0].contents).toString("base64")}`
  );
  const [topbarData, footerData] = await Promise.all([getTopbarData(), getFooterData()]);
  return { header: topbar(topbarData, MAIN_SITE), footer: generateFooter(footerData, MAIN_SITE) };
}

const breadcrumb = (title) =>
  `<nav class="labs-breadcrumb" aria-label="Breadcrumb"><div><a href="/">TypeDB Labs</a><span aria-hidden="true">/</span><span>${title}</span></div></nav>`;

/**
 * Adds the top bar (and optionally the footer) to a built page. A lab's page passes its `name` and `title`:
 * the body gets the class `lab-<name>`, for styles meant for one lab, and the title goes in the breadcrumb
 * back to the index page. `fill` is for an app that fills the viewport without scrolling: it then shares
 * the viewport height with the top bar.
 */
export function applyChrome(file, chrome, { name, title, footer = false, fill = false } = {}) {
  const classes = [name && `lab-${name}`, fill && "labs-fill"].filter(Boolean).join(" ");
  const top = chrome.header + (title ? breadcrumb(title) : "");
  let html = readFileSync(file, "utf8")
    .replace("</head>", () => `${HEAD}</head>`)
    .replace(/<body[^>]*>/, (body) => `${classes ? `<body class="${classes}">` : body}${top}`);
  if (footer) html = html.replace("</body>", () => `${chrome.footer}</body>`);
  writeFileSync(file, html);
}
