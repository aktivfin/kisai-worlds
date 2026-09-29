# KisAI Worlds architecture

KisAI Worlds is currently a Windows/LAN vertical slice built around a local Node.js server and browser client.

## Runtime layers

- **Party runtime** — rooms, players, turn order, ready state.
- **Character runtime** — AI-assisted character creation with server-side level/power budget validation.
- **World/GM runtime** — action resolution, structured scene state, narration and music-state selection.
- **Voice runtime** — microphone capture, real-player voice relay, STT, GM response and TTS.
- **Media runtime** — optional image generation for key scenes.
- **Audio director** — context-driven adaptive soundtrack with crossfades and speech ducking.
- **Economy runtime** — KAI off-chain ledger, inventory, equipment, unique-item provenance and secondary market.
- **Loot runtime** — character-adaptive item birth with server-controlled rarity/power budget.

## Trust boundaries

LLMs are used for interpretation, naming, lore, narration and creative item/scene descriptions. Numeric balance, ownership, rarity budget, market transfers, death drops and item identity must be validated by deterministic server logic.

## Target evolution

The next production layers are a desktop shell/engine build, persistent accounts/storage, Steam networking or WebRTC voice, authoritative world state, personal POV scene rendering and hardened marketplace/economy services.
