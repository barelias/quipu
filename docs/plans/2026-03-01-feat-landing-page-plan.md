---
title: "feat: Beautiful Landing Page with Installation Guide"
type: feat
status: active
date: 2026-03-01
---

# Beautiful Landing Page with Installation Guide

## Overview

Create a standalone landing page for Quipu Simple — a beautiful, modern marketing page that explains what the editor is, shows screenshots/demos, provides dead-simple installation instructions, and links to documentation. Completely isolated from the main app codebase.

## Problem Statement / Motivation

Quipu Simple has no public-facing presence. Potential users need:
- A clear explanation of what it does (web-based code editor with rich text, dual runtime)
- Visual proof it looks good (screenshots, demo)
- Obvious installation steps (copy-paste commands)
- Links to docs/GitHub for deeper exploration

## Proposed Solution

Create a `landing/` directory at the project root with a standalone static site (HTML + CSS + minimal JS). No build step required — just open `index.html` or deploy to any static host.

### Page Structure

1. **Hero** — Tagline + subtitle + CTA buttons (Install / View Docs) + hero screenshot placeholder
2. **Features** — 3-4 feature cards with icons explaining key capabilities
3. **Screenshot Gallery** — 2-3 screenshot placeholders with captions
4. **Installation** — Step-by-step with copy-paste terminal commands
5. **Documentation Link** — Card linking to full docs (concepts, usage, architecture)
6. **Footer** — GitHub link, license, credits

### Design Direction

