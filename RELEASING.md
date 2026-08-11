# Releasing

This project ships to npm as [`@pbpeterson/typed-fetch`](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
using **manual, disciplined releases** — no changesets, no version-bump bots.
This document is the entire process. Follow it exactly, every time.

## Why this document exists

Publishing on this project is **tag-driven**: pushing a `v*` git tag is what
triggers `.github/workflows/release.yml` and puts a new version on npm. The
first stable release, `1.0.0`, was published on 2026-07-17 from tag `v1.0.0`
through the trusted-publishing workflow. Versions
`0.4.0` through `0.7.2` were published without corresponding Git tags, which
must not happen again. Every publication must be reconstructable from an
immutable tag, reviewed commit, lockfile, workflow run, and provenance
attestation.

## How publishing actually works

- `.github/workflows/release.yml` triggers on `push: tags: ["v*"]` — nothing
  else publishes.
- The tag workflow first calls `.github/workflows/ci.yml` as a reusable
  workflow. Its Node 20/22/24, security, Bun, Deno, and Node-floor (20.13.0) jobs
  must all pass before the package job can start.

  The Deno job installs the packed package by its bare npm name. It typechecks
  the public `.d.mts` declarations and runs the direct-dist smoke.

- After the shared checks pass and before package dependencies are installed,
  `scripts/validate-release.mjs` fails the package job unless all of these are
  true:
  - package name, public repository, public access, and provenance metadata are
    the expected immutable publishing identity;
  - the ref is strict SemVer and exactly `v<package.json version>`;
  - the tag points to `HEAD`, which is also the current `origin/main` tip;
  - `CHANGELOG.md` has a section with a calendar-valid date for the version;
  - the `[Unreleased]` changelog section is empty;
  - the changelog footer defines a `[X.Y.Z]:` compare link that ends at
    `vX.Y.Z`;
  - the `[Unreleased]:` link compares from `vX.Y.Z` to `HEAD`.

  The gate does not check the base of the version range. It cannot see the
  previous version.

- The package job uses a GitHub-hosted runner, Node `22.23.1`, pnpm from the
  exact `packageManager` field, and npm `11.18.0`. Release dependencies are not
  restored from a package-manager cache. It installs the reviewed lockfile with
  `pnpm install --frozen-lockfile`, then runs:
  1. `pnpm lint`
  2. `pnpm format:check`
  3. `pnpm check-doc-style`
  4. `pnpm typecheck`
  5. `pnpm build`
  6. `pnpm test`
  7. `pnpm coverage`
  8. `pnpm check-docs`
  9. `pnpm verify-pack`
  10. `pnpm check-consumer`
  11. `pnpm audit:prod`
  12. `pnpm run audit:ci`
- After the gates pass, the package job creates the package tarball. It also
  downloads the pinned npm `11.18.0` CLI as a tarball. A SHA-256 manifest covers
  both files before they enter one immutable workflow artifact.
- `verify-pack` asserts every CJS, ESM, and declaration entry in the tarball;
  `check-consumer` installs that tarball into a scratch project and exercises
  both entry points, both module formats, and consumer typechecking.
- The tarball ships `dist`, `errors/package.json`, and three files that npm adds.
  Those files are `package.json`, `README.md`, and `LICENSE`.

  `CHANGELOG.md` is deliberately absent. It is the largest repository file and
  grows with every release. Consumers can reach it from npm, the repository, or
  the README upgrade link. Shipping it would increase every installation for a
  document not used from `node_modules`.

  `scripts/verify-pack.mjs` locks the file count. Changing this decision
  therefore requires a deliberate count change.

- Only the publish job receives `id-token: write`. It has no checkout and
  installs no dependency. It downloads the prepared artifact, verifies its
  SHA-256 manifest, and extracts the pinned npm CLI. It then publishes the
  prepared package tarball with lifecycle scripts disabled.

  The command is `npm publish <tarball> --ignore-scripts --provenance --access
public --tag <dist-tag>`. A prerelease such as `1.1.0-rc.1` uses `next`; a
  stable version uses `latest`.

  The tarball argument must be an ABSOLUTE path, and the workflow resolves it
  with `realpath`. npm reads that argument as a package specifier, not as a
  path. A specifier is a file only when it starts with `.`, `/`, `~/`, or a
  drive letter. `package/<name>.tgz` starts with none of them, so npm reads it
  as the GitHub shorthand `owner/repo` and runs `git ls-remote` against
  `github.com`. The publish job has no checkout and no git credentials, so the
  release fails there, after every gate has passed.

- The build is done by the **explicit `pnpm build` step above**, not by the
  `prepublishOnly` lifecycle hook. The hook **verifies** the artifact instead of
  producing it: `"prepublishOnly": "node scripts/verify-pack.mjs"`.

  It used to run `npm run build`. That protected against a missing `dist/`.
  However, npm then ran tsup with `clean: true` after the artifact gates.

  The uploaded tarball therefore contained a rebuild. It did not contain the
  directory inspected by `verify-pack` and `check-consumer`. tsup produced the
  same bytes in practice, but the gates guarded a different build.

  Verifying keeps the net and drops the rebuild. The hook rejects a missing,
  incomplete, or leaking `dist/` instead of regenerating it.

  CAUTION: The hook does NOT run in the release workflow. npm runs
  `prepublishOnly` for `npm publish` only. `npm pack` does not run it, and the
  publish job passes `--ignore-scripts`. The hook therefore protects a MANUAL
  `npm publish` from a workstation, and nothing else.

  The workflow protects itself with two explicit steps instead. The
  `pnpm verify-pack` gate checks what a pack would produce, and the staging step
  runs `node scripts/verify-pack.mjs <tarball>` on the STAGED FILE — the exact
  tarball it then hashes, uploads, and publishes. Those two steps are the net.
  Do not treat the lifecycle hook as one.

  The publish job uses `--ignore-scripts`, so it cannot execute repository
  lifecycle code with OIDC. Do not put a build back in this hook.

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

   Then update the reference definitions at the FOOTER of `CHANGELOG.md`:

   ```
   [Unreleased]: https://github.com/pbpeterson/typed-fetch/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/pbpeterson/typed-fetch/compare/vPREVIOUS...vX.Y.Z
   ```

   A missing link prevents reconstruction from an immutable tag. A link to an
   unpushed tag has the same effect. `scripts/validate-release.mjs` rejects both.
   WARNING: That gate needs a tag ref, so it can run only after the irreversible
   push in step 6. Read the footer against this step before you tag.

2. **Run the exact package-job gates locally, in order:**
   ```bash
   pnpm lint
   pnpm format:check
   pnpm check-doc-style
   pnpm typecheck
   pnpm build
   pnpm test
   pnpm coverage
   pnpm check-docs
   pnpm verify-pack
   pnpm check-consumer
   pnpm audit:prod
   pnpm run audit:ci
   ```
   `build` must precede every artifact gate because the tests, docs checker,
   tarball validator, and scratch consumer inspect `dist/`.
   For local parity with the Deno CI job, run these commands after the build:
   ```bash
   pnpm check-deno-consumer
   pnpm smoke:deno
   ```
   The consumer gate requires Deno 2. It resolves the unpublished local tarball
   from `node_modules`. The tag workflow enforces all three validations.
   For parity with the `node-min-smoke` job, also run
   `pnpm smoke:node-min` — but ONLY with a real Node **20.13.0** binary. The
   script warns instead of failing on a newer runtime, so running it on your
   default Node proves nothing about the `engines` floor.
   For parity with the `bun-smoke` job, also run `pnpm smoke:bun`, which needs a
   Bun binary.
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
   workflow executes it before staging the immutable publication artifact.
9. **Publish the security advisory.** If the release fixes no reported
   vulnerability, skip this step. `SECURITY.md` offers a reporter two channels,
   and only one of them creates a draft.
   [GitHub Security Advisories](https://github.com/pbpeterson/typed-fetch/security/advisories)
   creates a private draft, so a report through it already has one. A report by
   email creates none: open the draft yourself from the same page before you
   continue. Then add the fixed version to the draft. Credit the reporter.
   Request a CVE from the same page.
   Publish the draft after step 8 confirms the version is live on npm. A
   shipped fix with a private advisory leaves no public record that a consumer
   scanner can read.

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

   **`UnknownHttpError` is the one exception, and it is not a promise this
   package can make.** A status with no dedicated class has no canonical label,
   so that class reports the reason phrase the origin sent, filtered and
   bounded. The origin chooses the value, so no release can guarantee it.

4. **Removing or renaming a named export, or changing a class's `status` or
   `statusText` literal, is a `major`.**
5. **Every publish gets a `v<version>` git tag**, and the tag push is what
   triggers the release workflow. No untagged npm versions, ever (see
   [why this document exists](#why-this-document-exists)).
6. **Node engines stay `>=20.13.0`.** Raising the minimum Node.js version is a
   `major` release.
7. **A `Symbol.for` key that crosses package copies is a contract between
   package versions. Never change the meaning of an existing key. A new
   question gets a new key.** `Symbol.for` resolves to one symbol for the whole
   process, so every version a consumer has installed answers under the same
   keys. Two of them carry behavior rather than a marker:
   `Symbol.for("@pbpeterson/typed-fetch.ownsResponse")`, which every copy stamps
   on `BaseHttpError.prototype` with the shape
   `(candidate: Response) => boolean`, and the inspect hook. The rule binds the
   key string, the argument, and the return value together. Renaming the key,
   changing what the argument means, or returning anything other than a boolean
   are all the same break.

   `clone()` asks whether the returned error took the cloned body branch. It
   treats "cannot answer" as "not confirmed".

   A violation can reject a correct cross-copy call. A changed meaning can also
   orphan the branch. Then `cancel()` never settles, and a connection stays open.
   Only a consumer with two copies is affected, which is why no consumer-facing
   type or export changes and no other rule in this list catches it.

   Two gates hold the rule, and `scripts/validate-release.mjs` deliberately does
   not. `brand.spec.ts` pins the literal key string and the frozen property
   descriptor, so a rename is a failed test rather than a review comment.
   `pnpm check-consumer` installs the packed tarball. It performs a cross-copy
   `clone()` across both module formats. A changed key meaning fails there as
   behavior, not as a text match.
   `validate-release` decides publishing identity, tag alignment, and the
   changelog from release metadata alone. It never reads `src/` or `dist/`, and
   it cannot see the previous version, so it cannot decide a question that is
   about a diff against a released one. Adding a text match for the key would
   make it a second source of truth for something two gates already prove.

8. **A change in what `toJSON().url` emits is a `minor` at least.** That field
   is `redactUrl(error.url)`, and it is the record a structured logger writes.
   A consumer builds a correlation key, an alert rule, and a log query from it.
   A patch that moves the string therefore breaks a consumer that changed no
   code. Rule 2 frees the `error.message` TEXT, and it does not free this
   field. A security fix that moves the redacted URL ships as a `minor` or
   higher. `CHANGELOG.md` states each direction the output moved, and names one
   ordinary input per direction.

   The rule binds the redacted OUTPUT, never the redactor's internal shape.
   `redactUrl` is not exported, so no consumer can call it. A refactor that
   leaves every emitted string identical is a `patch`.
