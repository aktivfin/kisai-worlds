# KisAI Worlds — Adaptive Music Runtime 0.3

## State ladder

CALM: menu / lobby / explore / tavern
MYSTERY: investigation / discovery / ritual
PRESSURE: tension / dread / abyss
ACTION: chase / hell / boss
EMOTIONAL: grief

## Runtime rule

GM commits the scene result first, then returns `music_state` and `intensity`. The client reacts to that committed state; it does not choose music from the player's raw sentence alone. This prevents accidental music jumps when a player merely mentions a boss, death, ritual, etc.

## Voice priority

Speech is primary. Player voice and GM TTS trigger music ducking. Crossfades and ducking are client-side, so all players retain responsive local audio even when network polling is delayed.
