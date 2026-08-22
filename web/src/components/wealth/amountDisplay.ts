const HIDDEN_AMOUNT = '....'

export function displayAmount(amountsHidden: boolean, formattedAmount: string): string {
  return amountsHidden ? HIDDEN_AMOUNT : formattedAmount
}
