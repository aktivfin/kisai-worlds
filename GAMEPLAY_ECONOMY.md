# KisAI Worlds — canonical extraction RPG mechanics

This document is the gameplay source of truth for the current prototype.

## 1. Product loop

1. The player opens the world map.
2. The map exposes 3–9 active events from the event catalog.
3. The active set rotates every 6 hours.
4. The player chooses one living character and prepares a limited expedition backpack from the account stash.
5. Every participant must have access to the event: free event, paid run entitlement / promo ticket, or an active subscription.
6. The party enters with 1–5 characters. Event difficulty never scales to party size.
7. Player speech/text becomes an action. The AI GM proposes intent/context, but the server owns difficulty, d20, damage, death, loot, inventory and economy.
8. Surviving characters extract carried loot after objectives reach 100%.
9. Extracted items return to the account stash and may be used, carried into another event, enchanted in an eligible event, or listed on the player market.

## 2. Event map and fixed difficulty

Each event defines:
- `danger_tier`
- recommended party size
- duration
- entry model and displayed one-run price
- base XP
- loot tier
- optional enchantment facility
- canonical scene geometry and anchors

Difficulty belongs to the event. It does not use party-size scaling or player-level scaling.

Current server DC baseline:

`DC = clamp(7 + danger_tier * 2 + difficulty_shift * 2, 7, 19)`

The GM may propose only a small contextual shift (-1 / 0 / +1). Party size cannot change DC.

A solo player may enter content recommended for five players. The danger remains identical.

## 3. Party-size risk and reward

Party size is 1–5.

Underfilled successful runs receive a reward multiplier:

`underfill = clamp(recommended_players / participants_at_start, 1.0, 2.5)`

It currently affects:
- completion XP;
- number of guaranteed unique completion items (1–3).

This creates the intended risk/reward loop: fewer players do not make the dungeon easier, but successful extraction is more valuable.

## 4. Access / monetization model

Access is checked independently for every participant before the run starts.

Supported entitlement sources:
- free event;
- active subscription;
- one-run entitlement / promotional ticket in the prototype.

The event catalog carries prototype one-run prices. Production checkout is deliberately not implemented in this repository; final prices remain configurable, and a payment provider must grant server-side entitlements after successful payment.

Character-slot purchase is represented in the store model but also requires production billing integration.

No gameplay item is sold directly by KisAI for real money.

## 5. Characters and permadeath

Base account limit: 3 living character slots.

A living character stores:
- immutable character id;
- level and XP;
- archetype, skills, abilities and concept;
- run/win history;
- alive/dead status.

Dead characters remain in account history but can never be selected again. Death immediately frees one living slot.

Additional slots are a monetizable entitlement.

## 6. Account stash vs expedition backpack

The account stash is the persistent collection and is not destroyed when a character dies.

The expedition backpack is intentionally small. Character capacity starts at 6 slots, gains +1 every five levels and has a hard character cap of 10. The actual run capacity is `min(character_capacity, event.inventory_slots)`, so an event may impose a stricter preparation limit.

Only items explicitly transferred into the expedition backpack are at risk.

Stackable materials and consumables consume capacity according to quantity. Equipment consumes its own slot cost.

The server validates the complete loadout before any access entitlement or stash item is consumed.

An account may participate in only one active expedition at a time. This prevents concurrent-run stash/economy exploits and keeps one authoritative risk state per account.

## 7. Resolution and dice

The AI GM is a planner, not the authority for mechanics.

For an action it may propose:
- whether a check is required;
- relevant skill;
- contextual difficulty shift;
- danger classification (safe / risky / lethal);
- canonical movement anchor;
- narration variants;
- music state;
- possible loot relevance.

The server rolls d20 and calculates the result.

Natural 20: automatic success.
Natural 1: automatic failure.

Failures on lethal actions add wounds.
A lethal critical failure may add two wounds.
Risky critical failures may add a wound in higher-tier events.
At 3 wounds the character dies permanently.

The client only animates the server-provided result; it never chooses the dice value.

## 8. Death, dropped gear and rescue

On death:
- the permanent character is marked dead;
- the account stash stays safe;
- every item currently in that character's expedition backpack drops into the canonical scene;
- surviving party members may pick those exact item instances up if they have backpack capacity;
- if nobody survives, scene loot is lost;
- loot left behind at final extraction is lost.

This allows another player to recover a dead character's unique or enchanted item and later extract it.

## 9. Loot generation

Equipment is unique per item instance.

The generation context uses:
- event danger tier;
- character level/build;
- dominant skills;
- recent behavior tags derived from the run;
- server-controlled rarity and numeric power budget.

The LLM does not set arbitrary power.

Every unique item has:
- immutable id and serial;
- provenance history;
- event tier;
- adaptive character/build snapshot;
- optional immutable visual card;
- enchantment history.

Successful extraction always awards unique equipment. Additional materials/equipment may be discovered during the run.

## 10. Crafting

Crafting is intentionally narrow and deterministic.

It is available only outside an active expedition.

Craftable outputs are consumables such as:
- healing;
- traversal tools;
- escape tools;
- temporary roll bonuses.

Equipment is not crafted in the account menu.

Recipes and material costs are deterministic and visible to players.

## 11. Enchanting

Equipment cannot be enchanted from the account menu.

Enchanting requires:
1. an active event that contains an enchantment facility;
2. physically reaching its canonical scene anchor;
3. carrying the target equipment in the limited backpack;
4. carrying known enchantment ingredients in the same backpack.

