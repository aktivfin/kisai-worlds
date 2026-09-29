# Contributing to KisAI Worlds

## Development flow

- `main` is kept runnable.
- Create a short-lived feature branch for non-trivial changes.
- Run `npm run check` before merging.
- Never commit API keys. Runtime secrets belong in `data/config.json`, which is ignored.
- Keep gameplay state authoritative on the server; LLM output may propose narrative content but must not directly bypass balance/economy validation.

## Core invariants

1. Unique items keep the same identity, serial, stats and provenance after transfer.
2. Adaptive loot is specialized only at item birth; it never rerolls for a buyer or looter.
3. Character death drops carried inventory and market escrow into the physical scene.
4. Uncollected death loot is destroyed when the party leaves the scene.
5. Real-player voice remains distinguishable from GM/TTS narration.
6. Adaptive music follows structured scene state and ducks under speech.
