# Plan: Different Bosses

## Where we are

Every floor ends with the same boss, **The Threadkeeper**. It has two attacks, a radial bullet ring and a leap slam, and spawns adds at half health. Deeper floors only make it tankier and hit harder, so floor 6 plays like floor 1 with bigger numbers.

## Goals

- **Every floor feels new.** You shouldn't fight the same boss twice in a row.
- **Same boss for everyone.** Today's bosses come from the daily seed, so players can compare notes ("floor 3's Mirror Knight was brutal").
- **Readable in a 5-minute game.** Each boss has 2–3 attacks, every attack has a clear 0.5–0.8s warning, and a fight lasts about 30–60 seconds.
- **Weapon-agnostic.** Every boss has to be beatable with every weapon, including staffs (which can't stun) and daggers (very short reach).

## Boss roster (first batch of 6)

Each boss reuses sprites already in the atlas (boss, cyclops, warden, wizard, slime), with a tint and larger scale, so no new art is needed to ship the first batch.

| Boss | Sprite base | Core idea | Attacks | Phase 2 (≤50% HP) | Counterplay |
|---|---|---|---|---|---|
| **Threadkeeper** (existing) | boss | Ranged pressure + gap closer | Radial bullet ring · leap slam | Spawns 2 chasers | Dodge through ring gaps, punish the landing |
| **Slime King** | slime ×2.5, green | Splits when hurt | Bounce-slam with a shadow marking where it lands · slime puddles that slow you | At 66% and 33% splits into 2 smaller kings | Kill the splits fast; they share an HP pool |
| **Mirror Knight** | warden, silver | Punishes button mashing | Shield stance that reflects projectiles · triple-dash combo | Throws its shield like a boomerang | Wait for the stance to drop; staffs must time their shots |
| **Hex Weaver** | wizard ×2, purple | Arena control | Teleports between 4 spots · lays curse tiles that explode after 1s | Curse tiles chain into lines across the room | Keep moving; read the tile pattern |
| **Cyclops Brute** | cyclops ×2.2, red | Big telegraphed hits | Charge into walls (stuns itself) · ground-pound shockwave | Charges three times in a row, faster | Bait charges into walls for free hits |
| **The Hoard** | coin sprites + chest | Greedy gimmick boss | Spits coin volleys · drops fake chests that bite | Hides inside one of 3 chests (shell game) | Hits pay out bonus coins, rewarding aggression |

### Which boss on which floor

- Floors 1–2: pick from the **easy pool** (Threadkeeper, Slime King, Cyclops Brute).
- Floors 3–5: **any boss**, never the same as the previous floor.
- Floor 6+: any boss, plus one **modifier** from a small list (e.g. "Enraged: 20% faster", "Twin: two weaker copies", "Shielded: phase 2 starts with armour").
- Seeded with `createDailyStream(utcDate, 'floor-N-boss')`, so everyone gets the same lineup.

## Technical plan

1. **Data-driven boss definitions** — new `src/shared/game/bosses.ts`:
   ```ts
   type BossDef = {
     id: BossId;
     name: string;
     sprite: { base: 'boss' | 'cyclops' | 'warden' | 'wizard' | 'slime'; tint: number; scale: number };
     hp: number;               // before floor scaling
     patterns: BossPatternId[]; // attacks it cycles through
     phase2: { atHpPct: number; patterns: BossPatternId[]; onEnter?: BossEventId };
     pool: 'easy' | 'any';
   };
   ```
2. **Generalise the boss attack system.** Today `chooseBossPattern` only returns `boss_radial` or `boss_leap`, and `stepBossAI` has those two hard-coded. Turn each attack into a small handler with `telegraph(dt)`, `execute()` and `recover(dt)` steps, registered by `BossPatternId`. That way new bosses are mostly data plus one or two new attacks each.
3. **Floor generator** (`rooms.ts`): store the chosen `bossId` on the boss room blueprint.
4. **Rendering** (`DungeonScene.ts`): pick the sprite, tint and scale from `BossDef`, and draw each new attack's warning (curse tiles, landing shadow, charge line).
5. **HUD:** the boss health bar shows the boss's name. Add a 1s **boss intro card** ("FLOOR 3 · MIRROR KNIGHT") when you walk into the room.
6. **Tests:** same boss for a given date and floor, no repeats on consecutive floors, every pattern finishes its sequence, every boss is killable with each weapon in a scripted simulation within N seconds.

## Milestones

| Step | Scope | Rough size |
|---|---|---|
| 1 | Refactor existing boss into `BossDef` + pattern handlers (no gameplay change) | 1 day |
| 2 | Slime King + Cyclops Brute (reuse existing charge/slam code) | 1–2 days |
| 3 | Daily boss rotation + intro card + name on the health bar | 0.5 day |
| 4 | Mirror Knight + Hex Weaver (new attack types) | 2 days |
| 5 | The Hoard + floor 6+ modifiers | 1–2 days |
| 6 | Playtest pass: telegraph timing, HP per weapon, fight length | ongoing |

## Open questions

- Should a boss's first appearance unlock a "bestiary" entry? It's cheap retention, but it's another menu.
- Should the share comment name the boss you died to?
- Custom boss sprites later? See the art pipeline in [costumes.md](costumes.md), since the same tooling applies.
