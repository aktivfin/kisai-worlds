# Project status

## Visual implementation 0.7

The generated concept direction is now represented by a real interactive UI layer rather than baked screenshots:

- cinematic dark-blue / amber design tokens and top HUD;
- interactive world-event map with positioned event nodes;
- selected-event detail rail with fixed difficulty, entry, duration and reward metadata;
- six-hour rotation countdown;
- responsive card fallback for smaller screens;
- expedition lobby with living-character roster and limited at-risk backpack;
- gameplay HUD with progress, server d20 result, voice dock, scene loot and extraction state;
- account economy/crafting/market screens aligned to the same component system;
- graceful media fallbacks until the real cinematic asset pack is committed.

Source validation for this UI pass:
- `npm run check` — PASS;
- `npm run validate:ui` — PASS;
- `npm run test:smoke` — PASS.

The separate Required media CI job is still intentionally blocked by the missing production JPG/MP3 files.

Current baseline: **KisAI Worlds classless extraction-RPG prototype 0.8.0**.

## UX hardening 0.7.2

Additional client hardening completed:
- truthful push-to-talk states instead of claiming continuous party voice;
- server-provided bounded action log in the gameplay rail;
- connection/offline indicator and non-toast offline banner;
- live expedition backpack capacity preview with over-cap blocking;
- working KAI wallet shortcut;
- real character confirmation action instead of a toast-only fake button;
- working inventory rarity/equipped filters and market search;
- richer unique-item inspector with serial, adaptive origin, enchantments and provenance;
- crafting ingredient owned/required counts;
- restrained main-menu preview motion with reduced-motion support.

## Character & Combat Core 0.8

Implemented:
- classless characters with six universal attributes;
- dynamic skills separated from attributes;
- repeated relevant actions accumulate practice and can create/rank-up skills under a level cap;
- server-derived HP, evasion and initiative;
- player-authored ability fantasy translated into server-owned mechanical definitions;
- finite named charge/resource pools shared by abilities (Mana / cursed-energy-like / technique energy);
- server-side charge spending before the attack roll, including charge loss on a miss;
- expedition-start resource refill and explicit insufficient-resource rejection;
- development-point resource-capacity upgrades (+2 max per upgrade);
- level-up grants development points; players spend them to modify or create abilities through the budget engine;
- the lobby exposes that development flow directly as a player-authored ability prompt;
- deterministic hit formula: d20 + accuracy vs target evasion;
- armor is damage absorption, not hit chance;
- targeted attacks raise the hit threshold;
- damaged armor sections can provide reduced effective armor;
- weapon and armor durability/condition/defects;
- weapon condition now changes resolved damage/accuracy instead of being cosmetic;
- injuries generated only after the mechanical result;
- canonical hostile combatants with HP/evasion/armor;
- two-way combat exchange: surviving enemies counterattack through the same resolver;
- player HP reaching zero feeds the existing permadeath/death-drop pipeline;
- healing consumables restore wounds and HP;
- Narrative Engine receives committed facts after mechanics and cannot override them.

Verification now includes `npm run test:combat` before the full extraction smoke.

## Current gameplay core

The game is now structured around paid / subscription-backed AI expeditions rather than a generic RPG lobby.

Implemented:
- world map with 3–9 active events rotating every 6 hours from a 9-event catalog;
- fixed event danger tier and server DC; difficulty never scales down for a smaller party;
- 1–5 player expeditions;
- per-player event access gate;
- three base living-character slots;
- permanent character death with dead-character history and slot release;
- persistent level/XP;
- account stash separated from the limited expedition backpack;
- only carried expedition items are at risk on death;
- server-authoritative d20 checks, criticals, wounds and death;
- underfilled-party reward multiplier for XP and guaranteed unique completion loot;
- behavior/build-adaptive unique equipment with immutable serial and provenance;
- consumable-only crafting outside expeditions;
- enchanting only inside eligible adventures at a physical forge/altar anchor;
- deterministic ingredient effects and forge-tier enchant quality;
- scene loot recovery by surviving party members;
- final extraction into the account stash;
- player-priced KAI secondary market with 2.5% prototype fee;
- STT -> GM -> TTS turn pipeline;
- canonical scene geometry / personal POV foundation;
- Epic+ generated item visual cards.

Canonical mechanics are documented in `GAMEPLAY_ECONOMY.md`.

## Verification

The source/runtime CI lane runs:
- `npm run check`
- `npm run validate:ui`
- `npm run test:combat`
- `npm run test:smoke`

The smoke test now covers:
- event rotation;
- three-slot enforcement;
- consumable crafting;
- expedition loadout limits;
- fixed event DC;
- consumable use;
- objective completion and extraction;
- XP + guaranteed unique rewards;
- user-defined market price;
- per-player paid-event entitlement consumption;
- adventure-only forge movement and enchantment resolution;
- permanent death;
- dropped unique-item recovery by an ally;
- extraction of the recovered item;
- one-active-expedition-per-account invariant.

Current source/runtime lane: PASS.

## Remaining bootstrap media blocker

The separate `Required media` CI job remains red until the real project binaries are committed:
- adaptive soundtrack MP3 files under `public/audio/`;
- required cinematic JPG files under `public/assets/`.

This media failure is intentionally separate from source/runtime correctness.

## Prototype boundaries

- Browser/LAN vertical slice; not a Steam executable yet.
- Rooms are in memory and disappear on server restart.
- Profiles/economy use local JSON prototype persistence, not a production database.
- Paid-event prices and subscription/slot products are modeled, but real checkout + webhook entitlements are not wired yet.
- Promotional run tickets exist for prototype testing.
- KAI is an off-chain game currency with no cash-out.
- Push-to-talk voice works; continuous party voice transport is not implemented.
- Personal POV currently exposes canonical camera/visibility state; full fast scene-image regeneration is still pending.

## Next milestone

1. Import the real visual/audio binaries.
2. Persist rooms/accounts/market in a production database.
3. Add payment/subscription entitlement integration.
4. Finish fast canonical-frame generation + personal POV rendering.
5. Harden reconnect, multiplayer voice and long-session world state.
