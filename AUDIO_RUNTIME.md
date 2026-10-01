# KisAI Worlds — Adaptive Audio & Multi-Voice Runtime 0.4

## Core rule

The Game Master is the voice of the game/system/world layer. It is **not** the actor for NPCs.

A turn is not a single TTS blob. Runtime output is an ordered event queue:

```yaml
events:
  - speaker: GM
    type: narration
    text: "Разрез проходит по наплечнику. Металл трескается."
  - speaker: SYSTEM
    type: mechanics
    damage: 5
    armor_absorbed: 3
  - speaker: NPC_ID
    type: dialogue
    emotion: panic
    text: "Он режет броню! Назад!"
  - speaker: GM
    type: timer
    text: "Твой ход."
    seconds: 60
```

The Voice Router maps each speakable event to its own voice profile. SYSTEM events are UI-only and never go to TTS.

## Voice layers

### GM Voice Profile
Campaign host selects one of 4–6 stable GM voices.

GM speech is:
- short;
- clear;
- neutral/restrained;
- scene description;
- consequences;
- rule/timer/state transitions.

GM must never perform an NPC voice or repeat an NPC line after it was spoken.

### Player Character Voice Profile
Characters may store one of ~10–15 reusable base voices plus a mode:
- `raw` — preserve wording as closely as possible;
- `character` — preserve intent while adapting delivery/style;
- `manual` — only exact player-authored text may be voiced.

The player owns the meaning. AI may not invent a new intent.

### NPC Voice Profile
Ordinary NPCs/mobs use reusable archetypes with stable identity per NPC.

Current profile metadata supports:
- provider voice;
- speed;
- pitch impression;
- roughness;
- emotion;
- volume;
- speech pattern.

Two NPCs may share a base provider voice but still carry different performance metadata.

### Unique Voice Profile
Bosses/key NPCs may receive a unique stable profile. Uniqueness is not synonymous with “deep demon voice”; it may be childlike calm, breathless precision, layered swarm speech, fixed pauses, etc.

## Voice Router invariants

- `GM/TIMER -> selected room GM voice`
- `NPC -> NPC voiceProfileId`
- `PLAYER -> character voiceProfileId`
- `SYSTEM -> no TTS`
- GM and NPC profiles are different profile classes and may not cross-route.
- NPC voice identity remains stable for the lifetime of that NPC.
- Voice selection never changes combat/world mechanics.

## Dialogue Director

Dialogue order is explicit. NPC speech is emitted as NPC dialogue events, not embedded as quoted text inside GM narration.

After an NPC line, GM may describe only new world state/action.

Bad:
- NPC: “Я ключ не отдам.”
- GM: “Он говорит, что ключ не отдаст.”

Good:
- NPC: “Я ключ не отдам.”
- GM: “Он убирает ключ во внутренний карман и делает шаг назад.”

## Runtime TTS

OpenAI-style TTS receives the routed provider voice plus profile performance instructions when supported.

ElevenLabs-style TTS receives its routed voice id and mapped voice settings where supported.

Unsupported performance properties remain metadata and must not break routing.

## Adaptive music priority

CALM: menu / lobby / explore / tavern  
MYSTERY: investigation / discovery / ritual  
PRESSURE: tension / dread / abyss  
ACTION: chase / hell / boss  
EMOTIONAL: grief

World/combat result commits first, then `music_state` and `intensity`.

Speech has priority over soundtrack. Routed speech queues trigger local music ducking until the speakable queue is complete.

## Current boundary

Push-to-talk -> STT -> intent/rules/world -> voice-event queue -> routed TTS is implemented.

Continuous party voice transport and true simultaneous overlapping NPC spatial audio are still later production work. The event schema is designed so those features can be added without making GM own NPC speech.
