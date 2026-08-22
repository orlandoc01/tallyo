export function isInvalidGlobalIDError(error: { message: string } | undefined): boolean {
  return error?.message.toLowerCase().includes('invalid global id') ?? false
}