- Clean, modern, dark with warm terracotta accents (matching Quipu's theme)
- Large typography, generous whitespace
- Placeholder images with clear `[LOGO]`, `[SCREENSHOT]` labels where real assets will go
- Responsive — works on mobile through desktop
- No framework dependencies — vanilla HTML/CSS/JS

## Technical Considerations

- **Completely isolated** — new `landing/` directory, no shared files with `src/`
- **No build step** — static HTML, inline or linked CSS, minimal vanilla JS for scroll animations
- **Placeholder images** — Use `<div>` with background color and text labels, or SVG placeholder boxes
- **Tailwind not used** — standalone CSS to avoid coupling with the app's build system
- **Fonts**: Load Inter and Clash Grotesk from Google Fonts CDN (same fonts as the app)

## System-Wide Impact

- **Zero impact on existing codebase** — entirely new directory
- No shared files with any other plan

## Acceptance Criteria

- [ ] `landing/index.html` is a complete, standalone page
- [ ] Hero section with tagline, subtitle, and two CTA buttons
- [ ] Feature cards explaining: Rich Text Editor, Dual Runtime, Terminal Integration, FRAME AI Context
- [ ] Screenshot gallery with 3 placeholder image boxes (labeled for replacement)
- [ ] Installation section with:
  - `git clone` + `npm install` + `npm run dev` commands
  - Copy button on each command block
  - Note about Go server for browser mode
- [ ] Documentation section with link placeholder and basic concepts overview
- [ ] Responsive layout (mobile-first)
- [ ] Dark theme with terracotta accent (#c4835a) matching Quipu's design
- [ ] Page loads without any build step (static files only)
- [ ] Logo placeholder clearly marked for replacement

## Success Metrics

- Someone visiting the page can understand what Quipu is and install it in under 2 minutes
- Page loads in under 1 second (no heavy dependencies)

## Dependencies & Risks

- No technical risks — completely standalone
- Design quality depends on iteration — placeholder images will need replacement later

## MVP

### landing/index.html (structure)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quipu — A Modern Code Editor</title>
  <link rel="stylesheet" href="styles.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Clash+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <!-- Hero -->
  <section class="hero">
    <nav class="nav">
      <div class="logo-placeholder">[LOGO]</div>
      <div class="nav-links">
        <a href="#features">Features</a>
        <a href="#install">Install</a>
        <a href="#docs">Docs</a>
        <a href="https://github.com/barelias/quipu" class="btn-outline">GitHub</a>
      </div>
    </nav>
    <div class="hero-content">
      <h1>Write. Think. Build.</h1>
      <p class="hero-subtitle">A modern code editor with rich text, AI context, and dual runtime — runs in your browser or as a desktop app.</p>
      <div class="hero-cta">
        <a href="#install" class="btn-primary">Get Started</a>
        <a href="#docs" class="btn-secondary">Read the Docs</a>
      </div>
    </div>
    <div class="hero-screenshot">
      <!-- Placeholder for main screenshot -->
      <div class="screenshot-placeholder">[MAIN SCREENSHOT — editor with file tree, terminal, and rich text]</div>
    </div>
  </section>

  <!-- Features -->
  <section id="features" class="features">
    <h2>Built for the way you work</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <div class="feature-icon">📝</div>
        <h3>Rich Text & Markdown</h3>
        <p>TipTap-powered editor with WYSIWYG formatting, markdown round-trip, and YAML frontmatter support.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🖥️</div>
        <h3>Dual Runtime</h3>
        <p>Run as an Electron desktop app or in the browser with a Go backend. Same experience, your choice.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🤖</div>
        <h3>AI-Native Context</h3>
        <p>FRAME per-file metadata system gives Claude and other AI tools deep context about your code.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <h3>Integrated Terminal</h3>
        <p>Built-in xterm.js terminal with Claude Code integration. Send files to AI with one shortcut.</p>
      </div>
    </div>
  </section>

  <!-- Screenshots -->
  <section class="screenshots">
    <div class="screenshot-placeholder">[SCREENSHOT — dark theme with source control panel]</div>
    <div class="screenshot-placeholder">[SCREENSHOT — comment annotations with FRAME sidebar]</div>
    <div class="screenshot-placeholder">[SCREENSHOT — command palette / quick open]</div>
  </section>

  <!-- Installation -->
  <section id="install" class="install">
    <h2>Up and running in 30 seconds</h2>
    <div class="install-steps">
      <div class="step">
        <span class="step-num">1</span>
        <div class="code-block">
          <code>git clone https://github.com/barelias/quipu.git && cd quipu/quipu_simple</code>
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
        </div>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <div class="code-block">
          <code>npm install</code>
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
        </div>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <div class="code-block">
          <code>npm run dev</code>
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
        </div>
      </div>
    </div>
    <p class="install-note">For browser mode, also run <code>cd server && go run main.go</code> in a separate terminal.</p>
  </section>

  <!-- Docs -->
  <section id="docs" class="docs">
    <h2>Documentation</h2>
    <div class="docs-grid">
      <div class="doc-card">
        <h3>Getting Started</h3>
        <p>Installation, first run, and basic concepts.</p>
      </div>
      <div class="doc-card">
        <h3>Editor Guide</h3>
        <p>Rich text, markdown, comments, frontmatter, and keyboard shortcuts.</p>
      </div>
      <div class="doc-card">
        <h3>FRAME Context</h3>
        <p>Per-file AI metadata, annotations, and Claude Code integration.</p>
      </div>
      <div class="doc-card">
        <h3>Architecture</h3>
        <p>Dual runtime, service adapters, and extending Quipu.</p>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer>
    <div class="footer-content">
      <div class="logo-placeholder">[LOGO]</div>
      <p>Open source. MIT License.</p>
      <a href="https://github.com/barelias/quipu">GitHub</a>
    </div>
  </footer>

  <script src="script.js"></script>
</body>
</html>
```

### landing/styles.css (key styles)

```css
:root {
  --accent: #c4835a;
  --accent-hover: #b57348;
  --bg-dark: #1a1a1a;
  --bg-surface: #242424;
  --text-primary: #e8e8e0;
  --text-secondary: #a0a0a0;
  --border: #383838;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', sans-serif;
  background: var(--bg-dark);
  color: var(--text-primary);
  line-height: 1.6;
}

h1, h2, h3 { font-family: 'Clash Grotesk', sans-serif; }

.hero { padding: 2rem 5vw 4rem; text-align: center; }
.hero h1 { font-size: clamp(2.5rem, 6vw, 4.5rem); margin-bottom: 1rem; }
.hero-subtitle { font-size: 1.25rem; color: var(--text-secondary); max-width: 600px; margin: 0 auto 2rem; }

.btn-primary {
  background: var(--accent);
  color: white;
  padding: 0.75rem 2rem;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 600;
  transition: background 0.2s;
}
.btn-primary:hover { background: var(--accent-hover); }

.screenshot-placeholder {
  background: var(--bg-surface);
  border: 2px dashed var(--border);
  border-radius: 12px;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--text-secondary);
  font-style: italic;
  margin: 2rem auto;
  max-width: 900px;
}

.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem; padding: 2rem 5vw; }
.feature-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem; }

.code-block {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  font-family: 'JetBrains Mono', monospace;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
```

### landing/script.js (copy button)

```javascript
function copyCode(btn) {
  const code = btn.previousElementSibling.textContent;
  navigator.clipboard.writeText(code);
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
}
```

## Sources

- App design tokens: `src/styles/theme.css` (for matching accent colors)
- Font choices: `src/styles/theme.css:47-51`
- Project architecture: `CLAUDE.md`
