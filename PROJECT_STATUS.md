# Project status

Current baseline: **KisAI Worlds Windows Demo 0.5**.

## Implemented
- Windows/LAN browser vertical slice.
- Multiplayer lobby and turn flow.
- AI-assisted character creation with level-budget adaptation.
- Real-player microphone capture plus STT -> GM -> TTS loop.
- Optional image generation.
- Adaptive soundtrack with 14 scene states, crossfades and speech ducking.
- Inventory/equipment tabs, rarity tiers, KAI test ledger and secondary market.
- Character death drops carried inventory and market escrow into the scene.
- Loot not recovered before scene transition is permanently lost.
- Unique character-adaptive item generation with immutable identity/provenance after creation.

## Important prototype boundaries
- KAI is off-chain test currency only; no real-money value or withdrawals are implemented.
- This is not yet a final Steam executable.
- Network/voice transport is prototype-grade LAN behavior, not production internet multiplayer.
- Generated images are optional and do not yet implement canonical master-frame -> per-player POV consistency.

## Next milestone
0.6 focuses on canonical scene state, player POV rendering, item visual generation for high rarity drops and stronger persistence boundaries.
