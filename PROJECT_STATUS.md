# Project status

Current baseline: **KisAI Worlds Windows/Linux Demo 0.6.1**.

## Implemented in the current 0.6.1 branch
- Multiplayer lobby and turn flow.
- AI-assisted character creation with server-side level-budget adaptation and deterministic fallback.
- Push-to-talk microphone capture with STT -> GM -> TTS when providers are configured.
- Adaptive soundtrack state runtime.
- Inventory/equipment, rarity tiers, KAI test ledger and secondary market.
- Death drops inventory + active market escrow into the current scene; abandoned loot is lost on scene transition.
- Unique character-adaptive item generation with immutable serial, build snapshot and provenance.
- Canonical scene geometry for bundled scenarios.
- Per-player position, eye-height and personal POV visibility descriptor.
- Epic+ item visual-card generation with local immutable cache.
- Cinematic menu transitions and Windows/Linux launch/install paths.
- CI split into source/UI/runtime checks and required binary-media validation.

## Verification
The source/runtime lane currently checks:
- `npm run check`
- `npm run validate:ui`
- `npm run test:smoke`

The bootstrap remains incomplete until `npm run validate:assets` passes with the real project binaries.

## Remaining binary import
- 14 adaptive soundtrack MP3 files in `public/audio/`.
- 5 required cinematic JPG files in `public/assets/`.

## Prototype boundaries
- KAI remains off-chain test currency only.
- Browser/LAN vertical slice, not yet a final Steam executable.
- Party voice is turn-based push-to-talk, not a continuous internet voice channel.
- Personal POV is a canonical visibility/camera descriptor; full master-frame -> rendered per-player image consistency is not complete.
- Rooms are still in-memory session state; persistent profiles/economy are local JSON prototype storage.

## Next milestone
Finish the real media import, then continue 0.7 voice/session quality and complete the rendered master-scene -> personal-POV pipeline.
