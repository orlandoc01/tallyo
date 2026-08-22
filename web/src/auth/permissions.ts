export function parseScopesFromToken(token: string | null): string[] {
  if (!token) return []
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return []
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    const scope = payload.scope
    if (typeof scope !== 'string') return []
    return scope.split(' ').filter(Boolean)
  } catch {
    return []
  }
}
