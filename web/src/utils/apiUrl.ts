export function getApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_URL

  if (configuredUrl?.startsWith('http')) {
    return configuredUrl.replace(/\/query$/, '')
  }

  return `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '')
}
