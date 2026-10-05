export function splitCSV(value: string) {
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

export function nullIfBlank(value: string) {
  return value.trim() === '' ? null : value.trim()
}

export function numberInRange(value: string, min: number, max: number) {
  const parsed = Number(value)
  return value.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max
}
