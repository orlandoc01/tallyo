import { maskAmount } from '../../utils/currency'

export function displayAmount(amountsHidden: boolean, formattedAmount: string): string {
  return amountsHidden ? maskAmount(formattedAmount) : formattedAmount
}
