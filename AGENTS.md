# Working on Caesar Race

This is a standalone BitPolito educational game. Keep all code comments, documentation, UI text and communication in English. Do not modify MiningGame or Asymmetric-CryptoGraphy.

- Use vanilla JavaScript ES modules, semantic HTML, CSS and esbuild. Add dependencies only for a concrete requirement.
- Keep cipher operations, answer normalization, scoring and round transitions pure in the shared rules. Solo and the server use those rules.
- Multiplayer is server-authoritative. Authenticate each request; use atomic compare-and-set plus durable operation receipts. Never use plain read/modify/write storage for race updates.
- Only token hashes are stored server-side. Browser bearer tokens live in sessionStorage. Never log tokens, submitted answers or environment secrets.
- Build responses through explicit projections. Never serialize the private room document or reveal future challenges, unsolved plaintext fields, sequence bindings or unrevealed keys. Unlocked hints and personally solved feedback are intentional disclosures.
- Production/Vercel requires Redis. Never fall back to memory after missing configuration or a provider failure.
- Race IDs, round indices and request IDs are required mutation boundaries. Preserve the original 24-hour expiry through rematches and retries.
- Keep inputs safe through text rendering and strict schemas. Maintain keyboard access, 44px touch targets, mobile readability, reduced motion and visible focus.
- Run `npm run lint`, `npm test`, `npm run build` and appropriate browser tests. Use `npm run check` for full acceptance on a host with Chromium and WebKit dependencies.
- Prefer `npm run check:containers` for the complete release gate: it tests the real Redis adapter and all browser projects without host library changes. Keep test-image versions aligned with the Playwright package and exclude secrets from Docker build contexts.
- Test Redis only with dedicated test credentials and unique `caesar-race:test:` namespaces. Never use production credentials, `FLUSHDB`, or delete untracked keys.
- Report unverified Redis, physical-device and deployed behavior explicitly. Do not claim viewport emulation is physical-device testing.
- Never commit `.env.local`, `.env.test.local`, credentials, `dist/`, browser traces or dependency directories.
- No provisioning, deployment or external writes are needed for local implementation. Preserve this boundary unless the user requests those actions.

Reference: MiningGame commit `6f8523f6e0bd20d83dd7efa1dc33f32d5396e4d4` supplied flow and architecture inspiration. This repository contains its own Caesar-specific implementation and locally bundled BitPolito brand assets, attributed in `public/brand/README.md`.
