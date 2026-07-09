# Releasing

This project ships to npm as [`@pbpeterson/typed-fetch`](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
using **manual, disciplined releases** — no changesets, no version-bump bots.
This document is the entire process. Follow it exactly, every time.

## Why this document exists

Publishing on this project is **tag-driven**: pushing a `v*` git tag is what
triggers `.github/workflows/release.yml` and puts a new version on npm.
Historically, versions `0.4.0` through `0.7.2` were published to npm **without**
a corresponding git tag — there is no way to reconstruct what commit those
releases were built from. That must never happen again. Every publish gets a
tag. No exceptions.

## How publishing actually works

- `.github/workflows/release.yml` triggers on `push: tags: ["v*"]` — nothing
  else publishes.
- It runs on `ubuntu-latest`, checks out the repo, installs pnpm/Node 22,
  upgrades to the latest npm (trusted publishing needs npm >= 11.5), then runs
  `pnpm install --frozen-lockfile`. The steps that follow run **in this exact
  order**:
  1. `pnpm lint`
  2. `pnpm typecheck`
  3. `pnpm build` — the workflow builds `dist/` **explicitly**, before test and
     publish (see the note on `prepublishOnly` below).
  4. `pnpm test` — runs after the build, so `dist/` exists and the
     API-surface snapshot test (which imports `dist/index.mjs` and is skipped
     when `dist/` is absent) is actually exercised, not silently skipped.
  5. `pnpm verify-pack` — a release gate that runs `npm pack --dry-run` and
     asserts the tarball's **file manifest** (see
     [scripts/verify-pack.mjs](./scripts/verify-pack.mjs)). It checks that the
     required `dist/` entry points and `LICENSE`/`README.md` are present and
     that nothing from `src/`, `scripts/`, tests, or config leaks in. It does
     **not** verify file contents — the API-surface snapshot test (step 4)
     covers that, and runs first.
  6. `npm publish --provenance --access public --tag <dist-tag>` — the dist-tag
     is derived from the git ref: a prerelease tag (one containing `-`, e.g.
     `v1.0.0-rc.1`) publishes under `next`; a normal tag publishes under
     `latest`.
- Publishing uses **npm trusted publishing (OIDC)** — the workflow has
  `id-token: write` permission and authenticates to npm via GitHub Actions'
  OIDC identity. There is **no `NPM_TOKEN` secret** to rotate or leak. Trusted
  publishing is configured once on npmjs.com (package Settings → Trusted
  Publisher → GitHub Actions → this repo → `release.yml`).
- The build is done by the **explicit `pnpm build` step above**, not by the
  `prepublishOnly` lifecycle hook. `"prepublishOnly": "npm run build"` still
  exists in `package.json`, but it is now a **redundant safety net**, not the
  mechanism: if it were ever renamed, removed, or stopped firing under OIDC
  trusted publishing, the explicit step still guarantees `dist/` is built from
  the tagged commit. Do not rely on `prepublishOnly` to build the release.
- `--provenance --access public` attaches npm provenance (a verifiable link
  from the published tarball back to this workflow run and commit) and
  ensures the scoped package publishes as public, not private.

Because the workflow itself runs `pnpm lint` / `pnpm typecheck` / `pnpm build` /
`pnpm test` / `pnpm verify-pack` before publishing, a red gate on the tagged
commit will fail the release. **Note:** the release workflow does **not** run
`format:check` — only `ci.yml` (on PRs and pushes) does. So the release gate
will not catch a formatting violation on the tagged commit; run `format:check`
locally (see below) to keep formatting honest. And don't rely on CI to catch
the other gates for you either — run them locally first so a failed release
doesn't leave you with a pushed tag and no published package.

## Release checklist

Run every step, in order, for every release:

1. **Make sure `main` is green.** Run the full gate locally — this is a
   superset of what the release workflow runs (it adds `format:check`, which
   the release workflow does not run; only `ci.yml` does):
   ```bash
   pnpm lint && pnpm format:check && pnpm typecheck && pnpm build && pnpm test && pnpm verify-pack
   ```
   Run `build` before `test` and `verify-pack`, exactly as the release
   workflow does: the API-surface snapshot test and `verify-pack` both inspect
   `dist/`, so it must exist first.
2. **Decide the version bump** using the [semver policy](#semver-policy)
   below.
3. **Bump the version in `package.json`.** Edit the `"version"` field
   directly (no `npm version` / `pnpm version` commands that also tag — this
   process tags manually in step 5 after the changelog is committed).
4. **Write the CHANGELOG entry.** Add a new section to `CHANGELOG.md` above
   the previous entry, following the existing format (`## <version>
(<date>)`, with `### Breaking` / `### Added` / `### Changed` / `### Fixed`
   subsections as needed). Every publish gets an entry — this is the
   changelog of record since there are no changeset files to generate one
   from.
5. **Commit the bump and the changelog together:**
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: release v<x.y.z>"
   ```
6. **Tag the release commit:**
   ```bash
   git tag v<x.y.z>
   ```
7. **Push the commit, then push the tag:**
   ```bash
   git push
   git push --tags
   ```
   Pushing the tag is what triggers `release.yml` and publishes to npm.
8. **Verify the publish**: check the
   [npm package page](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
   shows the new version with a provenance badge, and that the corresponding
   GitHub Actions run succeeded.

There is no dry-run publish step in CI, but you can sanity-check the tarball
manifest locally at any time with `npm pack --dry-run` (or `pnpm verify-pack`,
which asserts that manifest and is the same gate the release workflow runs).

## Semver policy

This policy is binding for every release. It is also written into
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and the README. When in doubt, follow
the rule, not intuition.

1. **Adding a new HTTP error class to `ClientErrors`/`ServerErrors` is a
   `minor`.** It widens the union of errors `typedFetch` can return, but the
   underlying value was always reachable at runtime — it just used to come
   back as `UnknownHttpError` instead of a dedicated class. Nothing that used
   to compile stops compiling.
   **Hard rule for consumers:** any exhaustive `switch (error.status)` over
   known error classes MUST keep a `default:` branch. A new dedicated error
   class can appear in a minor release, and code without a `default` will
   silently stop being exhaustive at compile time (not at runtime — it will
   just fail to narrow the new class).
2. **Moving a status code from `UnknownHttpError` to a dedicated class is a
   `major`.** Unlike (1), this changes the runtime type of an existing,
   already-dedicated code path: anyone doing `instanceof UnknownHttpError`
   for that specific code now gets a different class.
3. **`error.message` text is NOT part of the semver contract.** Message
   wording may change in any release, including patches. Assert on
   `.status` and `.name` in tests and application code, never on
   `.message` content.
4. **`statusText` is the canonical IANA reason phrase for the status code —
   not the value the server sent on the wire — and IS part of the contract.**
   It is literal-typed per class (e.g. `NotFoundError.statusText` is always
   `"Not Found"`). The server's actual wire reason phrase, when present, is
   folded into `error.message` instead.
5. **Removing or renaming a named export, or changing a class's `status` or
   `statusText` literal, is a `major`.**
6. **Every publish gets a `v<version>` git tag**, and the tag push is what
   triggers the release workflow. No untagged npm versions, ever (see
   [why this document exists](#why-this-document-exists)).
7. **Node engines stay `>=20`.** Dropping support for a Node major version is
   a `major` release.
