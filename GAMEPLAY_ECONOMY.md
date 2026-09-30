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
