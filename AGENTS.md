# Repository Guidelines

## Project Structure & Module Organization
This repository is a single-file static web app. All UI, styling, and game logic currently live in `index.html`.

- Markup defines the login and game screens.
- CSS is embedded in the `<style>` block and uses root variables for theme tokens.
- JavaScript is embedded in the `<script>` block and manages round state, rendering, audio, and `localStorage` persistence.

If the app grows, split it into `src/`, `styles/`, and `assets/` rather than expanding `index.html` further.

## Build, Test, and Development Commands
No build system is configured. Use a static server for local development instead of opening the file directly.

- `python3 -m http.server 8000` runs the app locally at `http://localhost:8000`
- `open http://localhost:8000` launches the browser on macOS
- `npx serve .` is an acceptable alternative if Node is already installed

There are no package scripts, bundlers, or CI tasks in this repository today.

## Coding Style & Naming Conventions
Use 2-space indentation in HTML, CSS, and JavaScript. Keep the existing structure readable: constants first, state second, render/update functions next, event wiring last.

- Use `camelCase` for functions and mutable state, for example `renderHistory` or `currentBet`
- Use `UPPER_SNAKE_CASE` for configuration constants such as `BET_SEC`
- Prefer descriptive IDs and class names like `numbersGrid`, `phaseBanner`, and `resultOverlay`

Preserve the CSS variable system in `:root` and avoid inline styles except for small dynamic values already used by the app.

## Testing Guidelines
No automated tests are present. Validate changes manually in a browser.

- Verify login flow, betting, reveal cycle, payout math, and `localStorage` restore
- Re-test responsive layout below `800px`
- Check console output for runtime errors before submitting changes

If logic becomes more complex, extract script code into modules and add browser-based unit tests with Vitest or Playwright.

## Commit & Pull Request Guidelines
Git history is not available in this workspace, so no repository-specific commit convention can be inferred. Use short imperative commits such as `feat: adjust payout messaging` or `fix: prevent betting after close`.

PRs should include:

- A concise summary of behavior changes
- Manual test steps and results
- Screenshots or screen recordings for UI updates
- Linked issue or task reference when applicable
