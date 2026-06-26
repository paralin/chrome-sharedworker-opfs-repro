# Chrome SharedWorker OPFS `SecurityError` repro

A minimal reproducer for a Chrome regression: in a **cross-origin-isolated**
page, `navigator.storage.getDirectory()` (the Origin Private File System root)
throws a `SecurityError` when called from a freshly created **SharedWorker**,
even though the identical call succeeds from the page itself and from a
**DedicatedWorker**.

This breaks legitimate cross-origin-isolated web apps that use a SharedWorker as
a single shared OPFS storage owner across tabs.

Upstream bug:
[crbug.com/528332884](https://issues.chromium.org/issues/528332884).

## What you need

Just [Node.js](https://nodejs.org/) (any recent version). No dependencies, no
build step.

## Run it

```sh
node server.mjs
# open the printed URL, e.g. http://127.0.0.1:8787/ , in Chrome
```

The page serves itself with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, so it is `crossOriginIsolated`.
`http://127.0.0.1` is a secure context in Chrome, so no TLS is required.

## What you should see

On an affected build (current stable Chrome), the result table is:

| Context | OPFS `getDirectory()` |
| --- | --- |
| Page (document) | PASS |
| DedicatedWorker | PASS |
| SharedWorker | **FAIL** — `SecurityError` |

The `SecurityError` message is:

> It was determined that certain files are unsafe for access within a Web
> application, or that too many calls are being made on file resources.

Expected behavior: the SharedWorker row should also PASS. OPFS does not require
cross-origin isolation, and the page and DedicatedWorker (same origin, same
profile) both obtain the OPFS root.

## Status against other browsers

The denial is Chromium-specific: only Chrome (on affected builds) denies the
SharedWorker while the page and DedicatedWorker succeed. Results from this same
reproducer via Playwright:

| Browser | Page | DedicatedWorker | SharedWorker | Notes |
| --- | --- | --- | --- | --- |
| Chrome ≤ 149.0.7827.55 | PASS | PASS | PASS | before the regression |
| Chrome ≥ 149.0.7827.197 | PASS | PASS | **FAIL** (`SecurityError`) | the regression |
| Firefox 151 | PASS | PASS | PASS | **not affected**; `crossOriginIsolated` works |
| Safari / WebKit (Playwright 26.5) | FAIL | FAIL | FAIL (`UnknownError`) | see caveat below |

Firefox does not single out the SharedWorker: the page, DedicatedWorker, and
SharedWorker all obtain the OPFS root.

Safari caveat: Playwright's bundled WebKit (Safari's engine) returns a generic
`UnknownError` for `navigator.storage.getDirectory()` even from the page in this
headless automation build, so OPFS is simply unavailable there and the run
cannot isolate the SharedWorker behavior. This is an automation-environment
limitation, not evidence about real Safari; confirm in actual Safari manually
(`node server.mjs`, then open the printed URL in Safari). Because the page-level
OPFS result tracks the SharedWorker result on both non-Chromium engines, neither
exhibits the Chrome-specific "page works but SharedWorker is denied" split.

## Automated test (version matrix + other engines)

A [Playwright](https://playwright.dev/) test encodes the matrix below. For
Chrome it runs the three probes against every build it can find and asserts that
the page and DedicatedWorker always get OPFS, that the SharedWorker still gets
OPFS on builds up to `149.0.7827.55`, and that it is denied with `SecurityError`
from `149.0.7827.197` onward. It also runs Firefox and WebKit and asserts the
SharedWorker is never singled out relative to the page (set
`OPFS_SKIP_OTHER_ENGINES=1` to run only the Chrome matrix).

```sh
npm install
npm run setup        # playwright install chromium chrome
npm test
```

By default the test auto-detects installed Google Chrome plus any Chrome for
Testing builds cached under the Playwright browser cache. To test specific
builds, list them explicitly (one Playwright project per build):

```sh
OPFS_CHROME_BINARIES="cft-148=/path/to/148/chrome,cft-149=/path/to/149/chrome,stable=/path/to/chrome" npm test
```

Download pinned builds from
[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/).

## Regression range

Tested with downloadable [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/)
builds plus installed stable, running this same scenario (fresh SharedWorker
created by the isolated page), 10 attempts each:

| Chrome build | SharedWorker OPFS root |
| --- | --- |
| 143.0.7499.4 | 10/10 pass |
| 145.0.7632.6 | 10/10 pass |
| 147.0.7727.15 | 10/10 pass |
| 148.0.7778.96 | 10/10 pass |
| 149.0.7827.55 | 10/10 pass |
| 149.0.7827.197 | 0/10 fail (`SecurityError`) |

So this is **not** an M149 milestone boundary; it is a change in a late-M149
patch, between `149.0.7827.55` and `149.0.7827.197`.

## Likely cause

The regression range brackets commit
[`732be71ad03c` "Block PDF processes from accessing OPFS"](https://chromium.googlesource.com/chromium/src/+/732be71ad03c)
(Gerrit `crrev.com/c/7894258`, `Fixed: 517484284`). It adds an **unconditional**
`ChildProcessSecurityPolicy::CanAccessDataForOrigin(process_id, origin)` check to
`FileSystemAccessManagerImpl::GetSandboxedFileSystem` that returns
`FILE_ERROR_SECURITY` when it fails.

The commit's stated intent is to stop **PDF** renderer processes from reaching
OPFS. A cross-origin-isolated page's SharedWorker is allocated into a
non-isolated process that has **not** committed the page origin, so it also fails
`CanAccessDataForOrigin` and is denied. The SharedWorker breakage appears to be
unintended collateral.

The guard has no feature flag, so launch flags do not restore access (for
example `--disable-field-trial-config` on `149.0.7827.197` still fails).

See [`ISSUE.md`](./ISSUE.md) for the bug-tracker draft.

## Files

- `server.mjs` — zero-dependency static server that sets the COOP/COEP headers.
- `index.html` + `app.js` — the page; runs the three probes and renders results.
- `shared-worker.js` — SharedWorker OPFS probe (the failing case).
- `dedicated-worker.js` — DedicatedWorker OPFS probe (the passing contrast).
