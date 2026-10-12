#!/usr/bin/env node
// After `vite build`: make every route directly loadable on GitHub Pages.
//  - dist/404.html            SPA fallback (GitHub Pages serves it for unknown paths)
//  - dist/<lang>/<route>/index.html  one static file per page, with the page title and a
//    pre-rendered copy of the content inside #root (crawlers / no-JS); React replaces it.
//  - dist/.nojekyll           keep Pages from running Jekyll over the output
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const GEN = path.join(ROOT, 'src', 'generated');
const base = (() => {
  const b = process.env.BASE_PATH;
  return !b || b === '/' ? '/' : `/${b.replace(/^\/+|\/+$/g, '')}/`;
})();

const template = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (!template.includes('<!--app-->')) throw new Error('dist/index.html lacks the <!--app--> placeholder');
const nav = JSON.parse(fs.readFileSync(path.join(GEN, 'nav.json'), 'utf8'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function flatten(node, out = []) {
  out.push(node);
  node.children.forEach((c) => flatten(c, out));
  return out;
}
function navHtml(lang, node, depth = 0) {
  const link = `<a href="${base}${lang}/${node.route}">${esc(node.title)}</a>`;
  const kids = node.children.length ? `<ul>${node.children.map((c) => `<li>${navHtml(lang, c, depth + 1)}</li>`).join('')}</ul>` : '';
  return depth === 0 ? `<ul><li>${link}${kids}</li></ul>` : link + kids;
}

fs.writeFileSync(path.join(DIST, '404.html'), template.replace('<!--app-->', ''));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
fs.writeFileSync(
  path.join(DIST, 'index.html'),
  template.replace('<!--app-->', `<noscript><meta http-equiv="refresh" content="0; url=${base}zh/"><a href="${base}zh/">中文</a> · <a href="${base}en/">English</a></noscript>`),
);

let n = 0;
for (const lang of Object.keys(nav)) {
  const home = nav[lang];
  const nodes = flatten(home);
  for (const node of nodes) {
    const file = path.join(GEN, 'pages', lang, node.route, 'index.json');
    const page = JSON.parse(fs.readFileSync(file, 'utf8'));
    const html = page.html.split('%BASE%').join(base);
    const title = node.route ? `${page.title} | ${home.title}` : page.title;
    const body =
      `<div class="prerender"><nav class="prerender-nav">${navHtml(lang, home)}</nav>` +
      `<h1 class="page-title">${esc(page.title)}</h1><article class="content">${html}</article></div>`;
    const out = template
      .replace(/<html lang="[^"]*"/, `<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}"`)
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
      .replace('<!--app-->', body);
    const dest = path.join(DIST, lang, node.route, 'index.html');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
    n++;
  }
}
console.log(`postbuild: base=${base}, wrote ${n} route pages + 404.html`);
