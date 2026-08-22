import { expect, test } from '@playwright/test'

test('loads the static client and shows the auth gate', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /household budget/i })).toBeVisible()
  await expect(page.getByLabel(/password/i)).toBeVisible()
})
