import { test, expect } from '@playwright/test'

test.describe('Home page', () => {
  test('loads and shows the create/join panels', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/neon poker/i)
    await expect(page.getByTestId('create-session-button')).toBeVisible()
    await expect(page.getByTestId('join-session-button')).toBeVisible()
  })

  test('blocks creating a session without a name', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('create-session-button').click()
    await expect(page.getByTestId('home-error')).toContainText(/name/i)
  })

  test('creating a session navigates to a 6-char room code', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('display-name-input').first().fill('Ada')
    await page.getByTestId('create-session-button').click()
    await expect(page).toHaveURL(/#\/session\/[A-Z0-9]{6}$/)
    await expect(page.getByTestId('session-code')).toHaveText(/^[A-Z0-9]{6}$/)
  })

  test('join rejects bad codes with an error', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('display-name-input').first().fill('Grace')
    await page.getByTestId('join-code-input').fill('abc')
    await page.getByTestId('join-session-button').click()
    await expect(page.getByTestId('home-error')).toContainText(/code/i)
  })

  test('join normalises and navigates', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('display-name-input').first().fill('Grace')
    await page.getByTestId('join-code-input').fill('AB2345')
    await page.getByTestId('join-session-button').click()
    await expect(page).toHaveURL(/#\/session\/AB2345$/)
  })
})

test.describe('Session UI (solo) state machine', () => {
  test('can start a round, pick a card, force reveal, and start a new round', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('display-name-input').first().fill('Solo')
    await page.getByTestId('create-session-button').click()

    await expect(page.getByTestId('start-round-button')).toBeVisible()
    await page.getByTestId('round-title-input').fill('Story A')
    await page.getByTestId('start-round-button').click()

    await expect(page.getByTestId('round-title')).toContainText('Story A')

    // Pick a card.
    await page.getByTestId('card-5').click()
    await expect(page.getByTestId('card-5')).toHaveAttribute('aria-pressed', 'true')

    // A single participant voting auto-reveals.
    await expect(page.getByTestId('summary')).toBeVisible()
    await expect(page.getByTestId('summary-average')).toHaveText('5')
    await expect(page.getByTestId('summary-mode')).toHaveText('5')

    // Start a new round.
    await page.getByTestId('next-round-title-input').fill('Story B')
    await page.getByTestId('next-round-button').click()
    await expect(page.getByTestId('round-title')).toContainText('Story B')
  })
})
