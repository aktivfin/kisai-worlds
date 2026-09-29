# Project status

Current baseline: **KisAI Worlds Windows/Linux Demo 0.6.1**.

## Implemented
- Multiplayer lobby and turn flow.
- AI-assisted character creation with level-budget adaptation.
- Real-player microphone capture plus STT -> GM -> TTS loop.
- Adaptive soundtrack with 14 scene states, crossfades and speech ducking.
- Inventory/equipment, rarity tiers, KAI test ledger and secondary market.
- Death drops inventory + market escrow into the scene; abandoned loot is lost.
- Unique character-adaptive item generation with immutable provenance.
- Cinematic menu transitions and integrated cover art.
- Windows and Linux installers/launchers with local-only config creation.

## Visual assignment
- menu_world.jpg -> main menu hero.
- lobby_tavern.jpg -> join/lobby.
- character_creator.jpg -> character creator and arsenal mood.
- game_harbor.jpg -> canonical gameplay frame.
- gm_tavern.jpg -> secondary GM/cinematic frame.
- concept_sheet.png -> production reference only.

## Prototype boundaries
- KAI remains off-chain test currency only.
- Browser/LAN vertical slice, not yet a final Steam executable.
- Generated images do not yet enforce full master-frame -> per-player POV geometry.

## Next milestone
0.7: canonical scene geometry, personal POV rendering, generated visual cards for Epic+ items, stronger persistence and internet-grade voice transport.
