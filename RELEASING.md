# Releasing

This project ships to npm as [`@pbpeterson/typed-fetch`](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
using **manual, disciplined releases** — no changesets, no version-bump bots.
This document is the entire process. Follow it exactly, every time.

## Why this document exists

Publishing on this project is **tag-driven**: pushing a `v*` git tag is what
triggers `.github/workflows/release.yml` and puts a new version on npm. npm's
current `latest` is `1.0.0`, first published on 2026-07-17 from tag `v1.0.0`
through the trusted-publishing workflow. Versions
`0.4.0` through `0.7.2` were published without corresponding Git tags, which
must not happen again. Every publication must be reconstructable from an
immutable tag, reviewed commit, lockfile, workflow run, and provenance
attestation.

## How publishing actually works

- `.github/workflows/release.yml` triggers on `push: tags: ["v*"]` — nothing
  else publishes.
- The tag workflow first calls `.github/workflows/ci.yml` as a reusable
  workflow. Its Node 20/22/24, security, Bun, and Deno jobs must all pass before
  the publish job can start. The Deno job installs the packed package by its
  bare npm name and typechecks its public `.d.mts` declarations in addition to
  the direct-dist runtime smoke.
- After the shared checks pass and before publish dependencies are installed,
  `scripts/validate-release.mjs` fails the publish job unless all of these are
  true:
  - package name, public repository, public access, and provenance metadata are
    the expected immutable publishing identity;
  - the ref is strict SemVer and exactly `v<package.json version>`;
  - the tag points to `HEAD`, which is also the current `origin/main` tip;
  - `CHANGELOG.md` has a section with a calendar-valid date for the version;
  - the `[Unreleased]` changelog section is empty.
- The publish job uses a GitHub-hosted runner, Node `22.23.1`, pnpm from the
  exact `packageManager` field, and npm `11.18.0`. Release dependencies are not
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
- Only the publish job receives `id-token: write`, and only after the reusable
  CI and every repeated publish gate pass does it run
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

### Trusted-publisher configuration

`1.0.0` proved this configuration by publishing successfully through trusted
publishing. Keep these registry and repository settings in place:

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
registry-side setup and requirements. Recheck the repository and workflow
filename before pushing any release tag.

## Release checklist

Run every step, in order, for every release:

1. **Prepare a release branch and PR.** Decide the version with the
   [SemVer policy](#semver-policy), edit `package.json` directly, move all
   pending changelog entries from `[Unreleased]` into
   `## [X.Y.Z] - YYYY-MM-DD`, and leave `[Unreleased]` empty. For the first
   stable publication, use a stable version and the `latest` dist-tag.
2. **Run the exact publish-job gates locally, in order:**
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
   For local parity with the Deno CI job, also run
   `pnpm check-deno-consumer` after `pnpm build` when Deno is installed. The
   tag workflow enforces this gate regardless of local runtime availability.
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
5. **Confirm trusted publishing:** recheck the
   [trusted-publisher configuration](#trusted-publisher-configuration) before
   the irreversible tag push.
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

1. **Registering a new HTTP error class in `ClientErrors`/`ServerErrors` is a
   `major`.** It widens the union returned by `typedFetch` and necessarily
   moves that status from `UnknownHttpError` to a different runtime class.
   Consumers should still keep a `default:` branch in
   `switch (error.status)` for forward compatibility and mixed package
   versions.
2. **`error.message` text is NOT part of the semver contract.** Message
   wording may change in any release, including patches. Assert on
   `.status` and `.name` in tests and application code, never on
   `.message` content.
3. **`statusText` is the library's canonical protocol label for the status code
   — not the value the server sent on the wire — and IS part of the contract.**
   It is literal-typed per class (e.g. `NotFoundError.statusText` is always
   `"Not Found"`) and normally follows the current IANA registry. Intentional
   historical exceptions: 418 keeps `"I'm a teapot"`; 510 keeps
   `"Not Extended"` without the registry's `(OBSOLETED)` lifecycle annotation.
   The server's actual wire reason phrase, when present, is folded into
   `error.message` instead.
4. **Removing or renaming a named export, or changing a class's `status` or
   `statusText` literal, is a `major`.**
5. **Every publish gets a `v<version>` git tag**, and the tag push is what
   triggers the release workflow. No untagged npm versions, ever (see
   [why this document exists](#why-this-document-exists)).
6. **Node engines stay `>=20`.** Dropping support for a Node major version is
   a `major` release.
