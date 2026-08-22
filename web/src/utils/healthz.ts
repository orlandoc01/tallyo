import { getApiBaseUrl } from './apiUrl'

export async function waitForHealthz() {
  const base = getApiBaseUrl()
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`, { cache: 'no-store' })
      if (response.ok || response.status === 204) return
    } catch {
      // The server is expected to be briefly unreachable while restarting.
    }

    await new Promise((resolve) => window.setTimeout(resolve, 1000))
  }
}
