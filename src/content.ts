import navJson from './generated/nav.json';

export type Lang = 'zh' | 'en';
export const LANGS: Lang[] = ['zh', 'en'];
export const DEFAULT_LANG: Lang = 'zh';

export interface NavNode {
  route: string;
  title: string;
  weight: number;
  children: NavNode[];
}
export interface Heading {
  depth: number;
  id: string;
  text: string;
}
export interface Page {
  route: string;
  lang: Lang;
  title: string;
  weight: number;
  html: string;
  headings: Heading[];
}

export const nav = navJson as Record<Lang, NavNode>;

/** Pages in reading order (home, group, its chapters, next group, ...). */
export function flatten(lang: Lang): NavNode[] {
  const out: NavNode[] = [];
  const walk = (n: NavNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(nav[lang]);
  return out;
}

export function hasPage(lang: Lang, route: string): boolean {
  return flatten(lang).some((n) => n.route === route);
}

const loaders = import.meta.glob<Page>('./generated/pages/**/index.json', { import: 'default' });

export const BASE = import.meta.env.BASE_URL; // always ends with "/"

export async function loadPage(lang: Lang, route: string): Promise<Page | null> {
  const key = `./generated/pages/${lang}/${route ? route + '/' : ''}index.json`;
  const loader = loaders[key];
  if (!loader) return null;
  const page = await loader();
  return { ...page, html: page.html.split('%BASE%').join(BASE) };
}

export function pagePath(lang: Lang, route: string): string {
  return `/${lang}/${route}`;
}

export const UI = {
  zh: {
    toc: '目录',
    onThisPage: '本页内容',
    prev: '上一章',
    next: '下一章',
    menu: '菜单',
    close: '关闭',
    notFound: '页面不存在',
    backHome: '返回首页',
    loading: '加载中…',
    copy: '复制',
    copied: '已复制',
    switchTo: 'English',
    siteTitle: 'Agent-DLC Workshop',
  },
  en: {
    toc: 'Contents',
    onThisPage: 'On this page',
    prev: 'Previous',
    next: 'Next',
    menu: 'Menu',
    close: 'Close',
    notFound: 'Page not found',
    backHome: 'Back to home',
    loading: 'Loading…',
    copy: 'Copy',
    copied: 'Copied',
    switchTo: '中文',
    siteTitle: 'Agent-DLC Workshop',
  },
} as const;
