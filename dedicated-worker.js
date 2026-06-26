// DedicatedWorker OPFS probe. This runs in the creator page's renderer process
// and succeeds on every Chrome build, which is the contrast that isolates the
// SharedWorker failure.

self.onmessage = async () => {
  try {
    await navigator.storage.getDirectory()
    self.postMessage({ ok: true })
  } catch (error) {
    self.postMessage({ ok: false, errorName: error.name, errorMessage: error.message })
  }
}