Ingredient effects are deterministic and learnable. Examples include fire, frost, drain and shock families.

The resulting enchantment quality depends on:
- facility / forge tier;
- server d20 check;
- character Intelligence/Will modifier;
- critical success.

Ingredients are consumed by the attempt, including failed attempts.

The base item remains the same unique item: serial and provenance do not reset.

## 12. Extraction

An expedition can be extracted only after objective progress reaches 100%.

For every living player:
- carried run items are moved to the account stash;
- guaranteed unique completion loot is created;
- XP is granted with the underfill multiplier;
- level-ups are applied;
- win history is updated.

Dead players receive no extraction reward.

## 13. Player market

The market trades actual equipment instances, including enchanted unique items.

The seller chooses the KAI price.

Current prototype fee: 2.5%.

Market listings preserve:
- serial;
- provenance;
- adaptive origin;
- enchantments;
- visual card.

Trading and crafting are blocked while that account is in an active expedition.

KAI is currently an off-chain game ledger with no cash-out.

## 14. Current prototype boundaries

Implemented gameplay core:
- rotating event map;
- 1–5 player rooms;
- fixed event difficulty;
- persistent character slots;
- permadeath;
- limited expedition backpack;
- consumable crafting;
- server d20 checks and wounds;
- extraction;
- behavior-adaptive unique loot;
- in-adventure enchanting;
- player-priced secondary market;
- STT -> GM -> TTS path;
- canonical scene/POV foundation.

Still production work:
- real billing provider and entitlement webhooks;
- database-backed accounts/market transactions;
- reconnect/host migration;
- persistent rooms across server restart;
- full visual scene-generation pipeline;
- continuous party voice;
- anti-cheat/abuse/market concurrency hardening;
- production deployment/observability/backups.


## 15. Classless Character & Combat Core 0.1

Characters have no fixed classes, races or mandatory skill trees. The player's fantasy is free-form; the server owns mechanical power.

### Attributes

Every character has six universal attributes in the working range -3..+4:
- Strength
- Agility
- Endurance
- Perception
- Intelligence
- Charisma

Non-combat checks use:
`d20 + attribute + matching dynamic skill + explicit server bonus >= DC`

The Intent Interpreter chooses semantic relevance from the way the player acts, not from a single keyword. A threat may therefore resolve through Charisma + Intimidation or Strength + Intimidation depending on the described method.

### Dynamic skills

Skills are not a fixed global list. CharacterState keeps `dynamicSkills` plus a server-side practice ledger. Repeated relevant actions can create a new skill; further practice may rank it up, with the maximum rank gated by character level.

### Combat values

The deterministic combat layer stores:
- `hp_current / hp_max`
- `evasion`
- `initiative`
- optional resources
- injuries

Hit resolution:
`d20 + accuracy >= target evasion`

Natural 20 hits automatically. Natural 1 misses automatically.

Armor is separate from evasion:
`hpDamage = max(minDamage, rawDamage - effectiveArmor)`

Weak attacks may deal 0 HP damage while still wearing the armor.

### Targeted attacks

A player may name a body/equipment area. The Rules Engine raises the target evasion according to precision difficulty. A damaged breach can reduce local armor, producing the trade-off:
harder to hit -> potentially better penetration.

Narrative declarations such as "I cut off his head" never guarantee the result. The final description is produced only after hit, damage, armor, remaining HP, injury and death state are known.

### Durability and local defects

Equipment stores physical state:
- durability 0..100
- condition category
- material
- local damage / defects

Condition bands:
- 80–100 intact
- 60–79 worn
- 40–59 damaged
- 20–39 badly damaged
- 1–19 critical
- 0 destroyed

Effective armor scales down with durability. Local cuts/breaches can reduce protection further. Wear depends on damage type and material rather than a fixed "per hit" subtraction.

Weapons use the same physical-state model. Hard impacts against armor wear weapons more strongly than soft targets.

### AbilityDefinition and level budget

A player may name an ability however they want. The server converts the fantasy into an `AbilityDefinition` containing supported mechanics such as damage die, range, targets, damage type, accuracy, cooldown/control and costs.

At level 1, even extreme names such as "destroy reality" remain inside the level-1 budget. The name never grants mechanical power.

Level-ups grant development points. Outside an active expedition the player may spend one development point to:
- modify an existing ability while preserving its identity/history; or
- create a new ability if the level-based ability-slot cap allows it.

The client sends the player's idea; `AbilityBalanceEngine` owns final numbers.

### Four-stage authoritative pipeline

`PLAYER INTENT -> Intent Interpreter -> Rules Engine -> World Simulator -> Narrative Engine`

The LLM may interpret intent and later narrate facts. It cannot invent or override dice, DC, hit/miss, damage, armor, durability, HP, injuries, death, ownership or economy state.

### Runtime combat exchange

Canonical scenes contain hostile combatants with their own CharacterState-like combat state and equipment.

A player attack:
1. selects target / target area / ability;
2. resolves d20 + accuracy vs evasion;
3. rolls server damage;
4. resolves local effective armor;
5. applies HP damage;
6. applies armor and weapon wear;
7. creates injuries when mechanically justified;
8. updates canonical combatant state;
9. generates narration from the committed result.

If the target survives, it may resolve a counterattack through the same deterministic resolver against the player's HP/evasion/carried armor. If player HP reaches zero, existing permadeath and expedition death-drop rules apply.
