export function randomString(bytes: number): string {
  const values = new Uint8Array(bytes)
  crypto.getRandomValues(values)
  return base64Url(values)
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64Url(new Uint8Array(digest))
}

function base64Url(values: Uint8Array): string {
  return btoa(Array.from(values, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
