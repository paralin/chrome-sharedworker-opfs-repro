## Title

SharedWorker in a cross-origin-isolated page is denied OPFS
(`navigator.storage.getDirectory()` throws `SecurityError`) since a late-M149
patch

## Chrome version

- Affected: 149.0.7827.197 (stable) and later, all desktop platforms
- Last good: 149.0.7827.55 (Chrome for Testing)
- OS observed: macOS (arm64); the cause is platform-independent

## Summary

In a cross-origin-isolated document (`COOP: same-origin` +
`COEP: require-corp`, so `crossOriginIsolated === true`), calling
`navigator.storage.getDirectory()` inside a freshly created `SharedWorker`
rejects with `SecurityError`. The identical call succeeds:

- from the page itself, and
- from a `DedicatedWorker` created by that page,

on the same origin and profile. OPFS does not require cross-origin isolation, so
the SharedWorker should be able to obtain the OPFS root as well.

The `SecurityError` message is:

> It was determined that certain files are unsafe for access within a Web
> application, or that too many calls are being made on file resources.

## Steps to reproduce

A self-contained, zero-dependency reproducer is attached
(`chrome-sharedworker-opfs-repro`):

1. `node server.mjs`
2. Open the printed `http://127.0.0.1:8787/` in Chrome.

The server sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. `http://127.0.0.1` is a secure
context, so OPFS and cross-origin isolation both apply without TLS. The page
calls `navigator.storage.getDirectory()` from three contexts and renders the
result.

## Expected result

All three contexts obtain the OPFS root:

| Context | OPFS `getDirectory()` |
| --- | --- |
| Page (document) | PASS |
| DedicatedWorker | PASS |
| SharedWorker | PASS |

## Actual result

The SharedWorker is denied:

| Context | OPFS `getDirectory()` |
| --- | --- |
| Page (document) | PASS |
| DedicatedWorker | PASS |
| SharedWorker | **FAIL** — `SecurityError` |

## Regression range

Running the same scenario against downloadable Chrome for Testing builds plus
installed stable (10 attempts each, fresh SharedWorker created by the isolated
page):

| Chrome build | SharedWorker OPFS root |
| --- | --- |
| 143.0.7499.4 | 10/10 pass |
| 145.0.7632.6 | 10/10 pass |
| 147.0.7727.15 | 10/10 pass |
| 148.0.7778.96 | 10/10 pass |
| 149.0.7827.55 | 10/10 pass |
| 149.0.7827.197 | 0/10 fail (`SecurityError`) |

So the regression is **not** an M149 milestone boundary; it is a change in a
late-M149 patch, between `149.0.7827.55` and `149.0.7827.197`. The attached
Playwright test encodes this matrix.

## Suspected cause

The regression range brackets commit `732be71ad03c` "Block PDF processes from
accessing OPFS" (`crrev.com/c/7894258`, `Fixed: 517484284`,
`refs/heads/main@{#1641471}`, landed on main 2026-06-04). It adds, in
`content/browser/file_system_access/file_system_access_manager_impl.cc`, an
unconditional check at the start of
`FileSystemAccessManagerImpl::GetSandboxedFileSystem`:

```cpp
if (!ChildProcessSecurityPolicy::GetInstance()->CanAccessDataForOrigin(
        binding_context.process_id(), binding_context.storage_key.origin())) {
  std::move(callback).Run(file_system_access_error::FromFileError(
                              base::File::FILE_ERROR_SECURITY),
                          mojo::NullRemote());
  return;
}
```

The commit message scopes the intent to PDF-isolated renderer processes and does
not mention shared workers. The collateral effect on SharedWorkers appears to be
this: a cross-origin-isolated page forces its SharedWorker into a non-isolated
SiteInstance/process (the worker process is allocated before its COEP header is
known). A worker process never commits an origin, so for a freshly created
SharedWorker host `CanAccessDataForOrigin(worker_process, page_origin)` is
`false`, and the new check denies OPFS. A DedicatedWorker is allocated in the
creator frame's process (which has committed the origin), so it is unaffected.

Because the check has no feature flag, runtime flags do not restore access (for
example, launching `149.0.7827.197` with `--disable-field-trial-config` still
fails), which also rules out a Finch field trial.

## Other browsers

The denial is Chromium-specific. Running the same reproducer under Firefox 151
(via the attached Playwright test) obtains the OPFS root from the page, the
DedicatedWorker, and the SharedWorker alike: Firefox does not single out the
SharedWorker. WebKit (Safari's engine) could not be used to isolate the behavior
because the Playwright automation build returns a generic `UnknownError` for
`navigator.storage.getDirectory()` even from the page, so OPFS is unavailable
there regardless of context. On both non-Chromium engines the SharedWorker
result matches the page result; only Chromium produces the "page succeeds but
SharedWorker is denied" split.

## Impact

Cross-origin-isolated applications that use a `SharedWorker` as a single OPFS
storage owner shared across tabs lose persistent storage entirely on affected
builds, with no app-side workaround other than moving storage to a
DedicatedWorker or to IndexedDB. Cross-origin isolation is commonly required for
`SharedArrayBuffer` / Wasm threads, so apps cannot simply drop it.

## Suggested fix direction

Scope the new `CanAccessDataForOrigin` denial to the process types it was meant
to block (PDF / sandboxed-from-storage renderers) rather than all processes that
have not committed the origin, so that a legitimate cross-origin-isolated page's
SharedWorker is not caught by it. The underlying SharedWorker process-placement
limitation is tracked at `crbug.com/40122193`.
