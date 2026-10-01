# KisAI Worlds architecture

KisAI Worlds is currently a Windows/LAN vertical slice built around a local Node.js server and browser client.

## Runtime layers

- **Party runtime** — rooms, players, turn order, ready state.
- **Character runtime** — classless CharacterState with six attributes, dynamic skills, injuries, development points, finite named resource pools and server-balanced AbilityDefinitions.
- **Intent Interpreter** — LLM/fallback maps free-form player language to semantic intent; it never owns final numeric results.
- **Rules Engine** — deterministic checks, hit/evasion, damage, armor absorption, ability budgets and server dice.
- **World Simulator** — HP, injuries, equipment durability/defects, hostile combatants, canonical scene state and item/world mutations.
- **Narrative Engine** — receives already committed mechanics and renders narration without changing outcomes.
- **World/GM runtime** — scene progression, movement anchors, loot relevance and music-state selection.
- **Voice runtime** — microphone capture, real-player voice relay, STT, GM response and TTS.
- **Media runtime** — optional image generation for key scenes.
- **Audio director** — context-driven adaptive soundtrack with crossfades and speech ducking.
- **Economy runtime** — KAI off-chain ledger, inventory, equipment, unique-item provenance and secondary market.
- **Loot runtime** — character-adaptive item birth with server-controlled rarity/power budget.

## Trust boundaries

LLMs are used for interpretation, naming, lore, narration and creative item/scene descriptions. Numeric balance, checks, hit/miss, HP damage, armor, durability, injuries, ability budgets, ownership, rarity budget, market transfers, death drops and item identity are deterministic server authority. Narration is generated only after mechanics commit.

## Target evolution

The next production layers are a desktop shell/engine build, persistent accounts/storage, Steam networking or WebRTC voice, authoritative world state, personal POV scene rendering and hardened marketplace/economy services.


## Resource authority

Ability resource use is deterministic server state. AbilityDefinitions may reference a named resource pool and cost. The server validates and spends charges before resolving d20, persists the remaining pool, refills configured expedition resources when a new run starts, and owns capacity upgrades. The LLM may describe the fantasy of the resource but cannot add charges, waive costs or refill it.
