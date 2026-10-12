#!/usr/bin/env python3
"""Smoke-test the built site with Playwright (chromium).

Start a server first (scripts/serve_dist.py or `npx vite preview`), then:
  python tests/e2e_check.py --url http://127.0.0.1:4173/agent-dlc-workshop/ [--shots /tmp/site-shots]
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

ROUTES = ["", "10-prepare", "20-flywheel/30-evaluate", "20-flywheel/40-release", "10-prepare/20-setup", "20-flywheel/10-define", "20-flywheel/20-build"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--shots", default="")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()
    base = args.url.rstrip("/") + "/"
    failures = []
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base.split("/", 3)[0] + "//" + base.split("/")[2])
        page = ctx.new_page()
        bad, console_errors = [], []
        page.on("response", lambda r: r.status >= 400 and bad.append((r.status, r.url, r.request.resource_type)))
        page.on("requestfailed", lambda r: bad.append(("failed", r.url, r.request.resource_type)))
        page.on("console", lambda m: m.type == "error" and console_errors.append(m.text))

        for lang in ["zh", "en"]:
            for route in ROUTES:
                bad.clear()
                console_errors.clear()
                url = f"{base}{lang}/{route}"
                page.goto(url, wait_until="networkidle")
                page.wait_for_selector("article.content")
                # Force lazy images to load, then wait for them.
                page.evaluate("document.querySelectorAll('article img').forEach(i => i.loading = 'eager')")
                page.wait_for_function("[...document.querySelectorAll('article img')].every(i => i.complete)", timeout=20000)
                page.wait_for_timeout(1200)  # mermaid
                info = page.evaluate("""() => ({
                  title: document.querySelector('.page-title')?.textContent,
                  docTitle: document.title,
                  navLinks: document.querySelectorAll('.sidebar .nav-link').length,
                  current: document.querySelector('.sidebar .nav-link.current')?.textContent,
                  outline: document.querySelectorAll('.outline .outline-list li').length,
                  alerts: document.querySelectorAll('article .ws-alert').length,
                  expands: document.querySelectorAll('article details.ws-expand').length,
                  tables: document.querySelectorAll('article .table-wrap table').length,
                  code: document.querySelectorAll('article .code-block').length,
                  copyBtns: document.querySelectorAll('article .copy-btn').length,
                  mermaidSrc: document.querySelectorAll('article pre.mermaid').length,
                  mermaidSvg: document.querySelectorAll('article pre.mermaid svg').length,
                  imgs: document.querySelectorAll('article img').length,
                  brokenImgs: [...document.querySelectorAll('article img')].filter(i => !i.naturalWidth).map(i => i.src),
                  downloads: [...document.querySelectorAll('article a[download]')].map(a => a.getAttribute('href')),
                  leftoverDirectives: (document.querySelector('article').innerText.match(/(^|\\s)::?:?[a-z]+[\\[{]/g) || []),
                  leftoverComments: document.querySelector('article').innerHTML.includes('<!--'),
                  prev: document.querySelector('.pager .prev .pager-title')?.textContent || null,
                  next: document.querySelector('.pager .next .pager-title')?.textContent || null,
                  tableOverflowOk: [...document.querySelectorAll('.table-wrap')].every(w => w.getBoundingClientRect().right <= document.querySelector('main').getBoundingClientRect().right + 1),
                })""")
                # Main document may be 404 in SPA-fallback mode; everything else must be 2xx.
                real_bad = [b for b in bad if not (b[2] == "document" and b[0] == 404)]
                if not real_bad:  # the expected 404 of the document itself in SPA-fallback mode
                    console_errors[:] = [e for e in console_errors if "status of 404" not in e]
                info.update(url=url, badRequests=real_bad, consoleErrors=console_errors[:5], docStatus=[b[0] for b in bad if b[2] == "document"])
                results.append(info)
                if info["navLinks"] < 10: failures.append(f"{url}: TOC missing")
                if info["current"] != info["title"]: failures.append(f"{url}: current TOC item {info['current']!r} != title {info['title']!r}")
                if route and route.count("/") and info["outline"] == 0: failures.append(f"{url}: no outline")
                if info["brokenImgs"]: failures.append(f"{url}: broken images {info['brokenImgs']}")
                if real_bad: failures.append(f"{url}: bad requests {real_bad}")
                if info["mermaidSrc"] != info["mermaidSvg"]: failures.append(f"{url}: mermaid not rendered")
                if info["leftoverDirectives"]: failures.append(f"{url}: leftover directives {info['leftoverDirectives']}")
                if info["leftoverComments"]: failures.append(f"{url}: html comments leaked")
                if console_errors: failures.append(f"{url}: console errors {console_errors[:3]}")
                if args.shots and route in ("", "20-flywheel/30-evaluate", "20-flywheel/40-release"):
                    name = (route or "home").replace("/", "_")
                    page.screenshot(path=os.path.join(args.shots, f"{args.tag}{lang}-{name}.png"))

        # --- interactions -----------------------------------------------------
        page.goto(f"{base}zh/20-flywheel/30-evaluate", wait_until="networkidle")
        # TOC navigation (client-side)
        page.click(".sidebar .nav-link >> text=阶段四")
        page.wait_for_url("**/zh/20-flywheel/40-release")
        try:
            page.wait_for_function("document.querySelector('.page-title')?.textContent.includes('发布')", timeout=5000)
        except Exception:
            failures.append("TOC click did not load release page")
        # In-content internal link
        link = page.locator("article a[data-internal]").first
        href = link.get_attribute("href")
        link.click()
        page.wait_for_load_state("networkidle")
        if not page.url.endswith(href.split("#")[0].rstrip("/")) and href.split("#")[0] not in page.url:
            failures.append(f"internal link {href} -> {page.url}")
        # Language switch keeps page
        page.goto(f"{base}zh/20-flywheel/40-release", wait_until="networkidle")
        page.click(".lang-switch")
        page.wait_for_url("**/en/20-flywheel/40-release")
        try:
            page.wait_for_function("document.querySelector('.page-title')?.textContent.includes('Release')", timeout=5000)
        except Exception:
            failures.append("lang switch lost the page")
        # Prev/next
        page.click(".pager .next")
        page.wait_for_url("**/en/20-flywheel/50-observe")
        # Copy button
        page.goto(f"{base}en/20-flywheel/40-release", wait_until="networkidle")
        btn = page.locator("article .copy-btn").first
        btn.scroll_into_view_if_needed()
        btn.click()
        page.wait_for_timeout(200)
        if btn.text_content() != "Copied": failures.append(f"copy button text {btn.text_content()!r}")
        clip = page.evaluate("navigator.clipboard.readText()")
        if not clip.strip(): failures.append("clipboard empty")
        # Expand toggles
        page.goto(f"{base}zh/20-flywheel/30-evaluate", wait_until="networkidle")
        d = page.locator("details.ws-expand").first
        d.locator("summary").click()
        if not d.evaluate("e => e.open"): failures.append("expand did not open")
        # Outline anchor click
        page.locator(".outline .outline-list a").nth(3).click()
        page.wait_for_timeout(800)
        # Image zoom
        page.locator("article img").first.click()
        if not page.locator(".zoom img").count(): failures.append("image zoom did not open")
        page.keyboard.press("Escape")
        # Root redirect
        page.goto(base, wait_until="networkidle")
        if not page.url.rstrip("/").endswith("/zh"): failures.append(f"root did not redirect to zh: {page.url}")
        # Hash deep link
        page.goto(f"{base}zh/20-flywheel/30-evaluate#前置条件", wait_until="networkidle")
        page.wait_for_timeout(500)
        top = page.evaluate("document.getElementById('前置条件').getBoundingClientRect().top")
        if not (0 <= top < 200): failures.append(f"hash deep link not scrolled (top={top})")

        # --- mobile -----------------------------------------------------------
        m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = m.new_page()
        mp.goto(f"{base}zh/20-flywheel/40-release", wait_until="networkidle")
        vis = mp.evaluate("document.querySelector('.sidebar').getBoundingClientRect().right")
        if vis > 1: failures.append("drawer visible before opening on mobile")
        if args.shots:
            mp.screenshot(path=os.path.join(args.shots, f"{args.tag}mobile-zh-40-release.png"))
        mp.click(".menu-btn")
        mp.wait_for_timeout(400)
        if mp.evaluate("document.querySelector('.sidebar').getBoundingClientRect().left") < -1: failures.append("drawer did not open")
        if not mp.locator(".sidebar .nav-outline li").count(): failures.append("no outline in mobile drawer")
        if args.shots:
            mp.screenshot(path=os.path.join(args.shots, f"{args.tag}mobile-zh-drawer.png"))
        mp.click(".sidebar .nav-link >> text=阶段五")
        mp.wait_for_url("**/zh/20-flywheel/50-observe")
        mp.wait_for_timeout(400)
        if mp.evaluate("document.querySelector('.sidebar').getBoundingClientRect().right") > 1: failures.append("drawer did not close after navigation")
        sw = mp.evaluate("document.documentElement.scrollWidth")
        if sw > 391: failures.append(f"mobile page overflows horizontally ({sw}px)")
        browser.close()

    for r in results:
        print(json.dumps({k: r[k] for k in ("url", "title", "navLinks", "outline", "alerts", "expands", "tables", "code", "mermaidSvg", "imgs", "downloads", "prev", "next")}, ensure_ascii=False))
    print("\nFAILURES:" if failures else "\nALL CHECKS PASSED")
    for f in failures:
        print("  - " + f)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
