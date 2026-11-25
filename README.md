# Caesar Race

An approachable Caesar cipher game for BitPolito workshops. Play solo or host a live race for up to 30 players. Everything works in a smartphone browser: no account, installation or code required.

## Run locally

Use Node.js **24.x** and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. One local origin serves frontend and API. Local multiplayer uses an in-memory store; restarting the server clears rooms. Source changes rebuild the frontend; reload the browser to see them. Restart the server after backend changes.

For built assets, run `npm run build` followed by `npm run preview`. Do not open the HTML directly from disk. To test phones on the same trusted network, start with `HOST=0.0.0.0 npm run dev`; use HTTPS for Web Crypto, session creation and clipboard capabilities on non-loopback origins. A secure development tunnel is appropriate for physical-phone tests. The QR uses the origin opened in the host browser.

## Play

- **Solo:** choose Easy or Hard and 1–10 rounds (default 3). Easy includes a live shift slider; Hard offers a static alphabet reference. A local three-second countdown starts the timer.
- **Multiplayer:** create a room and share its six-character code, invitation URL or locally generated QR. The host spectates by default and may choose to participate. A participating host occupies one of 30 player slots.
- Every player gets the same ordered messages and progresses independently. The host starts a shared three-second countdown; joining then closes.
- Enter the original plaintext. ASCII letter case and extra whitespace do not matter; punctuation does. Encryption preserves case, spaces, punctuation and non-ASCII characters. Generated keys are 1–25.
- Three hints reveal the method, first word and key in order. Each new hint costs 10 points. Each wrong answer costs 2; malformed/empty input costs nothing.
- A solved message earns `max(20, 100 − 10 × hints − 2 × wrong attempts)`. Press **Next Round** after non-final messages.
- The first final answer accepted atomically by the server wins immediately. Points never override that result. Standings then use completed rounds, points, earlier latest correct submission, and join order.

Solo saves an active game in sessionStorage and the latest 20 results locally. These are labelled **non-authoritative**. Multiplayer progress, timestamps and outcomes are calculated on the server. Solo remains playable with all API requests failing, provided the static application has loaded. Installable/offline PWA support is not included.

## Sessions and rooms

Refresh restores a valid room session in the same tab. Bearer tokens are generated with Web Crypto, sent only in Authorization headers and stored in sessionStorage; the server stores hashes. No credentials enter invitation URLs. Closing the tab ends normal recovery. Storage denial retains in-memory functionality, but refresh recovery cannot then be promised.

Disconnections preserve membership and progress. A disconnected host does not stop the race, and host ownership never transfers. Explicit player departure removes a lobby membership or marks a started-race participant as left. If every participant explicitly leaves an active race, it is cancelled without a winner. A host explicitly leaving closes the room for everyone.

Only the host starts, cancels or prepares rematches. Rematches retain non-departed members and credentials, clear progress, generate a new race ID/sequence and return to the lobby. Settings stay fixed; create another room to change them.

Rooms expire exactly 24 hours after creation. Polls, retries and rematches do not extend expiry. Disconnected members retain their slots until explicit departure or expiry.

## Architecture

- `src/core`: pure Caesar operations, normalization, scoring and shared round reducer.
- Challenge generation uses 24 curated English messages per difficulty, immutable `messages-v1`, secure random selection without replacement, and independent nonzero keys. Tests inject deterministic randomness.
- Solo loads as a separate browser chunk. UI uses small DOM components, native dialogs and a hash router. User text is rendered as text nodes.
- Server room transitions, explicit public/personal projections and transport are separated from storage adapters.
- Memory and Upstash implement the same conditional-create, atomic-commit, receipt, presence and rate-limit contract.
- Each authoritative mutation commits room state plus its idempotency receipt in one Lua compare-and-set. Eight bounded contention retries precede a retryable conflict.
- Credentials are stored before bootstrap requests so lost create/join responses can recover the same membership. Gameplay retries reuse the same request ID/body. Stale races and rounds cannot alter a rematch.
- Presence is separate from the room document. Visible clients poll roughly every two seconds, pause while hidden and refresh on return. Network failures preserve drafts and back off to at most 15 seconds.

