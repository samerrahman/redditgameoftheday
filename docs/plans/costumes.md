# Plan: Real Costumes (not just recolours)

## Where we are

- **Outfits** are a colour tint over the existing hero sprite (`CosmeticDef.tint`).
- **Hats/accessories** are shapes drawn in code on top of the hero (crown, halo, bunny ears, antenna, flame ring, trail).
- The hero is a 20×20 pixel sprite from a CC0 asset pack. It has idle (4 frames), run (4), dash (2) and charge (2) animations.

Recolours feel cheap for a gacha reward, and the code-drawn hats don't move with the hero's animation.

## Goal

Costumes that look like **new outfits**: different silhouettes, hats that bob with the walk cycle, capes, and a few epic "full transformation" skins. Every costume must show up correctly in three places: in the dungeon, in the shop's character preview, and on the gacha reveal card.

## Approach: layered "paper doll" sprites (recommended)

Instead of redrawing the whole hero for every costume, split the character into layers that share the same animation frames:

| Layer | Examples | Drawn |
|---|---|---|
| **Body** (base) | Default hero, or a full replacement for epic skins | always |
| **Outfit** | Knight armour, wizard robe, ninja garb, chef whites | over body |
| **Head** | Crown, wizard hat, viking helm, bunny ears, halo | over outfit |
| **Back** | Cape, wings, backpack | behind body |
| **Aura** (code FX) | Flame ring, neon trail, sparkles | existing particle code |

Each layer is its own **20×20 sprite sheet with the same 12 frames** as the hero (idle 4 · run 4 · dash 2 · charge 2). In Phaser, each layer is one extra sprite that copies the hero's position, flip and current frame number every tick, so everything stays aligned automatically. Head items bob with the run cycle because they're drawn per frame.

**Why layers instead of full sprite sheets per costume:** one 12-frame layer is roughly 30–60 minutes of pixel work, compared with 3–4 hours for a full re-draw. Players can also mix and match (wizard hat + knight armour), which multiplies the variety from the same art.

### Rarity → art investment

| Rarity | What you get | Art cost |
|---|---|---|
| Common | Palette swap of an existing outfit layer (keep tints for these) | minutes |
| Rare | New head or back layer (hat, cape, wings) | ~1 hour |
| Epic | Full outfit + matching head + an aura effect, or a whole new body | 3–5 hours |

## First batch (8 costumes)

| Name | Rarity | Layers |
|---|---|---|
| Knight Plate | Rare | outfit (steel armour) + head (visor helm) |
| Wizard Robe | Rare | outfit (robe) + head (pointy hat) |
| Viking | Rare | head (horned helm) + back (round shield) |
| Royal Cape | Rare | back (red cape that flutters on run frames) |
| Ninja | Epic | outfit + head (mask) + aura (smoke puffs on dash) |
| Skeleton | Epic | full body replacement |
| Snoo Suit | Epic | full body (orange-white Reddit mascot-style suit, original art, not the official Snoo) |
| Chef | Common→Rare | outfit (whites) + head (toque) |

The existing code-drawn hats stay as Commons until they're redrawn as proper head layers.

## Art pipeline

1. **Tool:** Aseprite (or free LibreSprite/Piskel). Start from a template file containing the base hero's 12 frames on a locked layer, so new layers line up exactly.
2. **Palette:** use the asset pack's palette (plus 2–3 accent colours) so costumes match the dungeon.
3. **Export:** one horizontal strip per layer (`knight_outfit.png`, 240×20), named `<costume>_<layer>.png`.
4. **Pack:** add the strips to the existing atlas with a texture packer (free-tex-packer or TexturePacker), keeping frame names `knight_outfit_idle_0 … _charge_1`.
5. **Licensing:** all new art must be original or CC0. Keep a `public/assets/costumes/CREDITS.md` file.

## Code changes

1. **Data model** (`shared/shop.ts`):
   ```ts
   type CosmeticDef = {
     id; title; rarity;
     slot: 'outfit' | 'head' | 'back' | 'aura';   // replaces 'costume' | 'accessory'
     layer?: string;   // atlas frame prefix, e.g. 'knight_outfit'
     tint?: number;    // still supported for common recolours
     fx?: 'flame_halo' | 'neon_trail' | 'smoke';
   };
   ```
   The profile gets one equipped id per slot (`equipped: { outfit, head, back, aura }`). `normalizeProfile` migrates the current `equippedCostume`/`equippedCosmetic` fields.
2. **Game rendering** (`DungeonScene.ts`): create one sprite per equipped layer at depth hero−1 (back) or hero+1/+2 (outfit/head). In `syncPlayer`, mirror the hero's frame name, using the suffix (`_idle_2`) to choose the layer frame.
3. **Shop preview** (`ui/heroPreview.ts`): draw layers in the same order from the atlas, so the preview and the game always match.
4. **Shop UI:** the wardrobe gets one row per slot (Outfit / Head / Back / Aura). The gacha pool now includes layers.
5. **Tests:** every cosmetic's layer has all 12 frames in the atlas JSON (catches export mistakes), migration of old saves, and equipping per slot.

## Milestones

| Step | Scope | Rough size |
|---|---|---|
| 1 | Layer rendering system + data model + migration, tested with 1 placeholder layer | 1 day |
| 2 | Template file + export/pack script, documented | 0.5 day |
| 3 | First 4 rare costumes (art) | 4–6 hours of art |
| 4 | Wardrobe slots UI + preview using layers | 0.5 day |
| 5 | 2 epics (Ninja aura, Skeleton body) | 1 day of art |
| 6 | Replace code-drawn hats with real head layers | 2–3 hours of art |

## Open questions

- Who's drawing? If neither of us does pixel art, an 8-costume pack is a common small commission; layers are usually quoted per item.
- Should costumes ever affect the hitbox or visibility? (Recommendation: never. Cosmetics stay purely cosmetic.)
- Seasonal or limited costumes (e.g. a holiday hat) to drive daily logins?
