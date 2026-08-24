---
description: "Accessibility checks that automated tooling cannot verify, to be run by hand against the built site before each deploy."
canonical: "https://pitway.thixpin.me/manual-checks.html"
ogType: "article"
ogTitle: "Manual Accessibility Checks · PitWay Docs"
ogDescription: "Accessibility checks that automated tooling cannot verify, to be run by hand against the built site before each deploy."
ogUrl: "https://pitway.thixpin.me/manual-checks.html"
ogSiteName: "PitWay Docs"
---

# Manual Accessibility Checks

`check-a11y.mjs` audits only what's automatable from the built HTML/CSS
(image alt text, `:focus-visible`/`prefers-reduced-motion` presence). The
checks below require a human running the site in a real browser.

## Keyboard navigation

- Starting from the top of the page, press Tab repeatedly and confirm:
  - The skip link ("Skip to main content") is the first stop and, once
    focused, is visible against the page background.
  - Activating it moves focus to `#main-content`, skipping the header nav.
  - Every nav link, CTA, docs sidebar link, breadcrumb link, and prev/next
    link receives a visible focus outline in the order they appear on the
    page -- no focusable element is skipped, and focus never lands on a
    non-interactive element.
  - No keyboard trap: Tab (and Shift+Tab) always keeps moving through the
    page and eventually cycles back to the top.

## Reduced-motion behavior

- Enable "reduce motion" in the OS accessibility settings (or Chrome
  DevTools' "Emulate CSS prefers-reduced-motion" rendering setting).
- Reload the site and confirm the link-color hover transition (and any
  other transition/animation present at the time of this check) no longer
  animates -- it should apply instantly instead of easing.

## Video captions

- The site currently ships no video content. If a future page adds one,
  confirm it has accurate captions (or a transcript) before it ships, and
  add a page-specific check to this list.
