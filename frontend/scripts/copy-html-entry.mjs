/**
 * Vite emits index.html next to the bundle; Frappe serves HTML from www/.
 *
 * On the way across we inject the Jinja tags the SPA needs at runtime. Frappe
 * renders www templates through Jinja, so the CSRF token and session boot data are
 * substituted server-side on every request rather than being baked into the build.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../posawesome/public/posawesome/index.html");
const dest = resolve(here, "../../posawesome/www/posawesome.html");

const INJECTION = `\t\t<script>
\t\t\twindow.csrf_token = "{{ csrf_token }}";
\t\t\twindow.posa_boot = {{ boot }};
\t\t</script>
`;

let html = readFileSync(src, "utf8");

if (!html.includes("window.csrf_token")) {
	html = html.replace("</head>", `${INJECTION}\t</head>`);
}

mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, html, "utf8");
// Keep a pristine copy next to the bundle for `vite preview`.
copyFileSync(src, resolve(here, "../../posawesome/public/posawesome/index.built.html"));

console.log(`wrote ${dest}`);
