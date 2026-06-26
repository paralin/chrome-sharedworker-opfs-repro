import { test, expect } from '@playwright/test'

type Probe = { label: string; ok: boolean; errorName?: string; errorMessage?: string }

// Known-good ceiling and known-bad floor from the measured version matrix
// (see README.md / ISSUE.md). OPFS in a fresh isolated-page SharedWorker works
// up to and including 149.0.7827.55 and is denied from 149.0.7827.197 onward.
const LAST_GOOD = '149.0.7827.55'
const FIRST_BAD = '149.0.7827.197'

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

test('OPFS getDirectory() across page, DedicatedWorker, and SharedWorker', async ({
  page,
  browser,
}) => {
  const version = browser.version()
  test.info().annotations.push({ type: 'chrome-version', description: version })

  await page.goto('/')

  // The page must actually be cross-origin isolated, or the repro is invalid.
  expect(await page.evaluate(() => crossOriginIsolated), 'page is crossOriginIsolated').toBe(true)

  await expect
    .poll(async () => (await page.evaluate(() => (globalThis as any).__opfsResults))?.length ?? 0)
    .toBe(3)
  const results = (await page.evaluate(() => (globalThis as any).__opfsResults)) as Probe[]
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r]))

  // OPFS itself works on every tested version from the page and a DedicatedWorker.
  expect(byLabel['Page (document)'].ok, `page OPFS on ${version}`).toBe(true)
  expect(byLabel['DedicatedWorker'].ok, `DedicatedWorker OPFS on ${version}`).toBe(true)

  // The SharedWorker is the regression. Assert the measured matrix: pass on
  // builds at or before LAST_GOOD, fail (SecurityError) on builds at or after
  // FIRST_BAD. Versions in the unmeasured gap are reported, not asserted.
  const shared = byLabel['SharedWorker']
  if (compareVersion(version, LAST_GOOD) <= 0) {
    expect(shared.ok, `SharedWorker OPFS should still work on ${version}`).toBe(true)
  } else if (compareVersion(version, FIRST_BAD) >= 0) {
    expect(
      shared.ok,
      `SharedWorker OPFS is denied on ${version}: ${shared.errorName}: ${shared.errorMessage}`,
    ).toBe(false)
    expect(shared.errorName, 'denial is a SecurityError').toBe('SecurityError')
  } else {
    test
      .info()
      .annotations.push({
        type: 'note',
        description: `SharedWorker on ${version}: ok=${shared.ok} (between ${LAST_GOOD} and ${FIRST_BAD}; not asserted)`,
      })
  }
})
