export function pluralize(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}
