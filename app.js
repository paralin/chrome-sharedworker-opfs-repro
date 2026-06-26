// Drives three OPFS probes (page, DedicatedWorker, SharedWorker) and renders the
// result. Each probe just calls navigator.storage.getDirectory() and reports
// success or the thrown DOMException.

const results = document.querySelector('#results')
document.querySelector('#coi').textContent = String(crossOriginIsolated)

function addRow(label, result) {
  const tr = document.createElement('tr')
  const verdict = result.ok
    ? '<span class="pass">PASS</span>'
    : '<span class="fail">FAIL</span>'
  const error = result.ok ? '' : `${result.errorName}: ${result.errorMessage}`
  tr.innerHTML = `<td>${label}</td><td>${verdict}</td><td class="err">${error}</td>`
  results.appendChild(tr)
}

async function pageProbe() {
  try {
    await navigator.storage.getDirectory()
    return { ok: true }
  } catch (error) {
    return { ok: false, errorName: error.name, errorMessage: error.message }
  }
}

function workerProbe(makePort, label) {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, errorName: 'TimeoutError', errorMessage: `${label} did not reply` }),
      5000,
    )
    const port = makePort((data) => {
      clearTimeout(timer)
      resolve(data)
    })
    port.postMessage('getDirectory')
  })
}

function dedicatedProbe() {
  return workerProbe((onResult) => {
    const worker = new Worker('./dedicated-worker.js')
    worker.onmessage = (event) => onResult(event.data)
    return worker
  }, 'DedicatedWorker')
}

function sharedProbe() {
  return workerProbe((onResult) => {
    // Unique name so this is always a freshly created SharedWorker owned by this
    // cross-origin-isolated page, not one a prior context already created.
    const worker = new SharedWorker('./shared-worker.js', { name: `opfs-repro-${Date.now()}` })
    worker.port.onmessage = (event) => onResult(event.data)
    worker.port.start()
    return worker.port
  }, 'SharedWorker')
}

const probes = [
  ['Page (document)', await pageProbe()],
  ['DedicatedWorker', await dedicatedProbe()],
  ['SharedWorker', await sharedProbe()],
]
for (const [label, result] of probes) addRow(label, result)

// Expose structured results for the Playwright test (see tests/opfs.spec.ts).
globalThis.__opfsResults = probes.map(([label, result]) => ({ label, ...result }))
