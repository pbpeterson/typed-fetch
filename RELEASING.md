# Releasing

This project ships to npm as [`@pbpeterson/typed-fetch`](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
using **manual, disciplined releases** — no changesets, no version-bump bots.
This document is the entire process. Follow it exactly, every time.

## Why this document exists

Publishing on this project is **tag-driven**: pushing a `v*` git tag is what
triggers `.github/workflows/release.yml` and puts a new version on npm. npm's
current `latest` is `0.8.1`; `1.0.0` is the first stable release. Versions
`0.4.0` through `0.7.2` were published without corresponding Git tags, which
must not happen again. Every publication must be reconstructable from an
immutable tag, reviewed commit, lockfile, workflow run, and provenance
attestation.

## How publishing actually works

- `.github/workflows/release.yml` triggers on `push: tags: ["v*"]` — nothing
  else publishes.
- Before dependencies are installed, `scripts/validate-release.mjs` fails the
  workflow unless all of these are true:
  - package name, public repository, public access, and provenance metadata are
    the expected immutable publishing identity;
  - the ref is strict SemVer and exactly `v<package.json version>`;
  - the tag points to `HEAD`, which is also the current `origin/main` tip;
  - `CHANGELOG.md` has a dated section for the version;
  - the `[Unreleased]` changelog section is empty.
- The workflow uses a GitHub-hosted runner, Node `22.23.1`, pnpm from the exact
  `packageManager` field, and npm `11.18.0`. Release dependencies are not
  restored from a package-manager cache. It installs the reviewed lockfile with
  `pnpm install --frozen-lockfile`, then runs:
  1. `pnpm lint`
  2. `pnpm format:check`
  3. `pnpm typecheck`
  4. `pnpm build`
  5. `pnpm test`
  6. `pnpm check-docs`
  7. `pnpm verify-pack`
  8. `pnpm check-consumer`
  9. `pnpm audit:prod`
  10. `pnpm audit`
- `verify-pack` asserts every CJS, ESM, and declaration entry in the tarball;
  `check-consumer` installs that tarball into a scratch project and exercises
  both entry points, both module formats, and consumer typechecking.
- Only after every gate passes does the workflow run
  `npm publish --provenance --access public --tag <dist-tag>`. A prerelease such
  as `1.1.0-rc.1` uses `next`; a stable version uses `latest`.
- The build is done by the **explicit `pnpm build` step above**, not by the
  `prepublishOnly` lifecycle hook. `"prepublishOnly": "npm run build"` still
  exists in `package.json`, but it is now a **redundant safety net**, not the
  mechanism: if it were ever renamed, removed, or stopped firing under OIDC
  trusted publishing, the explicit step still guarantees `dist/` is built from
  the tagged commit. Do not rely on `prepublishOnly` to build the release.
- `--provenance --access public` attaches npm provenance (a verifiable link
  from the published tarball back to this workflow run and commit) and
  ensures the scoped package publishes as public, not private.

### Required npm setup before `v1.0.0`

The package already exists on npm, so `1.0.0` can and must publish directly
through trusted publishing—no bootstrap token is needed:

1. Enable 2FA on the npm maintainer account.
2. On npmjs.com, open `@pbpeterson/typed-fetch` → Settings → Trusted Publisher.
3. Authorize GitHub Actions for repository `pbpeterson/typed-fetch`, workflow
   `release.yml`, and the `npm publish` action. Every field is case-sensitive.
4. Confirm this repository has no `NPM_TOKEN` Actions secret and revoke any old
   npm automation token for this package.
5. Set package publishing access to require 2FA and disallow traditional
   tokens. Trusted publishing continues to work through short-lived OIDC
   credentials.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the
registry-side setup and requirements. npm does not test the configuration when
it is saved, so verify the repository and workflow filename carefully before
pushing the release tag.

## Release checklist

Run every step, in order, for every release:

1. **Prepare a release branch and PR.** Decide the version with the
   [SemVer policy](#semver-policy), edit `package.json` directly, move all
   pending changelog entries from `[Unreleased]` into
   `## [X.Y.Z] - YYYY-MM-DD`, and leave `[Unreleased]` empty. For the first
   stable publication, the version is already `1.0.0`.
2. **Run the exact gates locally, in order:**
   ```bash
   pnpm lint
   pnpm format:check
   pnpm typecheck
   pnpm build
   pnpm test
   pnpm check-docs
   pnpm verify-pack
   pnpm check-consumer
   pnpm audit:prod
   pnpm audit
   ```
   `build` must precede every artifact gate because the tests, docs checker,
   tarball validator, and scratch consumer inspect `dist/`.
3. **Commit the release candidate and open a PR:**
   ```bash
   git commit -m "chore: release X.Y.Z"
   ```
   Required checks must pass before merge; do not tag the PR branch.
4. **Merge the PR and update the local `main`.** Confirm the commit you intend
   to tag is the remote tip:
   ```bash
   git fetch origin main
   git switch main
   git pull --ff-only origin main
   test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
   ```
5. **Before `v1.0.0` only:** complete
   [Required npm setup](#required-npm-setup-before-v100). Do this before the
   irreversible tag push.
6. **Create an annotated tag on that exact commit and push only that tag:**
   ```bash
   git tag -a vX.Y.Z -m "@pbpeterson/typed-fetch X.Y.Z"
   git push origin vX.Y.Z
   ```
   Never use `git push --tags`; it can publish unrelated local tags. Never move
   or reuse a tag that has been pushed.
7. **Watch the Release workflow to completion.** If it fails, do not publish
   manually and do not move the tag. Fix the issue through a new reviewed
   release commit and version.
8. **Verify the publication:** check the
   [npm package page](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
   shows the correct version, `latest`/`next` dist-tag, provenance badge, source
   commit, and workflow. Install the exact version in a clean consumer once.
   `pnpm verify-pack` is the authoritative dry-run manifest check; the release
   workflow executes it again immediately before publication.

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
   previously-unknown code path: anyone doing `instanceof UnknownHttpError`
   for that specific status now gets a different class.
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
