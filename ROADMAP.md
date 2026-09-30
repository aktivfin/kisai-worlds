# Roadmap

## 0.6 — scene/POV foundation
- [x] Canonical scene specification and stable world geometry for the bundled scenarios.
- [x] Per-player position, eye-height and visibility model.
- [x] Server-authored personal POV descriptor derived from the canonical scene.
- [x] Generated visual card pipeline for Epic+ unique items with immutable item identity.
- [ ] Master scene image -> geometrically constrained per-player rendered image pipeline.
- [ ] Persistent campaign scene mutations beyond the current session runtime.

## 0.7 — voice/session quality
- Continuous party voice channel.
- Streaming STT/TTS where the configured provider supports it.
- Better interruption and turn arbitration.
- Reconnect/session recovery and host migration.
- Internet-grade multiplayer transport.

## 0.8 — persistence
- Accounts and persistent characters.
- Durable campaign/world state.
- Server-backed inventory, market and provenance ledger.
- Database migrations and concurrency-safe market transactions.

## 0.9 — creator/campaign tools
- Scenario editor.
- KisAI character import.
- NPC/location/media libraries.
- Campaign packaging and sharing.

## 1.0 candidate
- Desktop/Steam build.
- Production multiplayer transport.
- Production observability, backups, abuse controls and economy hardening.
