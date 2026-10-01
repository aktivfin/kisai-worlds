# Stabilization status

This branch is an alpha stabilization checkpoint. Run `npm run verify` for source, combat, smoke, restart, security and concurrency checks. Run `npm run test:e2e` after `npm ci` and `npx playwright install chromium` for the two browser scenario. Do not merge to `main` until the browser job and the GitHub CI are observed green.

## Runtime boundaries

- Local scripts bind to `127.0.0.1`; LAN scripts bind to `0.0.0.0`. `KISAI_BIND`, `KISAI_PORT`, `KISAI_STATE_FILE`, and `KISAI_CONFIG_FILE` override these for deployments and isolated tests.
- `POST /api/session` creates a new UUID profile and returns a random bearer token. The server stores only its SHA-256 digest. Existing profiles keyed by names remain in the state file, but are not claimable by name. Back up legacy state and migrate access under local host supervision before relying on old saves.
- Config editing requires a loopback connection. The client stores music volume locally. Blank or masked key input preserves the existing server key. This is a local host trust boundary; untrusted processes on the host must be isolated separately.
- Provider URLs allow HTTP(S), disallow private/loopback/link-local/metadata destinations by default, and reject redirects. `KISAI_ALLOW_PRIVATE_PROVIDER=1` permits local providers when explicitly set by the host. DNS rebind defense and a per-provider hostname allowlist remain future hardening tasks. Requests time out after 12 seconds, retry transient HTTP statuses once and cap concurrent provider requests at four.
- State writes use a same-directory temporary file, `fsync`, rename and a previous valid backup. Corrupt primary state is quarantined and restored from the backup. If both copies are invalid, startup fails. Rooms, inventory, deaths, loot, turn order, deadlines and tokens are persisted in the state snapshot.
- SSE publishes private room views over an authenticated stream. Refresh reconnects with the saved token. Timers and turn order live on the server. The timer currently uses a fixed 60 second combat duration; the full dialogue/reaction/trap policy is pending.
- Mechanical combat commits before AI narration. A provider failure falls back to deterministic text. Party speech transport is not implemented; only routed event TTS is available.
- The minimum objective is reaching the authored final anchor in addition to progress. Threat defeat is tracked separately. Geometry uses ordered adjacent anchors and distance checks; complex obstacles and line-of-sight remain future work.
- Market fees are `floor(price * 25 / 1000)` KAI. At a price of 1 KAI the fee is 0. Items retain serial and provenance.

## Media

The repository has a music manifest but does **not** contain the MP3 pack or five JPG backgrounds. Source CI checks the manifest schema and authored data. `npm run validate:release-media` checks the actual pack and intentionally fails until it is supplied. The UI renders gradient and image fallback styling; missing music is silent. Do not publish a media-complete release based solely on source CI.

## Remaining blockers for canonical `main`

- Browser E2E has not run in the current environment because Playwright Chromium could not be downloaded; the CI job must run successfully on GitHub.
- CI/branch protection and a safe merge to `main` have not been observed or performed.
- Session creation is not Sybil resistant. Display-name spoofing no longer grants account access, but a fresh token can create a fresh profile and starter balance. Economy distribution must gain host admission or durable account proof before public deployment.
- State uses a JSON snapshot and synchronous writes. It is fit only for small LAN alpha sessions; database transactions, multi-process locking, quotas and backups off-host are pending.
- Range, cooldown and stun/slow work for the current single hostile encounter. Full multiple-target AoE, complex visibility, NPC turns, all affix categories and timer type variants are pending.
- Release media, full voice streaming and robust provider network egress pinning are pending.
