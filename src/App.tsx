import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BASE, DEFAULT_LANG, flatten, hasPage, LANGS, loadPage, nav, pagePath, UI } from './content';
import type { Heading, Lang, NavNode, Page } from './content';

export function RootRedirect() {
  return <Navigate to={`/${DEFAULT_LANG}/`} replace />;
}

export function DocRoute() {
  const params = useParams();
  const lang = params.lang as Lang;
  const route = (params['*'] || '').replace(/^\/+|\/+$/g, '');
  if (!LANGS.includes(lang)) return <Navigate to={`/${DEFAULT_LANG}/${params.lang ?? ''}${route ? '/' + route : ''}`} replace />;
  return <DocPage lang={lang} route={route} />;
}

function DocPage({ lang, route }: { lang: Lang; route: string }) {
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const t = UI[lang];

  useEffect(() => {
    let cancelled = false;
    setPage(undefined);
    loadPage(lang, route).then((p) => !cancelled && setPage(p));
    return () => {
      cancelled = true;
    };
  }, [lang, route]);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    if (page) document.title = route ? `${page.title} | ${nav[lang].title}` : page.title;
  }, [page, lang, route]);

  useEffect(() => setDrawerOpen(false), [lang, route]);

  const order = useMemo(() => flatten(lang), [lang]);
  const idx = order.findIndex((n) => n.route === route);
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const otherLang: Lang = lang === 'zh' ? 'en' : 'zh';
  const switchTarget = pagePath(otherLang, hasPage(otherLang, route) ? route : '');
  const activeId = useActiveHeading(page?.headings ?? []);

  return (
    <div className={`layout${drawerOpen ? ' drawer-open' : ''}`}>
      <header className="topbar">
        <button className="menu-btn" aria-label={t.menu} aria-expanded={drawerOpen} onClick={() => setDrawerOpen((o) => !o)}>
          <span />
          <span />
          <span />
        </button>
        <Link className="brand" to={pagePath(lang, '')}>
          {t.siteTitle}
        </Link>
        <div className="topbar-spacer" />
        <Link className="lang-switch" to={switchTarget} hrefLang={otherLang}>
          {t.switchTo}
        </Link>
      </header>

      <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
      <aside className="sidebar" aria-label={t.toc}>
        <div className="sidebar-title">{t.toc}</div>
        <NavTree node={nav[lang]} lang={lang} current={route} headings={page?.headings ?? []} activeId={activeId} isRoot />
      </aside>

      <main className="main">
        {page === undefined && <div className="loading">{t.loading}</div>}
        {page === null && (
          <div className="not-found">
            <h1>{t.notFound}</h1>
            <Link to={pagePath(lang, '')}>{t.backHome}</Link>
          </div>
        )}
        {page && (
          <>
            <Breadcrumb lang={lang} route={route} />
            <h1 className="page-title">{page.title}</h1>
            <Article page={page} lang={lang} />
            <nav className="pager">
              {prev ? (
                <Link className="pager-link prev" to={pagePath(lang, prev.route)}>
                  <span className="pager-label">← {t.prev}</span>
                  <span className="pager-title">{prev.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link className="pager-link next" to={pagePath(lang, next.route)}>
                  <span className="pager-label">{t.next} →</span>
                  <span className="pager-title">{next.title}</span>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </>
        )}
      </main>

      <aside className="outline" aria-label={t.onThisPage}>
        {page && page.headings.length > 0 && (
          <>
            <div className="outline-title">{t.onThisPage}</div>
            <Outline headings={page.headings} activeId={activeId} />
          </>
        )}
      </aside>
    </div>
  );
}

function Breadcrumb({ lang, route }: { lang: Lang; route: string }) {
  if (!route) return null;
  const parts = route.split('/');
  const crumbs: NavNode[] = [];
  let node: NavNode | undefined = nav[lang];
  crumbs.push(node);
  for (let i = 0; i < parts.length - 1 && node; i++) {
    const r = parts.slice(0, i + 1).join('/');
    node = node.children.find((c) => c.route === r);
    if (node) crumbs.push(node);
  }
  return (
    <div className="breadcrumb">
      {crumbs.map((c) => (
        <span key={c.route}>
          <Link to={pagePath(lang, c.route)}>{c.route ? c.title : lang === 'zh' ? '首页' : 'Home'}</Link>
          <span className="sep">/</span>
        </span>
      ))}
    </div>
  );
}

function NavTree(props: { node: NavNode; lang: Lang; current: string; headings: Heading[]; activeId: string; isRoot?: boolean }) {
  const { node, lang, current, headings, activeId, isRoot } = props;
  const isCurrent = node.route === current;
  const inBranch = isCurrent || current.startsWith(node.route + '/') || isRoot;
  const item = (
    <>
      <Link className={`nav-link${isCurrent ? ' current' : ''}${isRoot ? ' nav-home' : ''}`} to={pagePath(lang, node.route)} aria-current={isCurrent ? 'page' : undefined}>
        {node.title}
      </Link>
      {isCurrent && headings.length > 0 && (
        <div className="nav-outline">
          <Outline headings={headings} activeId={activeId} />
        </div>
      )}
    </>
  );
  if (isRoot) {
    return (
      <nav className="nav-tree">
        {item}
        <ul>
          {node.children.map((c) => (
            <li key={c.route} className="nav-group">
              <NavTree {...props} node={c} isRoot={false} />
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <>
      {item}
      {node.children.length > 0 && (
        <ul className={inBranch ? 'open' : ''}>
          {node.children.map((c) => (
            <li key={c.route}>
              <NavTree {...props} node={c} isRoot={false} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Outline({ headings, activeId }: { headings: Heading[]; activeId: string }) {
  return (
    <ul className="outline-list">
      {headings.map((h) => (
        <li key={h.id} className={`depth-${h.depth}${h.id === activeId ? ' active' : ''}`}>
          <a
            href={`#${h.id}`}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(h.id);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                history.replaceState(history.state, '', `#${encodeURIComponent(h.id)}`);
              }
            }}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

function useActiveHeading(headings: Heading[]): string {
  const [active, setActive] = useState('');
  useEffect(() => {
    if (!headings.length) return;
    const onScroll = () => {
      let cur = headings[0].id;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top < 120) cur = h.id;
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [headings]);
  return active;
}

function Article({ page, lang }: { page: Page; lang: Lang }) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const t = UI[lang];

  // Scroll to the hash (or top) whenever a page has been rendered.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id ? document.getElementById(id) : null;
    if (el) el.scrollIntoView();
    else window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Mermaid diagrams are rendered lazily on the client.
  useEffect(() => {
    const nodes = ref.current?.querySelectorAll<HTMLElement>('pre.mermaid');
    if (!nodes || nodes.length === 0) return;
    let cancelled = false;
    import('mermaid').then(({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', fontFamily: 'inherit' });
      mermaid.run({ nodes: Array.from(nodes) }).catch((err: unknown) => console.error('mermaid', err));
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLButtonElement>('.copy-btn').forEach((b) => (b.textContent = t.copy));
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const copy = target.closest<HTMLButtonElement>('.copy-btn');
      if (copy) {
        const code = copy.closest('.code-block')?.querySelector('pre')?.textContent ?? '';
        navigator.clipboard?.writeText(code.replace(/\n$/, '')).then(() => {
          copy.textContent = t.copied;
          copy.classList.add('done');
          setTimeout(() => {
            copy.textContent = t.copy;
            copy.classList.remove('done');
          }, 1500);
        });
        return;
      }
      const img = target.closest<HTMLImageElement>('img');
      if (img && !img.closest('a')) {
        setZoom({ src: img.src, alt: img.alt });
        return;
      }
      const a = target.closest<HTMLAnchorElement>('a[data-internal]');
      if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
        const href = a.getAttribute('href') || '';
        if (href.startsWith(BASE)) {
          e.preventDefault();
          navigate('/' + href.slice(BASE.length));
        }
        return;
      }
      const hashLink = target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (hashLink) {
        const el = document.getElementById(decodeURIComponent(hashLink.hash.slice(1)));
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [page, navigate, t]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  return (
    <>
      <article ref={ref} className="content" dangerouslySetInnerHTML={{ __html: page.html }} />
      {zoom && (
        <div className="zoom" role="dialog" aria-label={zoom.alt} onClick={() => setZoom(null)}>
          <img src={zoom.src} alt={zoom.alt} />
          <button className="zoom-close" aria-label={t.close}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
