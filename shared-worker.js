// SharedWorker OPFS probe. On affected Chrome builds
// navigator.storage.getDirectory() rejects with a SecurityError here, even
// though the same call succeeds on the page and in a DedicatedWorker.

self.onconnect = (event) => {
  const port = event.ports[0]
  port.onmessage = async () => {
    try {
      await navigator.storage.getDirectory()
      port.postMessage({ ok: true })
    } catch (error) {
      port.postMessage({ ok: false, errorName: error.name, errorMessage: error.message })
    }
  }
  port.start()
}
