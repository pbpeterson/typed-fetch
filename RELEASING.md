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
  workflow. Its Node 20/22/24, security, Bun, Deno, and Node-floor (20.0.0) jobs
  must all pass before the publish job can start. The Deno job installs the packed package by its
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
  - the `[Unreleased]` changelog section is empty;
  - the changelog footer defines a `[X.Y.Z]:` compare link that ends at
    `vX.Y.Z`;
  - the `[Unreleased]:` link compares from `vX.Y.Z` to `HEAD`.

  The gate does not check the base of the version range. It cannot see the
  previous version.

- The publish job uses a GitHub-hosted runner, Node `22.23.1`, pnpm from the
  exact `packageManager` field, and npm `11.18.0`. Release dependencies are not
  restored from a package-manager cache. It installs the reviewed lockfile with
  `pnpm install --frozen-lockfile`, then runs:
  1. `pnpm lint`
  2. `pnpm format:check`
  3. `pnpm check-doc-style`
  4. `pnpm typecheck`
  5. `pnpm build`
  6. `pnpm test`
  7. `pnpm check-docs`
  8. `pnpm verify-pack`
  9. `pnpm check-consumer`
  10. `pnpm audit:prod`
  11. `pnpm audit`
- `verify-pack` asserts every CJS, ESM, and declaration entry in the tarball;
  `check-consumer` installs that tarball into a scratch project and exercises
  both entry points, both module formats, and consumer typechecking.
- The tarball ships `dist`, `errors/package.json`, and the three files npm adds
  on its own: `package.json`, `README.md`, and `LICENSE`. `CHANGELOG.md` is
  deliberately **not** among them. It is the largest file in the repository, it
  grows with every release, and a consumer reaches it from the npm page, from
  the repository, and from the "Upgrade from 1.x" link in `README.md`. Shipping
  it would add its full size to every install to serve a document nobody reads
  out of `node_modules`. `scripts/verify-pack.mjs` locks the file count, so this
  decision is enforced rather than assumed: changing it means changing the count
  there too.
- Only the publish job receives `id-token: write`, and only after the reusable
  CI and every repeated publish gate pass does it run
  `npm publish --provenance --access public --tag <dist-tag>`. A prerelease such
  as `1.1.0-rc.1` uses `next`; a stable version uses `latest`.
- The build is done by the **explicit `pnpm build` step above**, not by the
  `prepublishOnly` lifecycle hook. The hook **verifies** the artifact instead of
  producing it: `"prepublishOnly": "node scripts/verify-pack.mjs"`.

  It used to run `npm run build`. That made the hook a net for a missing `dist/`,
  but it also meant `npm publish` fired tsup with `clean: true` **after**
  `verify-pack` and `check-consumer` had already inspected the directory. The
  tarball npm uploaded was therefore a rebuild of the one the gates passed, not
  that one. tsup is deterministic, so the bytes matched in practice — but the
  gate no longer guarded the artifact it was pointed at.

  Verifying keeps the net and drops the rebuild: a `dist/` that is missing,
  incomplete, or carrying a source leak fails the publish instead of being
  silently regenerated. Do not put a build back in this hook.

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

2. **Run the exact publish-job gates locally, in order:**
   ```bash
   pnpm lint
   pnpm format:check
   pnpm check-doc-style
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
   `pnpm check-deno-consumer` after `pnpm build` when Deno 2 is installed. This
   gate needs Deno 2 to resolve the unpublished local tarball from
   `node_modules`. The tag workflow enforces it regardless of local runtime
   availability.
   For parity with the `node-min-smoke` job, also run
   `pnpm smoke:node-min` — but ONLY with a real Node **20.0.0** binary. The
   script warns instead of failing on a newer runtime, so running it on your
   default Node proves nothing about the `engines` floor.
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