Public preview includes settings and occupancy, not names. Authenticated status includes roster/progress and only the requester's current ciphertext, unlocked hints and solved history. Future challenge bindings, unsolved plaintext fields, unrevealed keys and token hashes are excluded. The curated banks are public through solo delivery; they are educational content rather than secrets.

Caesar has just 26 possible shifts including identity, so brute-force and external solvers are easy. Even a large key space alone does not establish security. Server authority protects recorded progress; comprehensive anti-cheat protection is not promised.

## API contract

`GET /api/health` checks storage. Room requests use `/api/room?action=ACTION`.

| Action | Method | Authorization / fields |
| --- | --- | --- |
| create | POST | New bearer; requestId, name, difficulty, rounds, participates |
| preview | GET | Public; code query parameter |
| join | POST | New bearer; requestId, code, name |
| status | GET | Member bearer; code query parameter |
| start/cancel/reset/leave | POST | Member bearer; code, raceId, requestId; start/cancel/reset require host |
| answer | POST | Player bearer; code, raceId, requestId, roundIndex, answer |
| hint | POST | Player bearer; code, raceId, requestId, roundIndex, hintNumber |
| next | POST | Player bearer; code, raceId, requestId, roundIndex |

Round indices are zero-based. Success returns `{ok: true, room, outcome?}`; errors return `{ok: false, error}` with a stable code and appropriate HTTP status. Room responses include serverNow, roomVersion, raceId and expiresAt. Incorrect evaluated answers succeed with `outcome.correct: false`. Reset retry after a committed rematch can return STALE_RACE; refresh status to recover the new lobby.

Requests are limited to 4 KiB. Names allow 1–24 Unicode code points without controls/format characters. Answers allow up to 240 code points, require an ASCII letter, and reject prohibited controls. Body schemas reject unknown/missing fields. Rate limits: creation 20/hour per IP; joining/preview 120/minute per IP per action; status/answers 60/minute per token, answers also 10/second; other mutations 30/minute per token. Rate-limited responses include Retry-After and never change attempts.

## Environments and Vercel

Copy `.env.example` to `.env.local` for local development. Never commit values. Local memory is the default; set `CAESAR_STORAGE=redis` to test the Redis adapter locally.

| Variable | Purpose |
| --- | --- |
| CAESAR_REDIS_REST_URL | Upstash HTTPS REST endpoint |
| CAESAR_REDIS_REST_TOKEN | Server-only Upstash credential |
| CAESAR_REDIS_NAMESPACE | Environment-specific prefix, e.g. `caesar-race:prod:v1` |
| CAESAR_RATE_LIMIT_SECRET | Strong independent server secret for hashing rate-limit subjects |
| CAESAR_STORAGE | Local `memory` or explicit `redis`; production always requires Redis |

Vercel/production refuses missing Redis configuration and never falls back to memory. Namespaces must start with `caesar-race:`. Production requires an HTTPS endpoint without embedded credentials and a rate-limit secret of at least 32 characters; generate a strong random value rather than using a phrase. Plain HTTP is supported only outside hosted/production mode for local test proxies. Use distinct preview, production and integration-test databases/credentials. Match the Vercel function region to Redis for workshop latency. At 30 players, status alone is about 15 HTTP requests per second; confirm your provider limits and budget before a workshop.

The included Vercel configuration installs with `npm ci`, builds with `npm run build`, serves `dist/` and traces server modules into the two API functions. Hash navigation needs no catch-all rewrite, so missing assets retain proper 404s. Static bundles exclude server modules/secrets. Hashed assets are immutable; HTML revalidates; API responses are uncached. Security headers restrict scripts, connections, framing and browser permissions. Local preview applies these same security headers from the configuration, so browser tests exercise the production content security policy.

