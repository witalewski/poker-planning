# Neon Poker ♠♥♦♣

A slick, serverless, peer-to-peer sprint planning poker app with a synthwave soul.
Zero backend — clients connect to each other over WebRTC data channels, using
public Nostr relays (via [`trystero`](https://github.com/dmotz/trystero)) only
for signaling. Your votes never touch a server.

**Live demo:** https://witalewski.github.io/poker-planning/

## Features

- Create a session with a one-click 6-character room code.
- Share the code (or a deep link) and your teammates join over P2P WebRTC.
- Anyone can start a new round, with an optional title.
- Pick a Fibonacci card (`0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89`) or `?`.
- See who has already voted — but not *what* they voted — until the reveal.
- The round starter can force a reveal at any time.
- Once everyone has voted, cards reveal automatically.
- Revealed rounds come with a summary: average, median, mode, distribution,
  and a plain-English verdict (consensus vs. spread).
- Synthwave UI: grid-on-void backdrop, floating neon orbs, holographic cards,
  micro-animations.

## Stack

- Vite + React 19 + TypeScript
- [`trystero`](https://github.com/dmotz/trystero) for WebRTC P2P with nostr-relay
  signaling (no custom backend required)
- Vitest + Testing Library for unit tests
- Playwright for end-to-end tests — including one spec that launches Chromium
  **and** Firefox side-by-side to exercise real WebRTC data-channel flow

## Local development

```sh
npm install
npm run dev
```

### Test suites

```sh
# Unit / component tests
npm test

# E2E smoke (single browser, headless)
npx playwright install chromium firefox
npm run test:e2e
```

The E2E suite is split into two Playwright projects:

- `same-browser-ui` — UI + state-machine tests that run in one browser.
- `cross-browser-webrtc` — the serious one. It launches Chromium **and**
  Firefox, has them join the same session, vote, and verifies that the
  summaries match across both browsers. Requires real network access for
  nostr signaling, so this one runs locally by default and is marked
  *best-effort* on CI (GitHub-hosted runners frequently block outbound
  websocket connections to public relays). Force it on in CI with
  `RUN_WEBRTC_TESTS=1`.

```sh
npx playwright test --project=same-browser-ui
npx playwright test --project=cross-browser-webrtc
```

### Production build

```sh
npm run build
npm run preview
```

### Deploying to GitHub Pages

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) builds
with `GITHUB_PAGES=true` — which switches the Vite base path to
`/poker-planning/` — and publishes `dist/` via the official Pages action.

To enable:

1. Push to `main`.
2. In the repo settings, under **Pages → Build and deployment → Source**,
   pick **GitHub Actions**.
3. First push will deploy automatically.

## How the P2P layer works

1. `trystero` derives a deterministic room ID from the session code.
2. Each browser opens a WebSocket to a handful of public Nostr relays and
   publishes/subscribes to offer & ICE-candidate events keyed by the room ID.
3. Once two peers exchange signals they establish a direct `RTCPeerConnection`
   with a `RTCDataChannel` — from then on, votes, rounds, and reveals flow
   peer-to-peer. Nothing touches a server you don't control.
4. New peers receive a `HELLO_SYNC` snapshot of the current session state
   so late-joiners catch up immediately.
5. A tiny reducer in [`src/lib/state.ts`](src/lib/state.ts) is the single
   source of truth; every peer applies the same action stream and converges
   to the same state.

## Project layout

```
src/
├── App.tsx                 # Route shell + theme chrome
├── pages/
│   ├── HomePage.tsx        # Create/Join
│   └── SessionPage.tsx     # Lobby + round + reveal
├── components/
│   ├── CardDeck.tsx        # Fibonacci + "?" cards
│   ├── ParticipantList.tsx # "crew" sidebar (has-voted indicator)
│   └── RevealedSummary.tsx # Stats + histogram
├── hooks/usePokerSession.ts
├── lib/
│   ├── state.ts            # Reducer + summarize()
│   ├── room.ts             # Trystero wrapper
│   ├── codes.ts            # Session code generation/validation
│   └── types.ts
tests/e2e/                  # Playwright specs
```

## License

MIT
