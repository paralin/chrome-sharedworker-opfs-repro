import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { defineConfig, devices, type Project } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 8787)
const BASE_URL = `http://127.0.0.1:${PORT}`

// discoverChromes builds the version matrix. Each entry becomes a Playwright
// project that launches that exact Chrome executable. Supply your own builds
// with OPFS_CHROME_BINARIES="label=/path/to/chrome,label2=/path2" (or a plain
// comma-separated list of paths); otherwise we auto-detect installed Chrome and
// any Chrome for Testing builds under the Playwright browser cache.
function discoverChromes(): { name: string; executablePath: string }[] {
  const found: { name: string; executablePath: string }[] = []
  const seen = new Set<string>()
  const add = (name: string, path: string | undefined) => {
    if (path && existsSync(path) && !seen.has(path)) {
      seen.add(path)
      found.push({ name, executablePath: path })
    }
  }

  for (const item of (process.env.OPFS_CHROME_BINARIES ?? '').split(',')) {
    const entry = item.trim()
    if (!entry) continue
    const [label, path] = entry.includes('=') ? entry.split('=') : [basename(entry), entry]
    add(label.trim(), path.trim())
  }

  add('chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  add('chrome-stable', '/usr/bin/google-chrome')
  add('chrome-stable', '/usr/bin/google-chrome-stable')
  add('chrome-stable', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')

  // Chrome for Testing builds cached by Playwright (one per installed revision).
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
  ].filter(Boolean) as string[]
  for (const cacheRoot of cacheRoots) {
    if (!existsSync(cacheRoot)) continue
    for (const dir of readdirSync(cacheRoot)) {
      if (!dir.startsWith('chromium-')) continue
      for (const arch of ['chrome-mac-arm64', 'chrome-mac', 'chrome-linux', 'chrome-win']) {
        for (const exe of [
          'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          'chrome',
          'chrome.exe',
        ]) {
          add(`cft-${dir.replace('chromium-', '')}`, join(cacheRoot, dir, arch, exe))
        }
      }
    }
  }

  return found
}

const chromes = discoverChromes()

const projects: Project[] =
  chromes.length > 0
    ? chromes.map(({ name, executablePath }) => ({
        name,
        use: {
          ...devices['Desktop Chrome'],
          launchOptions: { executablePath },
        },
      }))
    : [
        // Fallback so `npm test` runs even with no external builds discovered:
        // use Playwright's bundled Chromium.
        { name: 'chromium-bundled', use: { ...devices['Desktop Chrome'] } },
      ]

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    headless: process.env.HEADED !== '1',
  },
  webServer: {
    command: 'node server.mjs',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
  projects,
})