To deploy later: create a separate Vercel project, connect this repository, set Node 24.x and the required server environment variables, then build/deploy through your normal process. No cloud resource has been provisioned or deployed by this implementation.

Keep schema/rules/bank versions supported for active 24-hour rooms when releasing changes. Unsupported room versions fail explicitly. Do not silently migrate or regenerate an ongoing sequence. Avoid incompatible deployments during workshops.

## Verification

For the complete reproducible gate, use Docker with its Compose plugin:

```sh
npm run check:containers
```

This builds a pinned Node 24/Playwright image, starts disposable Redis plus an HTTP proxy, runs lint/unit/build/integration checks and then every Chromium/WebKit browser project against the Redis-backed API. It uses a unique Compose project, publishes no service ports and removes its containers/network afterward. Browser failure artifacts go to `test-results/container/`. No cloud credentials are used. `.dockerignore` excludes local environment files, Git metadata and installed dependencies from the image.

The HTTP proxy is [Serverless Redis HTTP, recommended by Upstash for development and CI](https://upstash.com/docs/redis/sdks/ts/developing). This checks actual Redis commands, Lua atomicity and the Upstash SDK protocol; it does not claim that a hosted Upstash database or Vercel deployment has been verified.

You can also run the checks directly on a compatible host:

```sh
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium webkit
npm run test:e2e
```

`npm run check` combines checks after browser installation. Tests cover cipher correctness, banks, score/hints, independent progress, authorization, capacity, expiry, projections, stale requests, retries and simultaneous final answers. Browser tests use independent host/player contexts and include API-outage solo play, refresh, rematches, focus preservation, lost create/answer responses, network failures, expired sessions, local QR invitations, production CSP, axe checks, keyboard access and reduced motion.

Playwright projects cover desktop Chromium, 360/390px Chromium and 390px WebKit. These are emulated viewports. Physical iOS Safari and Android Chrome require separate release checks for virtual keyboard obstruction, scanning QR, clipboard, backgrounding, reconnecting, touch targets and text zoom.

For hosted Upstash verification, create `.env.test.local` with dedicated `CAESAR_TEST_REDIS_REST_URL` and `CAESAR_TEST_REDIS_REST_TOKEN`, then run `npm run test:redis`. The test rejects the configured application database, uses a unique `caesar-race:test:` namespace, limits created-room lifetime to two minutes, runs independent HTTP handlers against one database and deletes only tracked keys. It covers concurrent joins, final answers, cancellation and reset races. It never flushes the database. Missing credentials are reported as **UNVERIFIED/SKIPPED**, not passed.

GitHub Actions runs the same complete container gate, including local Redis and WebKit. An additional hosted-Upstash job runs only via trusted workflow dispatch with a protected `redis-integration` environment; pull requests do not receive cloud secrets. That job fails if required credentials are missing, rather than reporting a skipped check as success. Browser failures upload traces/screenshots.

See [VERIFICATION.md](VERIFICATION.md) for observed results and remaining external verification.

## Troubleshooting

- **Room unavailable:** check the code and the fixed 24-hour expiry. Local server restarts clear memory rooms.
- **Invalid session:** use the original tab; an explicit departure revokes access. No accounts or host-transfer recovery exist.
- **Reconnecting:** keep the tab open. The client retries a pending mutation with its original ID; do not create a second identity to bypass recovery.
- **Storage unavailable:** check server-only Redis configuration and provider status. Solo is still available.
- **Web Crypto unavailable on a phone:** use HTTPS; insecure LAN origins are not supported for session creation.
- **WebKit launch dependencies missing:** use `npm run check:containers`, or install Playwright's `--with-deps` on a supported host. Record verification as incomplete until a browser actually runs.

## Reference and license

Architecture and workshop-flow inspiration: [BitPolito/MiningGame at 6f8523f](https://github.com/BitPolito/MiningGame/tree/6f8523f6e0bd20d83dd7efa1dc33f32d5396e4d4). The Caesar logic, UI and SVG artwork here are original. MIT licensed; see LICENSE.
