import { test, expect } from '@playwright/test'

type Probe = { label: string; ok: boolean; errorName?: string; errorMessage?: string }

// Known-good ceiling and known-bad floor from the measured Chrome version matrix
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
  browserName,
}) => {
  const version = browser.version()

  await page.goto('/')
  await expect
    .poll(async () => (await page.evaluate(() => (globalThis as any).__opfsResults))?.length ?? 0)
    .toBe(3)
  const coi = await page.evaluate(() => crossOriginIsolated)
  const results = (await page.evaluate(() => (globalThis as any).__opfsResults)) as Probe[]
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r]))
  const pageProbe = byLabel['Page (document)']
  const dedicated = byLabel['DedicatedWorker']
  const shared = byLabel['SharedWorker']

  test.info().annotations.push({
    type: 'cross-browser',
    description:
      `${browserName} ${version} coi=${coi} | page=${pageProbe.ok} ` +
      `dedicated=${dedicated.ok} shared=${shared.ok}` +
      (shared.ok ? '' : ` (${shared.errorName})`),
  })

  if (browserName === 'chromium') {
    // Chrome must be cross-origin isolated for the repro to be valid, and OPFS
    // works from the page and a DedicatedWorker on every tested version.
    expect(coi, 'page is crossOriginIsolated').toBe(true)
    expect(pageProbe.ok, `page OPFS on ${version}`).toBe(true)
    expect(dedicated.ok, `DedicatedWorker OPFS on ${version}`).toBe(true)

    // The SharedWorker is the regression: pass at/before LAST_GOOD, fail
    // (SecurityError) at/after FIRST_BAD, unmeasured in between.
    if (compareVersion(version, LAST_GOOD) <= 0) {
      expect(shared.ok, `SharedWorker OPFS should still work on ${version}`).toBe(true)
    } else if (compareVersion(version, FIRST_BAD) >= 0) {
      expect(
        shared.ok,
        `SharedWorker OPFS is denied on ${version}: ${shared.errorName}: ${shared.errorMessage}`,
      ).toBe(false)
      expect(shared.errorName, 'denial is a SecurityError').toBe('SecurityError')
    }
    return
  }

  // Other engines (Firefox, WebKit): the cross-browser claim is that the
  // SharedWorker is not singled out the way Chrome singles it out. Whatever the
  // page can do with OPFS, the SharedWorker can do too. (In Firefox both work;
  // in Playwright's WebKit automation build OPFS is unavailable even on the
  // page, so both fail equally and the invariant still holds.)
  expect(
    shared.ok,
    `${browserName} ${version}: SharedWorker OPFS (${shared.errorName ?? 'ok'}) should match the page (${pageProbe.errorName ?? 'ok'})`,
  ).toBe(pageProbe.ok)
})
