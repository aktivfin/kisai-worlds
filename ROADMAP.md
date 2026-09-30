# Roadmap

## 0.6 — scene / POV foundation
- [x] Canonical scene geometry and anchors.
- [x] Per-player position, eye-height and visibility descriptor.
- [x] Epic+ immutable item visual-card pipeline.
- [ ] Master-scene image -> constrained per-player rendered image pipeline.

## 0.7 — extraction RPG economy
- [x] 3–9 active events from a 9-event catalog.
- [x] Event rotation every 6 hours.
- [x] Fixed event danger tiers; no party-size difficulty scaling.
- [x] 1–5 player expeditions.
- [x] Per-player event access gate: free / subscription / run entitlement.
- [x] One active expedition per account.
- [x] Three base living-character slots.
- [x] Persistent level/XP and permanent character death.
- [x] Unlimited account stash vs limited character expedition backpack.
- [x] Server-authoritative d20 checks, DC, wounds and criticals.
- [x] Underfilled-party XP and guaranteed unique-loot multiplier.
- [x] Consumable-only deterministic crafting outside expeditions.
- [x] In-adventure enchanting at physical forge/altar anchors.
- [x] Deterministic enchant ingredient effects + forge-quality tiers.
- [x] Behavior/build-adaptive unique item instances.
- [x] Extraction, dropped gear recovery and left-behind loss.
- [x] Player-priced KAI secondary market preserving serial/provenance/enchantments.
- [x] End-to-end smoke coverage of slots, crafting, fixed DC, paid-party access, adventure enchanting, extraction, permadeath and ally recovery.
- [ ] Production billing provider + entitlement webhooks.
- [ ] Production database and concurrency-safe market ledger.

## 0.8 — session quality
- Streaming/low-latency STT and TTS.
- Continuous party voice channel.
- Better interruption and turn arbitration.
- Reconnect/session recovery and host migration.
- Internet-grade multiplayer transport.
- Persistent rooms across host/server restart.

## 0.9 — visual world and content tools
- Master scene -> fast generated canonical frame.
- Geometrically constrained personal POV frames.
- Scenario/event editor.
- NPC/location/media libraries.
- Event scheduling and live-ops tooling.

## 1.0 candidate
- Desktop/Steam build.
- Real accounts and durable cloud saves.
- Production payments/subscriptions.
- Anti-cheat / anti-farm / abuse controls.
- Observability, backups, load testing and economy hardening.
