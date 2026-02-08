# Contributing to Tide Commander

Thanks for contributing.

## Before You Start

- Use Node.js 18+ or Bun.
- Make sure `claude` is available in your `PATH` for local agent/runtime testing.
- Install dependencies:

```bash
bun install
```

## Local Development

Start both client and server:

```bash
bun run dev
```

Useful commands:

```bash
# Lint
bun run lint

# Type checks
bun run lint:types

# Tests
bun run test

# Build
bun run build
```

## Project Structure

- `src/packages/client/`: React + Vite frontend (3D, 2D, dashboard, commander UI)
- `src/packages/server/`: Express + WebSocket backend and runtime orchestration
- `docs/`: Feature and usage documentation
- `tests/`: Integration tests

## Contribution Workflow

1. Create a branch from `main`.
2. Keep changes scoped to a single feature or fix.
3. Run lint, type checks, and relevant tests before opening a PR.
4. Update docs when behavior or UX changes.
5. Open a pull request with a clear summary and testing notes.

## Pull Request Guidelines

Please include:

- What changed
- Why it changed
- How it was tested
- Any screenshots or short recordings for UI changes

If your change touches agent runtime behavior, include example output/events when possible.

## Coding Expectations

- Prefer small, focused changes over broad refactors.
- Follow existing naming and file organization patterns.
- Keep logs actionable and avoid noisy debug output.
- Do not commit secrets, tokens, or local environment files.

## Documentation

If your change affects features, update the relevant file in `docs/` and cross-link related docs where useful.

