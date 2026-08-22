export const HIDE_AMOUNTS_PARAM = 'hide_amounts'

export function amountVisibilityFromParams(searchParams: URLSearchParams) {
  return searchParams.get(HIDE_AMOUNTS_PARAM) === 'true'
}
