#!/usr/bin/env node
// Build-time content pipeline: reads the Workshop Studio content repo and writes
//   src/generated/nav.json                       – page tree per language (weight order)
//   src/generated/pages/<lang>/<route>/index.json – rendered HTML + heading outline per page
//   public/static/**, public/assets/**            – copied images, templates, downloads
// URLs inside the generated HTML use the placeholder %BASE% so the committed output does
// not depend on the Vite base path; the app and the postbuild step substitute it.
//
// Usage: WS_CONTENT_DIR=../agent-dlc-ws-remote npm run sync

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP } from 'unist-util-visit';
import { toString as hastToString } from 'hast-util-to-string';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(ROOT, process.env.WS_CONTENT_DIR || '../agent-dlc-ws-remote');
const CONTENT = path.join(SRC, 'content');
const GEN = path.join(ROOT, 'src', 'generated');
const PUB = path.join(ROOT, 'public');
const LANGS = ['zh', 'en'];
const BASE = '%BASE%';

const warnings = [];
const warn = (file, msg) => warnings.push(`${path.relative(SRC, file)}: ${msg}`);

if (!fs.existsSync(CONTENT)) {
  console.error(`Content directory not found: ${CONTENT}\nSet WS_CONTENT_DIR to the Workshop Studio repo.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Discover pages
// ---------------------------------------------------------------------------
/** @returns {{route:string, file:string, lang:string, isIndex:boolean}[]} */
function discover(dir, routePrefix = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...discover(full, routePrefix ? `${routePrefix}/${ent.name}` : ent.name));
      continue;
    }
    const m = ent.name.match(/^(.+)\.([a-z]{2}(?:-[A-Z]{2})?)\.md$/);
    if (!m) continue;
    const lang = m[2].slice(0, 2);
    if (!LANGS.includes(lang)) continue;
    const isIndex = m[1] === 'index';
    const route = isIndex ? routePrefix : routePrefix ? `${routePrefix}/${m[1]}` : m[1];
    out.push({ route, file: full, lang, isIndex });
  }
  return out;
}

const found = discover(CONTENT);
const routeSet = { zh: new Set(), en: new Set() };
for (const p of found) routeSet[p.lang].add(p.route);

// ---------------------------------------------------------------------------
// 2. Markdown -> HTML
// ---------------------------------------------------------------------------
const ALERT_TYPES = new Set(['info', 'warning', 'success', 'error']);

// Rewrite an URL from the markdown into a site URL (with %BASE% placeholder).
function rewriteUrl(url, lang, file) {
  if (!url || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) return { url, internal: false };
  if (!url.startsWith('/')) return { url, internal: false };
  if (url.startsWith('/static/') || url.startsWith('/assets/')) {
    const rel = decodeURI(url.split(/[?#]/)[0]);
    if (!fs.existsSync(path.join(SRC, rel))) warn(file, `missing file ${rel}`);
    return { url: BASE + url.slice(1), internal: false, file: true };
  }
  // In-site route: /20-flywheel/30-evaluate#anchor
  const [pathPart, hash] = url.split('#');
  const route = pathPart.replace(/^\/+|\/+$/g, '');
  if (!routeSet[lang].has(route)) warn(file, `link to unknown page ${url}`);
  return { url: `${BASE}${lang}/${route}${route ? '' : ''}${hash ? '#' + hash : ''}`, internal: true };
}

// Turn an unknown directive back into its literal text (e.g. "10:30" or "a:b" in prose).
function directiveToText(node) {
  const colons = node.type === 'textDirective' ? ':' : node.type === 'leafDirective' ? '::' : ':::';
  const label = node.children?.length ? `[${node.children.map((c) => mdText(c)).join('')}]` : '';
  const attrs = node.attributes && Object.keys(node.attributes).length
    ? `{${Object.entries(node.attributes).map(([k, v]) => `${k}="${v}"`).join(' ')}}` : '';
  return `${colons}${node.name}${label}${attrs}`;
}
function mdText(n) {
  if ('value' in n) return n.value;
  return (n.children || []).map(mdText).join('');
}

function remarkWorkshopStudio({ lang, file }) {
  return (tree) => {
    // HTML nodes: drop comments, <br> -> break, everything else stays as literal text.
    visit(tree, 'html', (node, index, parent) => {
      const v = node.value.trim();
      const withoutComments = v.replace(/<!--[\s\S]*?-->/g, '').trim();
      if (!withoutComments) { parent.children.splice(index, 1); return [SKIP, index]; }
      if (/^<br\s*\/?>$/i.test(withoutComments)) { parent.children[index] = { type: 'break' }; return; }
      warn(file, `raw HTML rendered as text: ${withoutComments.slice(0, 60)}`);
      parent.children[index] = { type: 'text', value: withoutComments };
    });

    visit(tree, (node, index, parent) => {
      if (node.type === 'code' && node.lang === 'mermaid') {
        parent.children[index] = {
          type: 'mermaid',
          data: { hName: 'pre', hProperties: { className: ['mermaid'] }, hChildren: [{ type: 'text', value: node.value }] },
        };
        return SKIP;
      }
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
        const r = rewriteUrl(node.url, lang, file);
        node.url = r.url;
        if (r.internal) node.data = { ...node.data, hProperties: { ...(node.data?.hProperties || {}), 'data-internal': '' } };
        if (node.type === 'image') {
          node.data = { ...node.data, hProperties: { ...(node.data?.hProperties || {}), decoding: 'async' } };
        }
        return;
      }
      if (!['textDirective', 'leafDirective', 'containerDirective'].includes(node.type)) return;
      const attrs = node.attributes || {};
      const data = (node.data ||= {});

      if (node.name === 'alert') {
        const type = ALERT_TYPES.has(attrs.type) ? attrs.type : 'info';
        if (attrs.type && !ALERT_TYPES.has(attrs.type)) warn(file, `unknown alert type ${attrs.type}`);
        data.hName = 'div';
        data.hProperties = { className: ['ws-alert', `ws-alert-${type}`], role: 'note' };
        if (node.type === 'containerDirective') {
          // Container form :::alert{header=..} ... ::: – header becomes a bold title.
          if (attrs.header) node.children.unshift({ type: 'paragraph', data: { hProperties: { className: ['ws-alert-title'] } }, children: [{ type: 'text', value: attrs.header }] });
        } else {
          node.children = [{ type: 'paragraph', children: node.children }];
          if (attrs.header) node.children.unshift({ type: 'paragraph', data: { hProperties: { className: ['ws-alert-title'] } }, children: [{ type: 'text', value: attrs.header }] });
        }
        return;
      }
      if (node.name === 'expand' && node.type === 'containerDirective') {
        // remark-directive puts a [label] into a first paragraph flagged directiveLabel.
        let header = attrs.header;
        if (node.children[0]?.data?.directiveLabel) {
          const lbl = node.children.shift();
          header ||= mdText(lbl);
        }
        data.hName = 'details';
        data.hProperties = { className: ['ws-expand'], ...(attrs.defaultExpanded === 'true' || attrs.expanded === 'true' ? { open: true } : {}) };
        node.children.unshift({ type: 'expandSummary', data: { hName: 'summary' }, children: [{ type: 'text', value: header || '...' }] });
        return;
      }
      if ((node.name === 'link' || node.name === 'button') && node.type === 'textDirective') {
        const r = rewriteUrl(attrs.href || '', lang, file);
        data.hName = 'a';
        const props = { href: r.url };
        const cls = [node.name === 'button' ? 'ws-button' : 'ws-link'];
        if (attrs.action === 'download') { props.download = ''; cls.push('ws-download'); }
        else if (/^https?:/.test(r.url) || attrs.external === 'true') { props.target = '_blank'; props.rel = 'noopener noreferrer'; }
        if (r.internal) props['data-internal'] = '';
        props.className = cls;
        data.hProperties = props;
        return;
      }
      if (node.name === 'code' && node.type === 'textDirective') {
        data.hName = 'code';
        return;
      }
      // Unknown directive → literal text so nothing is silently lost.
      if (node.type === 'textDirective') {
        parent.children[index] = { type: 'text', value: directiveToText(node) };
        return SKIP;
      }
      warn(file, `unsupported directive ${node.type === 'leafDirective' ? '::' : ':::'}${node.name} kept as plain block`);
      data.hName = 'div';
      data.hProperties = { className: ['ws-unknown', `ws-${node.name}`] };
      if (node.type === 'leafDirective') node.children = [{ type: 'paragraph', children: [{ type: 'text', value: directiveToText({ ...node, children: [] }) + ' ' }, ...node.children] }];
    });
  };
}

// hast: wrap tables / code blocks, collect h2/h3 outline.
function rehypeDecorate({ headings, file }) {
  return (tree) => {
    // Report directive syntax that did not parse (it would show up as literal text).
    visit(tree, (node, _i, parent) => {
      if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return SKIP;
      if (node.type === 'text' && /(^|\s)::?:?[a-zA-Z]+[[{]/.test(node.value) && parent) {
        warn(file, `unparsed directive text: ${node.value.trim().slice(0, 70)}`);
      }
    });
    visit(tree, 'element', (node, index, parent) => {
      if (!parent) return;
      if (node.tagName === 'table') {
        parent.children[index] = { type: 'element', tagName: 'div', properties: { className: ['table-wrap'] }, children: [node] };
        return SKIP;
      }
      if (node.tagName === 'pre' && !(node.properties?.className || []).includes('mermaid')) {
        const code = node.children.find((c) => c.tagName === 'code');
        const cls = (code?.properties?.className || []).find((c) => String(c).startsWith('language-'));
        const langName = cls ? String(cls).slice('language-'.length) : '';
        parent.children[index] = {
          type: 'element', tagName: 'div', properties: { className: ['code-block'], dataLang: langName },
          children: [
            { type: 'element', tagName: 'div', properties: { className: ['code-toolbar'] }, children: [
              { type: 'element', tagName: 'span', properties: { className: ['code-lang'] }, children: [{ type: 'text', value: langName }] },
              { type: 'element', tagName: 'button', properties: { type: 'button', className: ['copy-btn'] }, children: [{ type: 'text', value: 'Copy' }] },
            ] },
            node,
          ],
        };
        return SKIP;
      }
      if ((node.tagName === 'h2' || node.tagName === 'h3') && node.properties?.id) {
        headings.push({ depth: Number(node.tagName[1]), id: String(node.properties.id), text: hastToString(node).trim() });
      }
    });
  };
}

function preprocess(md) {
  // :assetUrl{path="/kb/x.md" source=s3} sits inside a quoted attribute with nested quotes,
  // which remark-directive cannot parse – resolve it textually first.
  return md
    .replace(/"\s*:assetUrl\{path=\\?"([^"\\]+)\\?"[^}]*\}\s*"/g, (_, p) => `"/assets/${p.replace(/^\/+/, '')}"`)
    .replace(/:assetUrl\{path=\\?"([^"\\]+)\\?"[^}]*\}/g, (_, p) => `/assets/${p.replace(/^\/+/, '')}`)
    // Workshop Studio accepts \" inside directive attributes (header="Why \"x\"?");
    // micromark does not, but it decodes character references there.
    .replace(/^(\s*::?:?[a-zA-Z][^\n]*)$/gm, (line) => line.replace(/\\"/g, '&quot;'));
}

async function render(md, lang, file) {
  const headings = [];
  const out = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkWorkshopStudio, { lang, file })
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeHighlight, { detect: false, plainText: ['text', 'cedar', 'txt'] })
    .use(rehypeDecorate, { headings, file })
    .use(rehypeStringify)
    .process(preprocess(md));
  return { html: String(out), headings };
}

// ---------------------------------------------------------------------------
// 3. Write output
// ---------------------------------------------------------------------------
fs.rmSync(path.join(GEN, 'pages'), { recursive: true, force: true });
fs.mkdirSync(path.join(GEN, 'pages'), { recursive: true });

const meta = { zh: {}, en: {} };
for (const p of found) {
  const raw = fs.readFileSync(p.file, 'utf8');
  const { data, content } = matter(raw);
  if (!data.title) warn(p.file, 'missing title in frontmatter');
  const { html, headings } = await render(content, p.lang, p.file);
  const page = { route: p.route, lang: p.lang, title: String(data.title ?? p.route), weight: Number(data.weight ?? 999), html, headings };
  meta[p.lang][p.route] = page;
  const outFile = path.join(GEN, 'pages', p.lang, p.route, 'index.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(page));
}

// Build the nav tree: home -> groups -> chapters, by weight then route.
function buildTree(lang) {
  const pages = Object.values(meta[lang]);
  const byParent = new Map();
  for (const pg of pages) {
    if (pg.route === '') continue;
    const parent = pg.route.includes('/') ? pg.route.slice(0, pg.route.lastIndexOf('/')) : '';
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(pg);
  }
  const make = (pg) => ({
    route: pg.route,
    title: pg.title,
    weight: pg.weight,
    children: (byParent.get(pg.route) || [])
      .sort((a, b) => a.weight - b.weight || a.route.localeCompare(b.route))
      .map(make),
  });
  const home = meta[lang][''] || { route: '', title: lang === 'zh' ? '首页' : 'Home', weight: 0 };
  return make(home);
}
const nav = Object.fromEntries(LANGS.map((l) => [l, buildTree(l)]));
for (const l of LANGS) {
  for (const r of routeSet[l]) {
    const other = LANGS.find((x) => x !== l);
    if (!routeSet[other].has(r)) warnings.push(`page /${r} exists in ${l} but not in ${other}`);
  }
}
fs.writeFileSync(path.join(GEN, 'nav.json'), JSON.stringify(nav, null, 2));

// Copy static files.
function copyDir(from, to, skip = () => false) {
  if (!fs.existsSync(from)) return 0;
  let n = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (ent.name === '.gitkeep' || ent.name === '.DS_Store' || skip(ent.name)) continue;
    const s = path.join(from, ent.name), d = path.join(to, ent.name);
    if (ent.isDirectory()) n += copyDir(s, d, skip);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}
for (const d of ['static', 'assets']) fs.rmSync(path.join(PUB, d), { recursive: true, force: true });
const nStatic = copyDir(path.join(SRC, 'static'), path.join(PUB, 'static'));
// Author-only files are not participant downloads: assets/README.md documents the
// S3 sync, and kb/POLICY-FACTS.md is the answer sheet behind the KB documents and
// the golden set (publishing it would hand out the expected answers).
const AUTHOR_ONLY = new Set(['README.md', 'POLICY-FACTS.md']);
const nAssets = copyDir(path.join(SRC, 'assets'), path.join(PUB, 'assets'), (n) => AUTHOR_ONLY.has(n));

console.log(`Synced from ${SRC}`);
for (const l of LANGS) console.log(`  ${l}: ${Object.keys(meta[l]).length} pages`);
console.log(`  copied ${nStatic} static files, ${nAssets} asset files`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log('  - ' + w);
}
