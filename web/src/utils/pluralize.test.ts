import { expect, it } from 'vitest'
import { pluralize } from './pluralize'

it('pluralizes with a count prefix', () => {
  expect(pluralize(1, 'item')).toBe('1 item')
  expect(pluralize(0, 'item')).toBe('0 items')
  expect(pluralize(2, 'item')).toBe('2 items')
})
