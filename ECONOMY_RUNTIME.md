# KisAI Worlds 0.4 — Economy Runtime

## Ownership model
Every physical item is a unique instance with `item.id`, `serial`, rarity, level, affixes and `provenance[]`.

## Rarity tiers
- common
- uncommon
- rare
- epic
- relic
- mythic

Boss/discovery context adds a positive rarity roll boost. Item stat budget remains level-aware.

## KAI farming
KAI is a demo off-chain token ledger. Meaningful turns award KAI until the daily cap. Very short turns and recently repeated normalized actions award 0 KAI. Boss/discovery states can add a reward bonus.

## Secondary market
- seller chooses price;
- item leaves inventory into market escrow;
- buyer pays KAI;
- seller receives price minus 2.5% fee;
- item serial/provenance survive the trade;
- own listings can be cancelled.

## Character death
When a character dies:
- all inventory items are removed from the dead profile;
- all active listings belonging to that profile are cancelled-on-death and pulled out of escrow;
- all owned items are placed into a room-scoped loot pile tied to the current `sceneId`;
- dead players are skipped by turn order;
- living party members may claim items one by one;
- claimed items immediately become part of the claimant's persistent profile;
- on `scene_transition=true`, all still-unclaimed items from the previous scene are marked lost permanently.

This creates real item loss without letting a market listing act as an insurance vault.

## Character-adaptive unique loot (0.5)
Adventure loot uses a two-stage pipeline:
1. authoritative server rolls rarity and level-aware power budget;
2. item identity is generated from the recipient character build.

Character context includes archetype, concept, skills, abilities, weakness and current level. Slot affinity is weighted toward the actual build, while stat allocation is clamped by the server. If an LLM is configured it may create the item's name, lore, passive concept and visual prompt, but it cannot increase the numeric budget.

The generated item stores an immutable `adaptiveFor` snapshot and build fingerprint. Ownership changes never reroll the item. A sword originally generated around one dead character may therefore be valuable, awkward or unusually synergistic for a later owner; this is intentional and gives the secondary market meaningful unique artifacts.
