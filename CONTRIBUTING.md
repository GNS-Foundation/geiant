# Contributing

## Running tests

Run tests **from inside the package**, via its own `test` script:

```bash
cd packages/<pkg>
pnpm test          # or: npm test  — both use the package's local vitest
```

To run a single file:

```bash
cd packages/<pkg>
pnpm test -- test/some.test.ts
```

### Do NOT use `npx vitest`

`npx vitest` resolves whatever `vitest` it finds first on the path — often a
**different, hoisted version** than the one the package declares. Running the wrong
major version against a package fails **silently**: tests are not collected
(`0 test` / `Failed Suites`) and the process hangs, with **no error message**. This
cost hours to diagnose once (2026-09).

`pnpm test` / `npm test` always use the package's own `node_modules/.bin/vitest`, which
is the correct version. Use them.

As of 2026-09 all packages are aligned to `vitest ^2.1.0`, so the hazard is currently
dormant — but the rule stands, because a future package added on a different vitest
version would reintroduce it, and `pnpm test` is immune by construction.

## Toolchain

The repo pins its toolchain in the root `package.json`:

- **Node:** `engines.node` (see `package.json`).
- **pnpm:** `packageManager` (see `package.json`) — run it via Corepack so you match the
  pinned version without changing your global install:

  ```bash
  corepack pnpm install     # uses the pinned pnpm, cache-only
  ```

  Using a **different** pnpm major than the one that built `node_modules` will prompt to
  wipe and reinstall `node_modules` from scratch — avoid that by matching the pinned
  version.
