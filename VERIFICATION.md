# Implementation verification

Recorded on 25 November 2026. The requested delivery is repository-only: no cloud resources were provisioned, no remote repository was written and no deployment was performed.

## Reproducible local gate

```sh
npm run check:containers
```

The gate uses Node 24.22.3, the pinned Playwright 1.56.1 Ubuntu image, Redis 7.4.12 and Serverless Redis HTTP. Image digests are recorded in `Dockerfile.test` and `compose.test.yml`. The host default remains Node 22.17.0; the container gate does not change host libraries or runtime configuration.

| Check | Observed result |
| --- | --- |
| Reproducible installation | `npm ci` succeeded from the committed lockfile under Node 24. |
| Dependency audit | npm reported zero known vulnerabilities after installation. |
| ESLint | Passed under Node 24. |
| Unit/API/memory checks | 35 passed, zero skipped. |
| Production build | Passed; versioned banks validated and server/Upstash imports excluded from static assets. |
| Actual local Redis | Integration test passed, zero skipped; exercises the HTTP SDK and actual Redis Lua commands. |
| Browser acceptance | All 36 passed in one run (6.3 minutes): 27 Chromium cases across desktop/360/390px and 9 WebKit cases at 390px. Zero skipped. |
| Visual inspection | Desktop landing, mobile landing and 390px mobile playing screen inspected. |

The Redis suite uses isolated namespaces and independent HTTP handlers sharing one real Redis instance. It covers the storage contract, expiry, idempotent hints, concurrent duplicate-name joins, the final capacity slot, simultaneous final answers, final answers racing cancellation, and late answers racing rematch resets. It checks that only one winner persists, cancelled races have no winner, progress clears on reset and the original expiry survives. Cleanup deletes only tracked test keys. The container gate also runs all browser projects against the Redis-backed API, without cloud credentials or published service ports, then removes its containers and network.

The complete gate exited successfully, including container/network cleanup. Application code, test code and configuration were unchanged after that run; only documentation and repository packaging were finalized afterward.

Browser acceptance covers solo Easy/Hard during API outages; candidate controls and hints; explicit Next Round; scoring and results; refresh recovery; independent host/player sessions; shared challenges; independent progression; rematches; lobby occupancy; focus/draft preservation while polling; committed create and answer responses lost over the network; reconnecting; keyboard access; reduced motion; axe checks; horizontal overflow; setup validation recovery; local QR generation; safe rendering of host names; production security headers/CSP; and expired-session recovery.

## External verification boundaries

- **Hosted Upstash:** actual local Redis and its HTTP protocol passed. A hosted Upstash database has not been tested because no dedicated cloud credentials were supplied. Provider configuration, latency and account limits remain unverified. The protected integration job and `npm run test:redis` support a later dedicated test database; required CI credentials cannot silently skip the test.
- **Physical phones:** Safari/iOS and Chrome/Android were not tested on hardware. WebKit and mobile viewport emulation do not verify virtual keyboards, camera QR scanning, clipboard permissions or OS background suspension. Record these checks on physical devices before a workshop release.
- **Vercel:** function packaging, deployed routing/headers, regional latency and credentials remain unverified. Local preview exercises the configured security headers and CSP. Deployment configuration and instructions are included; publishing was explicitly excluded from this delivery.
- **Hosted CI:** the same container gate is configured for GitHub Actions, but no remote workflow run was triggered or observed.

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

No remote is configured or required. The bundle excludes dependencies, build output, environment secrets, test artifacts and workspace-specific Git metadata. The generated bundle itself is ignored by Git.
