# Tide Commander — Landing & Docs Site Plan

> Scout report authored by **Alakasam Cameron (xwwc21xd)** on 2026-04-20 for the next build agent. Be opinionated. Read top-to-bottom. Pick up the "Next actions" list at the bottom and start building.

---

## TL;DR — Recommendation

**Framework: Astro 4 + Starlight** (Astro's first-party docs theme), installed as a *sub-app* inside `src/packages/landing/` with its own `package.json`/`astro.config.mjs`. Keep the existing vanilla marketing page (`src/packages/landing/index.html` + `main.js` + `styles.css`) as the **marketing surface** — but migrate it *into* the same Astro app as a non-Starlight route at `/` so the whole thing ships as one static build. Docs live at `/docs`.

Why this and not the alternatives:

| Option | Verdict | Reason |
|---|---|---|
| **Astro + Starlight** ✅ | Pick this | MDX-first, ships ~0 KB JS, has sidebar+right TOC+Pagefind search+code-copy+dark-mode out of the box, matches reference-site UX (Codex/Claude docs), integrates cleanly with the project's existing Vite/TS toolchain (Astro *is* Vite under the hood). |
| VitePress | Runner-up | Vue-flavored; we're a React shop. Starlight has better component primitives (Card, CardGrid, Steps, Tabs, Aside) aligned with how the Claude docs site renders. |
| Docusaurus / Nextra | No | Docusaurus is Webpack-era heavy; Nextra drags in full Next.js/SSR we don't need for a static docs site. |
| Keep vanilla HTML (current state) | No | There is already ~3,500 LOC of hand-rolled HTML/CSS/JS at `src/packages/landing/`. It does not scale to dozens of doc pages, has no sidebar/TOC/search, and every new page would be another copy-pasted `<nav>`. |
| MDX + custom React | No | Would reinvent Starlight badly. |

---

## PART A — Existing Scaffold Check

### A.1 `src/packages/landing/` current state
- **Exists**, size ~3.5k LOC:
  - `src/packages/landing/index.html` (736 lines) — full single-page marketing site with nav, hero, problem section, features bento, views gallery, classes section, install instructions.
  - `src/packages/landing/styles.css` (2475 lines) — hand-written CSS with design tokens (see §Design Direction).
  - `src/packages/landing/main.js` (266 lines) — vanilla JS for scroll reveal, nav highlight, copy-to-clipboard.
  - `src/packages/landing/public/screenshots/` — asset folder.
- **Framework**: none — static HTML/CSS/JS, bundled via the root `vite.config.ts` multi-entry `input` (see below).
- **Routing**: none — single page with `#features`, `#views`, `#classes` anchors.
- **Scripts/build**:
  - `package.json` has `"dev:landing": "vite --open /src/packages/landing/index.html"`.
  - `vite.config.ts:104-107` declares a Rollup input: `landing: resolve(__dirname, 'src/packages/landing/index.html')`, so production build already emits it.
- **Docs content**: none yet. The nav's "Docs" link points to `https://github.com/deivid11/tide-commander/tree/master/docs` (GitHub folder). **That is what this plan replaces.**

### A.2 Root `package.json` landing-related entries
- `scripts.dev:landing` → `vite --open /src/packages/landing/index.html`
- `vite.config.ts:build.rollupOptions.input.landing` → second build entry
- No `workspaces` declared; this is a **single-package repo**, not an npm monorepo.
- No Astro/VitePress/Docusaurus/Nextra currently installed.

### A.3 How sibling packages are wired
Observed convention in `src/packages/`:
- **`client/`** — React 19 + Three.js SPA. Built by root `vite.config.ts` (entry `index.html` at repo root). Uses alias `@` → `src/packages/client`.
- **`server/`** — Express + TS backend. Built via its own `tsconfig.server.json` → `tsc -p tsconfig.server.json`. Output lands in `dist/`.
- **`shared/`** — plain `.ts` files imported by client+server via alias `@shared`.
- **`landing/`** — currently static assets hitching a ride on the client's Vite build.
- **Root `tsconfig.json`** covers client + shared + landing. `tsconfig.server.json` is the server-only TS build.

**Implication for the docs site**: keep the pattern — one package dir under `src/packages/`, one TS config extending root, one build script wired from root `package.json`. Astro gives us a self-contained `astro build` that dumps static files into `src/packages/landing/dist/` (or we point it at the project `dist/landing/`), and we hook `build:landing` into the root `build` script. **Do not** introduce npm workspaces for this — doesn't match the project shape and buys nothing.

---

## PART B — Reference-Style Research

### B.1 `https://developers.openai.com/codex` (observed via WebFetch)
- **Layout**: Dual-sidebar system. Primary global nav (API, Docs, Codex, ChatGPT, Resources) with a secondary contextual left sidebar for "Using Codex" sub-sections (App / IDE Extension / CLI / Web / Integrations).
- **Typography**: Hierarchical sans-serif, strong heading weight, generous line-height. Value-prop lede ("Codex is OpenAI's coding agent") in oversized display weight, supporting subheadings in medium.
- **Color scheme**: Light/dark toggle. Light mode is OpenAI's signature clean cream/white with near-black text; dark mode is deep graphite. Accents pull into OpenAI's brand blues/teals for CTAs.
- **Code blocks**: Monospace, dark-on-light in light mode, language tabs visible on reference pages, copy button in top-right corner of each block.
- **Cards**: Four-column CTA grid on home ("Quickstart / Explore use cases / Community / Codex for Open Source") with title + one-line descriptor — equal width, minimal decoration, hover lift.
- **Hero**: Full-width dual-image showcase (light + dark variants of the Codex app UI) sitting above the value-prop copy. Product-first, marketing-second.
- **Vibe**: Developer-first minimalism. IA clearly prioritizes *getting to the tool* (App / CLI / IDE) over decorative marketing.

### B.2 `https://platform.claude.com/docs/en/home` / `/docs/en/docs/intro` (observed)
- **Layout**: Classic three-column docs: **left sidebar** (nested category/page tree) + **main content column** + **right-side TOC** tracking current-page headings. Top nav for cross-product links (Anthropic.com, API, Console).
- **Content primitives seen in the page content**: `<Tip>`, `<Note>`, `<Steps>` (numbered walkthrough), `<CardGroup cols={2|3}>` with `<Card title icon href>` — indicates a Mintlify or Starlight-style component library. We should emulate these exact primitives.
- **Hero/home pattern**: Title + one-line blurb + a comparison table ("Messages API vs. Claude Managed Agents") + a "Recommended path for new developers" `<Steps>` block + "Develop with Claude" `<CardGroup>` + "Key capabilities" `<CardGroup>` + "Support" `<CardGroup>`. No huge hero image — informational density wins.
- **Color scheme (Anthropic brand)**: Warm cream/off-white light mode with rust/coral/burnt-sienna accents for links and primary CTAs; dark mode is warm near-black, not cold graphite. Accent color is a signal, not a fill — small doses on links, callout borders, code tokens.
- **Typography**: Likely an Anthropic variable-weight sans (Tiempos Headline / Styrene-family feel), body in a clean sans; code in a clear monospace.
- **Code blocks**: Dark-themed regardless of page theme, language tabs, copy button, language label top-left, sometimes a filename header.
- **Search**: Prominent command-palette-style search in the top bar (Cmd/Ctrl+K).
- **Vibe**: Calm, documentation-first, warm. Not flashy. The content, not the chrome, is the star.

### B.3 Common patterns — adopt these four
1. **Three-column docs chrome**: left sidebar (site tree) + article + right TOC. This is *the* industry-standard docs shell and what Starlight ships by default. Do not invent a new layout.
2. **Home-page card grids with icons**: both sites use 2–4 column card groups on doc home + section landing pages. Use `<CardGroup>` / `<LinkCard>` as the primary "choose your path" affordance.
3. **Steps component for quickstarts**: both sites lean on numbered-step walkthroughs for onboarding. The Tide Commander docs should use the same thing for "Install → First agent → First command → First boss".
4. **Callouts (Note/Tip/Warning)**: both sites use colored inline asides. Critical for permission warnings, HTTPS guidance, "this only works if `claude` is in PATH" gotchas.
5. (Bonus) **Code blocks with copy button + optional language tabs** — both sites do this; Starlight has it built-in. Don't regress.

---

## PART C — App-Feature Inventory (what the landing + docs must cover)

Source: `README.md` + `docs/*.md` filenames + `CONTRIBUTING.md` + `SECURITY.md` + `CHANGELOG.md`.

### Core user-facing concepts (each needs its own docs page)
- **Agents** — spawning, selection, terminal conversation, context/mana tracking.
- **Providers** — Claude Code, Codex, OpenCode (each has its own invocation + session semantics per README §Core Components).
- **Boss & Subordinate** — boss has context on subordinates, can delegate; we've seen the boss-message service and delegation parser in the codebase.
- **Classes** — Scout, Builder, Debugger, Architect, Warrior, Support, Boss + custom classes with GLB models + default skills.
- **Skills** — built-in (notifications, inter-agent messaging, streaming exec, git workflows) + custom TypeScript skills.
- **Group Areas** — project organization, archive/restore, folder attachment.
- **Buildings** — Server (PM2/Docker log streaming), Database (MySQL/Postgres/Oracle + query editor), Docker (containers + compose), Link, Folder, Boss Building.
- **Snapshots** — save conversation + touched files, restore.
- **Secrets** — `{{SECRET_NAME}}` placeholder injection, server-side resolution.
- **System Prompts & Prompt Stacking** — 5-layer hierarchy (Tide Commander Base → Global System Prompt → Class Instructions → Individual Agent Instructions → Skills/Identity).
- **Permission Modes** — Bypass vs Interactive, safe-tool list, Remembered Patterns, `~/.tide-commander/remembered-permissions.json`.
- **View Modes** — 3D, 2D, Dashboard, Commander View (plus Guake Terminal, Spotlight).
- **Spotlight Search** — Ctrl+K / Alt+P command palette.
- **Custom 3D Models** — GLB upload, animation mapping, position/scale.
- **Multiplayer** — WebSocket multi-user (mentioned but under-documented — flag for later pass).
- **Mobile / Resume Anywhere** — cross-device session continuation, optional Android APK.
- **HTTPS / Auth** — TLS cert generation via `mkcert`, `AUTH_TOKEN`, `--generate-auth-token`.
- **Configuration** — environment variables table from README + `.env.example`.
- **Deployment** — Docker, Android APK build.
- **API** — REST (`docs/openapi.yaml`), WebSocket (`docs/asyncapi.yaml`).
- **Architecture** — existing `docs/architecture.md` mermaid diagrams.

### Existing long-form docs to migrate (these are keepers — rehome them into the new docs tree)
- `docs/buildings.md` → `/docs/buildings/overview`
- `docs/custom-classes.md` → `/docs/advanced/custom-classes`
- `docs/skills.md` → `/docs/concepts/skills`
- `docs/snapshots.md` → `/docs/concepts/snapshots`
- `docs/secrets.md` → `/docs/concepts/secrets`
- `docs/architecture.md` → `/docs/reference/architecture`
- `docs/views.md` → `/docs/views/overview`
- `docs/android.md` → `/docs/deployment/android`
- `docs/docker.md` → `/docs/deployment/docker`
- `docs/codex-json-events.md` → `/docs/reference/codex-events`
- `docs/openapi.yaml` → render via Scalar or Redoc at `/docs/api/rest`
- `docs/asyncapi.yaml` → embed renderer at `/docs/api/websocket`

---

## Proposed File Tree

```
src/packages/landing/
├── DOCS-PLAN.md                       # this file — delete after build lands
├── package.json                       # astro + starlight + @astrojs/mdx (LOCAL to landing)
├── astro.config.mjs                   # Starlight config: sidebar, social, editLink
├── tsconfig.json                      # extends ../../../tsconfig.json
├── public/                            # static assets, screenshots, icons
│   ├── assets/
│   │   ├── landing/                   # screenshots reused from current site
│   │   └── icons/
│   └── screenshots/                   # (already exists)
├── src/
│   ├── content.config.ts              # Starlight content collection config
│   ├── content/
│   │   └── docs/
│   │       ├── index.mdx              # docs home — CardGrid + Steps
│   │       ├── getting-started/
│   │       │   ├── quickstart.mdx
│   │       │   ├── installation.mdx
│   │       │   ├── first-agent.mdx
│   │       │   └── providers.mdx      # Claude / Codex / OpenCode setup
│   │       ├── concepts/
│   │       │   ├── agents.mdx
│   │       │   ├── boss-and-subordinates.mdx
│   │       │   ├── delegation.mdx
│   │       │   ├── classes.mdx
│   │       │   ├── skills.mdx
│   │       │   ├── areas.mdx
│   │       │   ├── snapshots.mdx
│   │       │   └── secrets.mdx
│   │       ├── views/
│   │       │   ├── overview.mdx
│   │       │   ├── 3d.mdx
│   │       │   ├── 2d.mdx
│   │       │   ├── dashboard.mdx
│   │       │   ├── commander.mdx
│   │       │   ├── guake-terminal.mdx
│   │       │   └── spotlight.mdx
│   │       ├── buildings/
│   │       │   ├── overview.mdx       # migrated from docs/buildings.md
│   │       │   ├── server.mdx
│   │       │   ├── database.mdx
│   │       │   ├── docker.mdx
│   │       │   ├── link.mdx
│   │       │   └── boss-building.mdx
│   │       ├── configuration/
│   │       │   ├── system-prompt.mdx
│   │       │   ├── prompt-stacking.mdx
│   │       │   ├── permissions.mdx
│   │       │   ├── env-vars.mdx
│   │       │   ├── https-and-auth.mdx
│   │       │   └── keyboard-shortcuts.mdx
│   │       ├── advanced/
│   │       │   ├── custom-classes.mdx     # from docs/custom-classes.md
│   │       │   ├── custom-skills.mdx
│   │       │   ├── custom-3d-models.mdx
│   │       │   └── multiplayer.mdx
│   │       ├── deployment/
│   │       │   ├── docker.mdx             # from docs/docker.md
│   │       │   ├── android.mdx            # from docs/android.md
│   │       │   └── mobile-remote.mdx
│   │       ├── reference/
│   │       │   ├── architecture.mdx       # from docs/architecture.md
│   │       │   ├── api-rest.mdx           # <scalar> embed of openapi.yaml
│   │       │   ├── api-websocket.mdx      # asyncapi renderer
│   │       │   ├── cli.mdx                # tide-commander CLI flags
│   │       │   ├── data-storage.mdx       # ~/.local/share/tide-commander/
│   │       │   └── codex-events.mdx       # from docs/codex-json-events.md
│   │       └── contributing/
│   │           ├── setup.mdx
│   │           ├── security.mdx           # from SECURITY.md
│   │           └── changelog.mdx          # mirror CHANGELOG.md
│   ├── pages/
│   │   └── index.astro                    # MARKETING home — port from current index.html
│   ├── components/
│   │   ├── Hero.astro                     # big hero w/ install snippet + demo CTA
│   │   ├── FeatureBento.astro             # bento grid from current site
│   │   ├── ShortcutKey.astro              # <kbd> styled component
│   │   ├── ProviderBadge.astro            # Claude / Codex / OpenCode chips
│   │   └── SocialProof.astro              # npm / GH / Discord badges
│   └── styles/
│       └── custom.css                     # Starlight theme overrides (brand colors)
└── screenshots/                           # (already exists — symlink or move under public/)
```

**Ports**:
- Dev: `astro dev` on `:4321` (default). Add to root `package.json` as `"dev:landing": "cd src/packages/landing && npm run dev"`.
- Build: `"build:landing": "cd src/packages/landing && npm run build"` — emits static files to `src/packages/landing/dist/`.
- Deployment: produced static site is served by the Tide Commander server at `/` + `/docs/*` (wire an Express static-mount under `src/packages/server/routes/` pointing at `dist/landing`). OR deploy separately to tidecommander.com; keep the server mount for `bunx tide-commander` users who want offline docs.
- **Remove** the Rollup `landing` entry from root `vite.config.ts:104-107` once Astro takes over. Simultaneously delete the three legacy files (`index.html`, `main.js`, `styles.css`) from `src/packages/landing/` after their content has been ported into Astro components — do not do this until the Astro site is visually at parity.

---

## Design Direction

### Palette (hex-exact; brand-consistent with current app + landing)
Reuse the tokens already defined in `src/packages/landing/styles.css:5-39` so the docs site feels like one house:

**Dark mode (default — matches current app UI)**
- Background layers: `#0a0a0f` primary, `#12121a` secondary, `#15151f` card, `#1a1a25` tertiary
- Text: `#ffffff` primary, `#a0a0b0` secondary, `#606070` muted
- Accent: `#6366f1` indigo (primary), `#8b5cf6` purple (secondary), `#06b6d4` cyan (tertiary)
- Gradient: `linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)` — use on H1, hero title, active sidebar item, link-on-hover underlines
- Semantic: `#22c55e` success, `#f59e0b` warning, `#ef4444` error — map to Starlight `<Aside type>`

**Light mode (add this — reference sites both have it)**
- Background: `#ffffff` / `#f8f8fb` / `#f0f0f5`
- Text: `#0a0a0f` / `#404050` / `#808090`
- Accent (keep same hues, darkened slightly for AA contrast): `#4f46e5` / `#7c3aed` / `#0891b2`

### Typography
- Headings + body: **Inter** 400/500/600/700/800 (already loaded via Google Fonts in current landing — reuse).
- Code + `<kbd>`: **JetBrains Mono** 400/500 (already loaded).
- Heading scale (Starlight defaults are fine; override only if needed): H1 2.5rem→3rem, H2 2rem, H3 1.5rem, body 1rem/1.6.
- Use the indigo→cyan gradient as `background-clip: text` for the H1 of marketing pages and the docs home title. Do NOT use it on inline docs headings — too loud at scale.

### Layout primitives
- **Docs pages**: Starlight's default three-column (left sidebar / article / right TOC). Sidebar max-width 280px, article max-width 768px readable column, TOC 200px.
- **Marketing home (`/`)**: keep current bento + hero layout; port into Astro islands. No left sidebar on marketing route (hide Starlight chrome for `pages/index.astro`).
- **Home cards**: 2- and 3-column `<CardGrid>` from Starlight. Icons: use Phosphor (already a project dep — `@phosphor-icons/react@2.1.10`) rendered via Astro's static SSR so no React bundle ships to docs readers.
- **Code blocks**: Starlight default (Shiki, dark-only by default — override to respect theme). Enable the `expressive-code` plugin for line-highlighting + frames + copy button.
- **Callouts**: `<Aside type="note|tip|caution|danger">` — Starlight built-in.
- **Steps**: use `<Steps>` from `@astrojs/starlight/components` for quickstart walkthroughs.
- **Nav chrome**: top bar with logo (Tide Commander mark), search (Pagefind, Cmd/K), GitHub + Discord icons, theme toggle, version badge (pulled from root `package.json` at build time via `import.meta.env`).

### Content components to build
- `<ProviderBadge provider="claude|codex|opencode">` — small chip indicating which CLI the section applies to.
- `<ShortcutKey>⌘ K</ShortcutKey>` — styled `<kbd>` matching current landing.
- `<FeatureCard icon title href>` — 3-col grid card wrapping Starlight's `<LinkCard>` with our brand styling.
- `<VersionBadge>` — reads `__APP_VERSION__` define and renders the npm version pill.

---

## Information Architecture (sidebar structure)

Flat-ish, two levels max — matches both reference sites.

```
Docs
├─ Getting Started
│   ├─ Quickstart                    ← write first
│   ├─ Installation
│   ├─ Your First Agent              ← write second
│   └─ Providers (Claude/Codex/OpenCode)
├─ Core Concepts
│   ├─ Agents                        ← write third
│   ├─ Boss & Subordinates           ← write fourth
│   ├─ Delegation
│   ├─ Classes
│   ├─ Skills
│   ├─ Areas
│   ├─ Snapshots
│   └─ Secrets
├─ Views
│   ├─ Overview
│   ├─ 3D Battlefield
│   ├─ 2D Canvas
│   ├─ Dashboard
│   ├─ Commander View
│   ├─ Guake Terminal
│   └─ Spotlight Search
├─ Buildings
│   ├─ Overview
│   ├─ Server
│   ├─ Database
│   ├─ Docker
│   ├─ Link
│   └─ Boss Building
├─ Configuration
│   ├─ System Prompt                 ← write early (power-user feature)
│   ├─ Prompt Stacking
│   ├─ Permissions
│   ├─ Environment Variables
│   ├─ HTTPS & Auth
│   └─ Keyboard Shortcuts
├─ Advanced
│   ├─ Custom Classes & 3D Models
│   ├─ Custom Skills
│   └─ Multiplayer
├─ Deployment
│   ├─ Docker
│   ├─ Android APK
│   └─ Mobile Remote
├─ Reference
│   ├─ Architecture
│   ├─ REST API                      ← render docs/openapi.yaml
│   ├─ WebSocket API                 ← render docs/asyncapi.yaml
│   ├─ CLI
│   ├─ Data Storage
│   └─ Codex JSON Events
└─ Contributing
    ├─ Setup
    ├─ Security
    └─ Changelog
```

Top nav (horizontal): **Docs · API · Changelog · GitHub · Discord · Demo (→ /app) · Theme toggle · ⌘K Search**

---

## Priority Page List (write in this order)

Tier 1 — **ship the docs site usable with these 8 pages**:
1. `/docs/` — docs home (CardGrid: Quickstart / Concepts / Configuration / API; Steps block "Zero to first agent in 3 minutes")
2. `/docs/getting-started/quickstart`
3. `/docs/getting-started/first-agent`
4. `/docs/concepts/agents`
5. `/docs/concepts/boss-and-subordinates`
6. `/docs/concepts/classes`
7. `/docs/concepts/skills`
8. `/docs/configuration/system-prompt` (high-value feature, already well documented in README lines 152-173)

Tier 2 — **fills out the map, 1 week later**:
9. `/docs/getting-started/providers` (Claude / Codex / OpenCode install)
10. `/docs/concepts/delegation`
11. `/docs/concepts/snapshots`
12. `/docs/concepts/secrets`
13. `/docs/configuration/permissions`
14. `/docs/configuration/keyboard-shortcuts`
15. `/docs/views/overview`
16. `/docs/buildings/overview`

Tier 3 — **migrations (these mostly already exist in `docs/`, just port)**:
17. All `/docs/advanced/*` (custom classes, skills, 3D models)
18. All `/docs/deployment/*`
19. All `/docs/reference/*`
20. `/docs/contributing/*`

Tier 4 — **fancy**:
21. Embed `<scalar-api-reference>` for OpenAPI at `/docs/reference/api-rest`.
22. Embed AsyncAPI React component for `/docs/reference/api-websocket`.
23. Interactive "Try It" panel on home that deep-links to `/app`.

---

## Implementation Gotchas (read before coding)

1. **Don't delete the existing `index.html`/`main.js`/`styles.css` until the Astro marketing page is at visual parity.** There is a production site at `https://tidecommander.com/` that is built from this. Screenshot first, port second, delete third.
2. **Remove the Rollup `landing` input** from `vite.config.ts:104-107` only after Astro takes over — otherwise the root `bun run build` will either double-build or fail.
3. **Asset paths**: current site references `/assets/landing/...` which resolves from the repo-root `public/` directory (see `publicDir: 'public'` in `vite.config.ts:50`). Astro has its own `public/` dir — move or copy the `assets/landing/` subtree into `src/packages/landing/public/assets/landing/`. Update `og:image` and `og:url` absolute URLs to match the final deployment origin.
4. **Google Analytics tag** (`G-5WBC1WJMYY`) is currently hardcoded in `index.html:5-12`. Move it into `astro.config.mjs` via a site-wide `<head>` injection or Starlight's `head` config so it applies to docs pages too (if desired — consider whether docs should be analytics-instrumented).
5. **Pagefind search** (Starlight default) runs at build time over markdown content — no runtime server needed. Free of charge.
6. **`i18n`**: README advertises 10 languages. Starlight supports i18n natively via content collection locales. **Do NOT translate docs on day one** — ship English, add i18n scaffolding, fill over time. Put this in the "later" column with the team.
7. **Server integration for offline docs**: when a user runs `bunx tide-commander`, it would be nice if the docs are served locally at `http://localhost:5174/docs`. Add a static mount in `src/packages/server/app.ts` that serves `dist/landing/` at `/` + `/docs` (but only if the directory exists — keeps dev mode clean).
8. **React 19 compatibility**: Astro + Starlight work without React. Don't pull in React islands just to reuse existing client components. The docs site should ship ~0 KB of JS except for Pagefind search + theme toggle.
9. **Edit-on-GitHub link**: Starlight supports `editLink.baseUrl` — wire to `https://github.com/deivid11/tide-commander/edit/master/src/packages/landing/src/content/docs/`. Huge contributor-experience win for ~2 lines of config.
10. **Anchor migrations**: the current marketing page uses `#features`, `#views`, `#classes` anchors. Preserve these on the new Astro marketing home so inbound links from the wild don't break.

---

## Next Actions (hand this list to the builder agent)

1. `cd src/packages/landing && npm create astro@latest . -- --template starlight --no-install --no-git --typescript strict`
2. Add `@astrojs/mdx`, `astro-expressive-code`, and `sharp` to landing's `package.json`.
3. Port the color tokens from `src/packages/landing/styles.css:5-39` into `src/packages/landing/src/styles/custom.css` and wire via `starlight.customCss`.
4. Build Tier 1 pages with content lifted from `README.md` sections (line numbers are reliable — e.g. System Prompt content at README:152-173, Agent Concepts at README:109-167).
5. Port the existing marketing page into `src/packages/landing/src/pages/index.astro` as a non-Starlight route (use `splash` template or custom layout hiding sidebar/TOC).
6. Wire `dev:landing` / `build:landing` / `build` scripts at the root `package.json`. Remove the Rollup `landing` input from `vite.config.ts`.
7. Add an Express static mount for `dist/landing/` at the server `/` route (with fall-through to the SPA for `/app`).
8. Visual QA against current tidecommander.com. Ship.

---

*End of plan. Keep it opinionated, keep it boring, and ship the boring parts first. — Cameron*
