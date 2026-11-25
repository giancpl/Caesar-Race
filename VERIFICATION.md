# Implementation verification

Recorded on 25 November 2026, including the Soft BitPolito redesign. Checks were performed locally. No cloud resources were provisioned and no application deployment was performed.

## Latest update: session recovery and deliberate departures

Home, Back/Forward, refresh and page suspension no longer trigger room departure or closure. Only the confirmed **Leave room** or **Close room** action under **Room session** sends a leave mutation. Recovery screens no longer offer an immediate destructive “Forget session” action. Reopening the same invitation restores the saved identity; another invitation or room-creation form cannot overwrite it. Pending bootstrap operations retain their original token, payload and request ID through refresh. Stale authorization failures cannot invalidate a replacement session.

Answer drafts and shift selections are saved separately for solo and rooms, scoped to their race, player and round. Browser history no longer rewrites and pushes the previous route on Back. Returning from page suspension restarts synchronization; responses arriving during unload do not update the suspended document. Solo recovery also respects navigation while its module is loading. Existing scoring, API schemas, expiry and server-authoritative departure rules are unchanged.

The WebKit navigation crash was traced to the browser bundled with Playwright 1.56.1. The same C++ assertion occurred in an application-free `pushState → reload → goto` reproducer. [The upstream Playwright report](https://github.com/microsoft/playwright/issues/43949) documents the exact failure and its fix in 1.57.0. The package, lockfile and digest-pinned test image now use 1.57.0 together; no application timing workaround was retained. The minimal reproducer is included in browser acceptance tests.

All three focused WebKit cases passed with normal failure tracing enabled: the minimal reproducer, combined multiplayer navigation/recovery, and solo draft/shift recovery without an API (1.4 minutes). They include uncertain joins, retained credentials, same/different invitations, countdown navigation, refresh, full-page Back, page suspension, solved feedback, round isolation and confirmed departures.

The expired-session browser fixture now seeds sessionStorage before application startup. The earlier fixture injected credentials into an already initialized client and raced same-document navigation against reload; it could reach the saved-session gate instead of testing expired-session startup. The corrected case passes in all four browser projects.

### Complete release gate

`npm run check:containers` completed successfully with Node 24.22.3 and the digest-pinned Playwright 1.57.0 image. The final application, stylesheet and test-source hashes matched the files inside the verification container.

| Check | Observed result |
| --- | --- |
| ESLint | Passed. |
| Unit/API/memory | 43 passed; zero skipped. |
| Production build | Passed. |
| Actual local Redis over HTTP | Integration suite passed; zero skipped. |
| Browser acceptance | All 56 passed in one run (11.7 minutes): 42 Chromium cases across desktop/360/390px and 14 WebKit cases at 390px; zero skipped. |
| Cleanup | Verification containers and network removed; gate exited with code 0. |

The two previously recorded 360px overflow failures now pass, including gameplay and setup at 200% text size. Axe, touch targets, keyboard/dialog focus, reduced motion, local assets, LAN play and navigation/session recovery pass in every configured browser project. No application or test changes were made after this passing gate; documentation and visual-capture tooling were finalized afterward. The capture helper now requests reduced motion to avoid transient entrance fades; its syntax check and final lint pass succeeded. Physical-phone hardware, hosted Upstash and deployed Vercel remain unverified.

Generated and reviewed 18 final screenshots in ignored `design-artifacts/final/`: landing, setup, countdown, gameplay, feedback, results, lobby, host dashboard and cancellation at 1440px desktop and 390px mobile. Controls, code/QR placement, wrapping and the alphabet wheel remain readable and within the viewport. The capture container exited successfully and was removed.

## Review against the remote

Reviewed all tracked changes and new files against `origin/main` at `a059725`, including the existing local redesign commit. The review covers local brand assets, shared visual components and alphabet wheel, spectator-only host policy, LAN binding and secure randomness, transport/session identity protection, route and draft recovery, documentation, dependency/container alignment and unit/Redis/browser checks. README difficulty descriptions were corrected to match the wheel controls. Secrets, generated output, dependencies and browser artifacts remain excluded from Git. No other BitPolito project was modified.

## Earlier update: HTTP LAN play

Development now binds to `0.0.0.0` by default and prints local and non-loopback network URLs. `HOST` still overrides the binding; preview remains loopback-only unless explicitly exposed. The host should open the printed Network URL so invitations and QR codes use a phone-reachable origin.

Browser UUIDs now use cryptographically secure `getRandomValues()` with standard UUID-v4 version/variant bits. Bearer tokens still contain 32 secure random bytes; missing secure randomness fails closed. Solo and multiplayer no longer require the HTTPS-only `randomUUID()` method. No weak-random fallback, browser security flags, certificate installation or production HTTPS changes were added.

Observed results: lint, build and **38 unit/API tests passed**. All **four targeted LAN browser cases passed** in the pinned container (desktop/360/390px Chromium and 390px WebKit, 1.9 minutes). Each case confirmed a non-secure HTTP origin with no `randomUUID`, completed solo with API blocked, created a spectator-host room, joined in another browser context, completed the race, recovered through refresh and checked QR/copy fallback behavior.

An additional 390px Chromium case passed against the computer's real Wi-Fi address, `http://192.168.1.173:5174`, with a successful health check through that address. The server printed the correct Wi-Fi URL; the Wi-Fi firewall zone already allowed TCP 5173 and was not changed. The temporary QA server and test container/network were stopped afterward. Physical-phone hardware remains unverified. The complete browser suite was not repeated for this change; its prior two 360px text-enlargement failures remain recorded below.

## Earlier update: spectator-only hosts

Room setup now defaults the editable host name to **BitPolito** and has no participation option. Creation requires `participates: false`; requests enabling host participation are rejected. Server projections, capacity, standings and gameplay authorization exclude hosts even when an older stored membership has `participates: true`.

Local lint, build and **36 unit/API tests passed**, including direct-request rejection and legacy-host protection. The real Redis integration suite passed with separate players racing while the host controls the room. All host lifecycle and recovery browser checks passed across desktop/360/390px Chromium and 390px WebKit.

At that milestone, the complete container run finished with **38 browser tests passed and 2 failed** (8.2 minutes). Both failures are horizontal overflow at 200% text size in 360px Chromium: solo gameplay accessibility and enlarged solo setup. These solo paths are unaffected by the host-policy update; the existing uncommitted visual edits were preserved without CSS changes. Failure artifacts were written to `test-results/container/results/`; subsequent browser runs replace that directory. Container/network cleanup succeeded.

## Earlier redesign verification

```sh
npm run check:containers
```

That earlier gate used Node 24.22.3, the pinned Playwright 1.56.1 Ubuntu image, Redis 7.4.12 and Serverless Redis HTTP. Image digests are recorded in `Dockerfile.test` and `compose.test.yml`. The host default remains Node 22.17.0; the container gate does not change host libraries or runtime configuration.

| Check | Observed result |
| --- | --- |
| Reproducible installation | `npm ci` succeeded from the committed lockfile under Node 24. |
| Dependency audit | npm reported zero known vulnerabilities after installation. |
| ESLint | Passed under Node 24. |
| Unit/API/memory checks | 35 passed, zero skipped. |
| Production build | Passed; versioned banks validated and server/Upstash imports excluded from static assets. |
| Actual local Redis | Integration test passed, zero skipped; exercises the HTTP SDK and actual Redis Lua commands. |
| Browser acceptance | All 40 passed in one run (7.4 minutes): 30 Chromium cases across desktop/360/390px and 10 WebKit cases at 390px. Zero skipped. Two focused 360px checks also passed before the full gate. |
| Visual inspection | Before/after captures cover nine screens at 1440px desktop and 390px mobile. Redesigned landing, setup, lobby, gameplay, countdown, feedback, dashboard, results and terminal layouts reviewed. |

The Redis suite uses isolated namespaces and independent HTTP handlers sharing one real Redis instance. It covers the storage contract, expiry, idempotent hints, concurrent duplicate-name joins, the final capacity slot, simultaneous final answers, final answers racing cancellation, and late answers racing rematch resets. It checks that only one winner persists, cancelled races have no winner, progress clears on reset and the original expiry survives. Cleanup deletes only tracked test keys. The container gate also runs all browser projects against the Redis-backed API, without cloud credentials or published service ports, then removes its containers and network.

The complete redesign gate exited successfully, including container/network cleanup. The application uses the same rules, API and storage contracts as the previously verified implementation. No runtime or browser-test changes were made after the passing gate. Final documentation and local packaging were completed afterward.

Browser acceptance covers solo Easy/Hard during API outages; candidate controls and hints; explicit Next Round; scoring and results; refresh recovery; independent host/player sessions; shared challenges; independent progression; rematches; lobby occupancy; focus/draft preservation while polling; committed create and answer responses lost over the network; reconnecting; keyboard access; reduced motion; axe checks; horizontal overflow; setup validation recovery; local QR generation; safe rendering of host names; production security headers/CSP; and expired-session recovery.

## Soft BitPolito design review

- Replaced the text wordmark and generated favicon with the supplied BitPolito SVGs. All eight SVGs were checked byte for byte against their source assets. Selected artwork is attributed in `public/brand/README.md`; no dependencies or external asset requests were added.
- Reworked every screen around shared spacing, controls, white surfaces, restrained shadows and accessible colors. Mobile mode choices precede the decorative illustration; the current message and answer precede tools and statistics. Desktop setup pairs an introduction with the form.
- Added checks for logo/favicon loading, responsive content order, 200% text enlargement, minimum 44px action targets, enlarged-text dialog focus restoration and overflow. Axe checks cover setup, lobby, gameplay and results.
- Preserved 18 baseline captures from commit `a059725` and 18 redesigned captures in ignored `design-artifacts/before/` and `design-artifacts/after/`. The capture helper supports repeatable nine-screen desktop/mobile reviews, independently of browser test-output cleanup.

## External verification boundaries

- **Hosted Upstash:** actual local Redis and its HTTP protocol passed. A hosted Upstash database has not been tested because no dedicated cloud credentials were supplied. Provider configuration, latency and account limits remain unverified. The protected integration job and `npm run test:redis` support a later dedicated test database; required CI credentials cannot silently skip the test.
- **Physical phones:** Safari/iOS and Chrome/Android were not tested on hardware. WebKit and mobile viewport emulation do not verify virtual keyboards, camera QR scanning, clipboard permissions or OS background suspension. Record these checks on physical devices before a workshop release.
- **Vercel:** function packaging, deployed routing/headers, regional latency and credentials remain unverified. Local preview exercises the configured security headers and CSP. Deployment configuration and instructions are included; application deployment is outside this delivery.
- **Hosted CI:** the same container gate is configured for GitHub Actions. No remote workflow result was observed during local verification; pushing to `main` can trigger it.

## Workspace Git packaging

The supplied `.git` directory is empty and read-only. It was not altered. Local Git metadata lives in the ignored `.git-local/` directory. The delivery includes a local commit containing the application, tests, documentation and npm lockfile, plus a portable `caesar-race.bundle`.

Within this managed workspace:

```sh
git --git-dir=.git-local --work-tree=. status
```

To obtain a normal writable checkout elsewhere:

```sh
git clone /path/to/caesar-race.bundle caesar-race
cd caesar-race
npm ci
npm run dev
```

The workspace's `origin` is `git@github.com:giancpl/Caesar-Race.git`, connected at the user's request after local verification. A normal checkout can use `git clone git@github.com:giancpl/Caesar-Race.git`. In this managed workspace, use `git --git-dir=.git-local --work-tree=. push` for later pushes.

The bundle excludes dependencies, build output, environment secrets, test artifacts and workspace-specific Git metadata. The generated bundle itself is ignored by Git.
