# KisAI Worlds 0.9 development status

This branch is an incremental implementation of the Authoritative World & Encounter Engine roadmap. It is not the completed 0.9 milestone.

## Implemented here

- Scene loot has persisted world placement (scene, position, anchor, radius, dropper, visibility and state). Death drops use the dead player's location. Pickup requires the actor's turn, a visible item, proximity, capacity and an active run; it advances the turn. Extraction marks unclaimed loot lost.
- NPCs take a mechanical encounter phase after text, combat, pickup, item use, enchanting and turn timeout. They can move one anchor towards the nearest living player, attack in range, or skip an action under stun. Slow changes attack accuracy. Mechanical results commit independently of GM narration.
- Required scenario objectives now have explicit `ACTIVE`/`COMPLETED` states and completion conditions. `progress` remains display data; extraction checks the objective state. Existing rooms migrate the older objective format.
- Perception filters anchors, NPCs, physical loot, distant action logs, scene narration and SSE voice events per player. Hidden NPC speech is excluded from other players' voice payloads.
- Timer policies include COMBAT, DIALOGUE, REACTION, TRAP, CRITICAL and untimed EXPLORATION. Action payload receipt is checked against the server deadline before STT/LLM work.
- Action IDs are recorded durably as `accepted` before mechanics and `committed` with the room revision. A retry of an accepted ID is rejected to avoid duplicate mechanics after a crash. Profile equip and unequip are blocked during an active run. New anonymous profiles start with zero event tickets.

## Still needed for milestone 0.9

- General authored objective graphs (puzzles, escort, survival, negotiation, failure paths, dependencies) and scenario validation. Current authored scenarios use ReachArea plus optional KillTarget.
- Full environment and NPC decision repertoire: cover, fleeing, object interactions, hazards, morale and knowledge. NPC movement currently follows the ordered anchor list and chooses the nearest living player.
- Perception history stored at event time for every event type, sound zones and private perception memory. Legacy room logs have less precise origin data.
- Full action cost policy for every equipment interaction and more tactical NPC decisions.
- Durable response replay for action IDs and long-running recovery policy for accepted actions. Current fail-closed rejection prevents a duplicate, but a lost HTTP response cannot be replayed.
- Multi-client browser E2E on CI and restart/chaos coverage of each encounter phase are required before declaring this milestone complete.

Test fixtures can seed tickets only when `KISAI_TEST_DICE`, `KISAI_TEST_TICKETS` and an explicit `KISAI_STATE_FILE` are set. Ordinary anonymous sessions receive zero tickets.
