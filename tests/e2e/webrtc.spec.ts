import { test, expect, chromium, firefox, type Browser, type Page } from '@playwright/test'

/**
 * End-to-end WebRTC test that launches two *separate* browsers
 * (Chromium and Firefox) and verifies they can:
 *   - discover each other in the same trystero room
 *   - sync participants
 *   - sync round state and votes
 *   - reveal the cards automatically once everyone has voted
 *
 * This test needs real network access so the trystero signaling relays
 * can be reached. It has a generous timeout to account for signaling
 * warm-up.
 */

test.describe.configure({ mode: 'serial' })

// The cross-browser WebRTC test needs outbound access to public nostr
// relays for signaling. GitHub-hosted runners frequently block or rate-limit
// those relays, causing flaky failures that aren't really about our code.
// Opt-in via `RUN_WEBRTC_TESTS=1` (default ON locally, OFF on CI).
const shouldRun = process.env.CI ? process.env.RUN_WEBRTC_TESTS === '1' : true
test.skip(!shouldRun, 'Skipping cross-browser WebRTC tests: set RUN_WEBRTC_TESTS=1 to enable in CI.')

let chromiumBrowser: Browser
let firefoxBrowser: Browser

test.beforeAll(async () => {
  chromiumBrowser = await chromium.launch()
  firefoxBrowser = await firefox.launch()
})

test.afterAll(async () => {
  await chromiumBrowser?.close()
  await firefoxBrowser?.close()
})

async function enterSession(page: Page, baseURL: string, code: string, name: string) {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('display-name-input').first().fill(name)
  await page.getByTestId('join-code-input').fill(code)
  await page.getByTestId('join-session-button').click()
  await expect(page).toHaveURL(new RegExp(`#/session/${code}$`))
  await expect(page.getByTestId('session-code')).toHaveText(code)
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

test('two different browsers connect, vote, and auto-reveal', async ({ baseURL }, testInfo) => {
  test.setTimeout(180_000)
  const code = randomCode()

  const chromeCtx = await chromiumBrowser.newContext()
  const firefoxCtx = await firefoxBrowser.newContext()
  const chromePage = await chromeCtx.newPage()
  const firefoxPage = await firefoxCtx.newPage()

  chromePage.on('pageerror', (e) => testInfo.annotations.push({ type: 'chrome-pageerror', description: e.message }))
  firefoxPage.on('pageerror', (e) => testInfo.annotations.push({ type: 'firefox-pageerror', description: e.message }))

  try {
    await enterSession(chromePage, baseURL!, code, 'Alice')
    await enterSession(firefoxPage, baseURL!, code, 'Bob')

    // Both sides should eventually see 2 participants in the crew list.
    await expect
      .poll(async () => (await chromePage.getByTestId('participant-list').locator('li').count()), {
        timeout: 120_000,
        message: 'Chromium did not see Firefox peer',
      })
      .toBeGreaterThanOrEqual(2)

    await expect
      .poll(async () => (await firefoxPage.getByTestId('participant-list').locator('li').count()), {
        timeout: 120_000,
        message: 'Firefox did not see Chromium peer',
      })
      .toBeGreaterThanOrEqual(2)

    // Alice starts a round.
    await chromePage.getByTestId('round-title-input').fill('Sync story')
    await chromePage.getByTestId('start-round-button').click()

    // Bob should see the round title arrive over the data channel.
    await expect(firefoxPage.getByTestId('round-title')).toContainText('Sync story', { timeout: 30_000 })

    // Both vote.
    await chromePage.getByTestId('card-5').click()
    await firefoxPage.getByTestId('card-8').click()

    // Auto-reveal should kick in on both.
    await expect(chromePage.getByTestId('summary')).toBeVisible({ timeout: 30_000 })
    await expect(firefoxPage.getByTestId('summary')).toBeVisible({ timeout: 30_000 })

    // The revealed averages should agree.
    const chromeAvg = await chromePage.getByTestId('summary-average').textContent()
    const firefoxAvg = await firefoxPage.getByTestId('summary-average').textContent()
    expect(chromeAvg).not.toBeNull()
    expect(chromeAvg).toBe(firefoxAvg)
    expect(chromeAvg).toBe('6.5')
  } finally {
    await chromeCtx.close()
    await firefoxCtx.close()
  }
})

test('force-reveal by the round starter propagates to the other browser', async ({ baseURL }, testInfo) => {
  test.setTimeout(180_000)
  const code = randomCode()

  const chromeCtx = await chromiumBrowser.newContext()
  const firefoxCtx = await firefoxBrowser.newContext()
  const chromePage = await chromeCtx.newPage()
  const firefoxPage = await firefoxCtx.newPage()

  chromePage.on('pageerror', (e) => testInfo.annotations.push({ type: 'chrome-pageerror', description: e.message }))
  firefoxPage.on('pageerror', (e) => testInfo.annotations.push({ type: 'firefox-pageerror', description: e.message }))

  try {
    await enterSession(chromePage, baseURL!, code, 'Alice')
    await enterSession(firefoxPage, baseURL!, code, 'Bob')

    await expect
      .poll(async () => (await chromePage.getByTestId('participant-list').locator('li').count()), {
        timeout: 120_000,
      })
      .toBeGreaterThanOrEqual(2)

    await chromePage.getByTestId('round-title-input').fill('Force reveal story')
    await chromePage.getByTestId('start-round-button').click()

    await expect(firefoxPage.getByTestId('round-title')).toContainText('Force reveal story', {
      timeout: 30_000,
    })

    // Only Alice (the starter) votes.
    await chromePage.getByTestId('card-13').click()

    // Alice force-reveals.
    await chromePage.getByTestId('reveal-button').click()

    // Bob's UI should flip to the summary without ever voting.
    await expect(firefoxPage.getByTestId('summary')).toBeVisible({ timeout: 30_000 })
    await expect(firefoxPage.getByTestId('summary-average')).toHaveText('13')
  } finally {
    await chromeCtx.close()
    await firefoxCtx.close()
  }
})
