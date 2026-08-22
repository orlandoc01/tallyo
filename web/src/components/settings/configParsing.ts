export function splitCSV(value: string) {
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

export function nullIfBlank(value: string) {
  return value.trim() === '' ? null : value.trim()
}
