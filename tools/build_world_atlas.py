#!/usr/bin/env python3
"""
Builds the unified "Hearth & Slate" 16x16 world, weapon, relic, prop, hero,
legacy creature, and 32x32 boss atlas for Dungeonle.

All sprites share:
  - Unified charcoal-slate ink outline: #14131a (zero pure #000000 anywhere)
  - Calm low-contrast Stone Crypt flagstones (L 15-22%) so actors & hazards pop in 50ms
  - Crisp binary 2-state spikes (spikes_0 = flat recessed plate OFF, spikes_1/2 = bright steel+crimson ON)
  - Warm oak & forged gold interactive props; cool sky/bone/steel hero separation
  - Exact 1:1 native pixel grid (512x236 atlas preserving every frame rect for shopView/atlasIcon/tests)

Outputs:
  - public/assets/dungeon/dungeon_atlas.png  (512x236; 28-col x 18px tile grid + packed anims)
  - public/assets/dungeon/dungeon_atlas.json
  - public/assets/dungeon/{stone_tile,hero_icon,torch_icon,sword_icon,chest_icon,coin_icon,shield_icon,potion_icon}.png
  - <scratch>/world_atlas_preview.png (3x/6x visual QA sheet)
"""

from __future__ import annotations

import colorsys
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DUNGEON_DIR = ROOT / "public" / "assets" / "dungeon"
OUT_PNG = DUNGEON_DIR / "dungeon_atlas.png"
OUT_JSON = DUNGEON_DIR / "dungeon_atlas.json"

SCRATCH_PREVIEW = Path(
    "/Users/Samer/.gemini/antigravity/brain/681e0dd1-392e-45a9-b08c-5ca9e857fe94/scratch/world_atlas_preview.png"
)

# ---------------------------------------------------------------------------
# Hearth & Slate canonical palette (zero pure #000000, zero pure #ffffff)
# ---------------------------------------------------------------------------
INK = (20, 19, 26, 255)        # #14131a  L=9%   Unified outline, deep shadow, mortar pit
SLATE_0 = (33, 35, 46, 255)    # #21232e  L=15%  Floor dark, dark iron, recesses
FLOOR_1 = (40, 43, 56, 255)    # #282b38  L=19%  Stone Crypt floor mid
FLOOR_2 = (46, 50, 64, 255)    # #2e3240  L=22%  Stone Crypt floor subtle bevel
SLATE_1 = (44, 48, 62, 255)    # #2c303e  L=21%  Wall dark, dark armor/stone
WALL_1 = (62, 68, 88, 255)     # #3e4458  L=29%  Wall masonry mid
SLATE_2 = (67, 73, 94, 255)    # #43495e  L=32%  Iron shadow, monolith mid
WALL_2 = (86, 94, 118, 255)    # #565e76  L=40%  Wall lit bevel masonry
SLATE_3 = (106, 115, 140, 255) # #6a738c  L=48%  Wall rim highlight, mid steel, plate
SLATE_4 = (169, 182, 204, 255) # #a9b6cc  L=73%  Bright steel blade, light armor

OAK_0 = (77, 46, 36, 255)      # #4d2e24  L=22%  Dark umber, leather, boots, chest shadow
OAK_1 = (140, 82, 54, 255)     # #8c5236  L=38%  Oak crate/chest/door, hair
OAK_2 = (212, 149, 98, 255)    # #d49562  L=61%  Warm skin, light oak, tan leather
GOLD_1 = (230, 168, 46, 255)   # #e6a82e  L=54%  Forged gold, coins, clasps, trim
GOLD_2 = (247, 223, 134, 255)  # #f7df86  L=75%  Gold glint, warm eyes, flame core

BONE = (242, 239, 228, 255)    # #f2efe4  L=92%  Warm ivory highlight, speculars
SKY_1 = (69, 162, 229, 255)    # #45a2e5  L=58%  Hero tunic/cloak, shield, friendly orb
SKY_2 = (158, 219, 247, 255)   # #9edbf7  L=79%  Sky-ice glint, blade/lance core

CRIM_0 = (122, 34, 46, 255)    # #7a222e  L=31%  Deep crimson shadow, boss cape, heart shade
CRIM_1 = (224, 79, 68, 255)    # #e04f44  L=57%  Danger red: spikes ON tip, TNT, hearts
EMBER = (240, 133, 58, 255)    # #f0853a  L=58%  Hearth fire, torches, enemy orb, fuse

MOSS_0 = (38, 92, 66, 255)     # #265c42  L=25%  Deep pine-moss shadow, slime base
MOSS_1 = (78, 171, 91, 255)    # #4eab5b  L=49%  Slime, healing fountain/flask
MOSS_2 = (150, 219, 110, 255)  # #96db6e  L=65%  Slime gel glint, heal foam highlight

PLUM_0 = (75, 53, 110, 255)    # #4b356e  L=32%  Dusk indigo robe, mage/shade body
PLUM_1 = (167, 112, 214, 255)  # #a770d6  L=64%  Amethyst hex magic, gems, shade core

PAL: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "#": INK,
    "_": INK,
    "k": INK,
    # Calm slate floor & masonry walls
    "q": SLATE_0,   # floor mortar / recess (#21232e)
    "d": FLOOR_1,   # floor body (#282b38)
    "h": FLOOR_2,   # floor subtle bevel (#2e3240)
    "0": SLATE_0,   # dark iron / floor shadow (#21232e)
    "1": SLATE_1,   # dark wall / dark steel (#2c303e)
    "m": WALL_1,    # wall mid stone (#3e4458)
    "2": SLATE_2,   # iron shadow / monolith mid (#43495e)
    "M": WALL_2,    # wall lit stone (#565e76)
    "3": SLATE_3,   # wall top rim / mid steel (#6a738c)
    "4": SLATE_4,   # bright steel / frost armor (#a9b6cc)
    # Warm oak & forged gold
    "u": OAK_0,
    "b": OAK_1,
    "t": OAK_2,
    "g": GOLD_1,
    "y": GOLD_2,
    # Bone ivory & hero/friendly sky
    "w": BONE,
    "a": SKY_1,
    "z": SKY_2,
    # Danger crimson & hearth ember
    "R": CRIM_0,
    "r": CRIM_1,
    "o": EMBER,
    # Moss / healing emerald
    "F": MOSS_0,
    "e": MOSS_1,
    "l": MOSS_2,
    # Dusk plum / amethyst
    "V": PLUM_0,
    "p": PLUM_1,
}


def paint(
    w: int,
    h: int,
    rows: list[str],
    extra: dict[str, tuple[int, int, int, int]] | None = None,
) -> Image.Image:
    assert len(rows) == h, f"Height mismatch: expected {h}, got {len(rows)}"
    pal = dict(PAL)
    if extra:
        pal.update(extra)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        assert len(row) == w, f"Row {y} width {len(row)} != {w}: {row}"
        for x, ch in enumerate(row):
            if ch != ".":
                px[x, y] = pal[ch]
    return img


def set_px(img: Image.Image, pts: list[tuple[int, int, str]]) -> Image.Image:
    out = img.copy()
    px = out.load()
    for x, y, ch in pts:
        if 0 <= x < out.width and 0 <= y < out.height:
            px[x, y] = PAL[ch]
    return out


def pad_to_cell(img: Image.Image, target_w: int, target_h: int, dx: int = 0, dy: int = 0) -> Image.Image:
    ox = (target_w - img.width) // 2 + dx
    oy = (target_h - img.height) // 2 + dy
    cell = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    cell.alpha_composite(img, (ox, oy))
    return cell


def shift_upper_breath(cell: Image.Image, foot_rows: int = 3) -> Image.Image:
    """Clean 1px idle squash dip preserving feet grounding and eye rows."""
    w, h = cell.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    src = cell.load()
    dst = out.load()
    foot_start = h - 2 - foot_rows
    for y in range(foot_start, h):
        for x in range(w):
            dst[x, y] = src[x, y]
    for y in range(foot_start - 1, -1, -1):
        for x in range(w):
            c = src[x, y]
            if c[3] >= 128 and y + 1 < h and (y + 1 <= foot_start or dst[x, y + 1][3] < 128):
                dst[x, y + 1] = c
    return out


def lift_foot_walk(cell: Image.Image, side: str) -> Image.Image:
    """Lift one foot 1px for crisp grounded walk stride frames."""
    w, h = cell.size
    out = cell.copy()
    px = out.load()
    mid = w // 2
    x0, x1 = (2, mid) if side == "left" else (mid, w - 2)
    bot = h - 1
    while bot > 0 and all(px[x, bot][3] < 128 for x in range(w)):
        bot -= 1
    if bot >= 3:
        for x in range(x0, x1):
            px[x, bot - 1] = px[x, bot]
            px[x, bot] = (0, 0, 0, 0)
    return out


def add_rim(cell: Image.Image, col: tuple[int, int, int, int]) -> Image.Image:
    out = cell.copy()
    px = out.load()
    w, h = cell.size
    hits = []
    for y in range(h):
        for x in range(w):
            if px[x, y][:3] == INK[:3] and px[x, y][3] >= 128:
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] < 128:
                        hits.append((x, y))
                        break
    for x, y in hits:
        if y < h - 3:
            px[x, y] = col
    return out


def build_creature_cycle(
    base: Image.Image,
    blink: Image.Image,
    glint: Image.Image,
    rim_col: tuple[int, int, int, int],
    w: int,
    h: int,
    prefix: str,
    pose3: str = "charge",
    alt_run_b: Image.Image | None = None,
    charge_rim_col: tuple[int, int, int, int] | None = None,
) -> dict[str, Image.Image]:
    """Build standard 10/12 frame cycle on a uniform w x h native grid."""
    idle0 = pad_to_cell(base, w, h, 0, 0)
    idle1 = shift_upper_breath(idle0)
    idle2 = pad_to_cell(glint, w, h, 0, 0)
    idle3 = pad_to_cell(blink, w, h, 0, 0)

    if alt_run_b is not None:
        run0 = pad_to_cell(base, w, h, 0, -1)
        run2 = pad_to_cell(alt_run_b, w, h, 0, -1)
    else:
        run0 = pad_to_cell(lift_foot_walk(base, "left"), w, h, 0, -1)
        run2 = pad_to_cell(lift_foot_walk(glint, "right"), w, h, 0, -1)
    run1 = shift_upper_breath(idle0)
    run3 = idle0

    c0 = shift_upper_breath(add_rim(pad_to_cell(glint, w, h, 1, 0), rim_col))
    c1 = add_rim(pad_to_cell(glint, w, h, 0, -1), rim_col)

    out = {
        f"{prefix}_idle_0": idle0,
        f"{prefix}_idle_1": idle1,
        f"{prefix}_idle_2": idle2,
        f"{prefix}_idle_3": idle3,
        f"{prefix}_run_0": run0,
        f"{prefix}_run_1": run1,
        f"{prefix}_run_2": run2,
        f"{prefix}_run_3": run3,
    }
    if prefix == "hero":
        chg_col = charge_rim_col or GOLD_1
        out["hero_dash_0"] = c0
        out["hero_dash_1"] = c1
        out["hero_charge_0"] = shift_upper_breath(add_rim(idle0, chg_col))
        out["hero_charge_1"] = add_rim(pad_to_cell(glint, w, h, 0, -1), chg_col)
    else:
        out[f"{prefix}_{pose3}_0"] = c0
        out[f"{prefix}_{pose3}_1"] = c1
    return out


def build_tiles() -> dict[int, Image.Image]:
    """Create all Hearth & Slate 16x16 tiles mapped to tile_000..tile_131."""
    tiles: dict[int, Image.Image] = {}

    # --- Calm Stone Crypt flagstones (48..53 + 42 subtle carved inlay, strictly L 15-22%) ---
    base_floor = paint(
        16,
        16,
        [
            "dhhhhhhhhhhhhhdq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "hddddddddddddddq",
            "dddddddddddddddq",
            "qdddddddddddddqq",
        ],
    )
    tiles[48] = base_floor
    tiles[49] = set_px(base_floor, [(4, 4, "q"), (5, 4, "q"), (11, 10, "h")])
    tiles[50] = set_px(base_floor, [(9, 3, "h"), (10, 3, "h"), (5, 11, "q")])
    tiles[51] = set_px(base_floor, [(2, 11, "q"), (3, 12, "q"), (12, 4, "h")])
    tiles[52] = set_px(base_floor, [(7, 7, "q"), (8, 7, "h"), (3, 3, "h")])
    tiles[53] = set_px(base_floor, [(11, 12, "q"), (12, 12, "q"), (2, 13, "q")])
    # Subtle carved flagstone medallion strictly inside floor L 15-22% band
    tiles[42] = paint(
        16,
        16,
        [
            "dhhhhhhhhhhhhhdq",
            "hddddddddddddddq",
            "hdddqqqqqqqddddq",
            "hddqddhhhddqdddq",
            "hdqddhdddhddqddq",
            "hdqdhddqddhdqddq",
            "hdqdddqdqdddqddq",
            "hdqddqqdqqddqddq",
            "hdqddqqdqqddqddq",
            "hdqdddqdqdddqddq",
            "hdqdhddqddhdqddq",
            "hdqddhdddhddqddq",
            "hddqdddddddqdddq",
            "hdddqqqqqqqddddq",
            "dddddddddddddddq",
            "qdddddddddddddqq",
        ],
    )

    # --- Clean Slate Masonry Walls (neutral cool slate so biome wallTints harmonize cleanly) ---
    # 14 = north wall, 28 = crypt iron grate, 29 = restrained crimson-gold banner, 1/3 = NW/NE corners
    tiles[14] = paint(
        16,
        16,
        [
            "################",
            "3333333333333333",
            "MMMMMMM2MMMMMMM2",
            "mmmmmmm_mmmmmmm_",
            "mmmmmmm_mmmmmmm_",
            "1111111_1111111_",
            "________________",
            "MMM_MMMMMMMM_MMM",
            "mmm_mmmmmmmm_mmm",
            "222_22222222_222",
            "111_11111111_111",
            "________________",
            "mmmmmmm_mmmmmmm_",
            "2222222_2222222_",
            "1111111_1111111_",
            "################",
        ],
    )
    tiles[28] = paint(
        16,
        16,
        [
            "################",
            "3333333333333333",
            "MMMMMMMMMMMMMMMM",
            "mmm#########mmmm",
            "mm#k3kk3kk3k#mm_",
            "11#k2kk2kk2k#11_",
            "__#k2kk2kk2k#___",
            "MM#k3kk3kk3k#MMM",
            "mm#k2kk2kk2k#mmm",
            "22#k1kk1kk1k#222",
            "11#kkkkkkkkk#111",
            "__###########___",
            "mmmmmmm_mmmmmmm_",
            "2222222_2222222_",
            "1111111_1111111_",
            "################",
        ],
    )
    tiles[29] = paint(
        16,
        16,
        [
            "################",
            "333g33333333g333",
            "MMM#gggggggg#MM2",
            "mmm#RRRRRRRR#mm_",
            "mmm#RrrggRrR#mm_",
            "111#RrgyygRR#11_",
            "___#RrgyygRR#___",
            "MMM#RRrggRRR#MMM",
            "mmm#RRRRRRRR#mmm",
            "222#RRRRRRRR#222",
            "1111#RRRRRR#1111",
            "_____#RRRR#_____",
            "mmmmmm#RR#mmmmm_",
            "2222222##222222_",
            "1111111_1111111_",
            "################",
        ],
    )
    tiles[1] = paint(
        16,
        16,
        [
            "################",
            "#333333333333333",
            "#3MMMMMM2MMMMMM2",
            "#Mmmmmmm_mmmmmm_",
            "#Mmmmmmm_mmmmmm_",
            "#m111111_111111_",
            "#m11____________",
            "#m11MMM_MMMMMMMM",
            "#m11mmm_mmmmmmmm",
            "#m11222_22222222",
            "#m11111_11111111",
            "#m11____________",
            "#m11mmmmmmmmmmmm",
            "#m11222222222222",
            "#m11111111111111",
            "#m11############",
        ],
    )
    tiles[3] = tiles[1].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    # Side walls (57 west, 59 east) + south parapet wall (26) + south corners (25, 27)
    tiles[57] = paint(
        16,
        16,
        [
            "#M21_2222222222_",
            "#3M2_1111111111_",
            "#3M2_1111111110_",
            "#3M2_1111111110_",
            "#M21_1111111110_",
            "#M21____________",
            "#M21_222_222222_",
            "#3M2_111_111110_",
            "#3M2_111_111110_",
            "#M21_111_111110_",
            "#M21_000_000000_",
            "#M21____________",
            "#3M2_2222222_22_",
            "#3M2_1111111_11_",
            "#M21_1111110_10_",
            "#M21_0000000_00_",
        ],
    )
    tiles[59] = tiles[57].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    tiles[26] = paint(
        16,
        16,
        [
            "################",
            "3333333333333333",
            "MMMMMMMMMMMMMMMM",
            "mmmmmmmmmmmmmmmm",
            "################",
            "mmm_mmmmmmmm_mmm",
            "222_22222222_222",
            "111_11111111_111",
            "________________",
            "2222222_2222222_",
            "1111111_1111111_",
            "0000000_0000000_",
            "________________",
            "1111_1111111111_",
            "0000_0000000000_",
            "################",
        ],
    )
    tiles[25] = paint(
        16,
        16,
        [
            "#M21############",
            "#3M2333333333333",
            "#3M2MMMMMMMMMMMM",
            "#M21mmmmmmmmmmmm",
            "#M21############",
            "#M21_mmmmmmmmmmm",
            "#M21_22222222222",
            "#M21_11111111111",
            "#M21____________",
            "#M21_2222222_222",
            "#M21_1111111_111",
            "#210_0000000_000",
            "#210____________",
            "#210_11111111111",
            "#100_00000000000",
            "################",
        ],
    )
    tiles[27] = tiles[25].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    # --- Vaulted Doors: open dark arch (22, 23) + closed warm oak & gold gate (46, 47) ---
    tiles[22] = paint(
        16,
        16,
        [
            "################",
            "33333333########",
            "MMMMMM##33333333",
            "mmmm##MMMMMMMMMM",
            "mm##Mmmmm#######",
            "1#Mmm##kkkkkkkkk",
            "_#m2#k0kkkkkkkkk",
            "M#m2#kkkkkkkkkkk",
            "m#m2#kkkkkkkkkkk",
            "2#21#k0kkkkkkkkk",
            "1#21#kkkkkkkkkkk",
            "_#21#kkkkkkkkkkk",
            "m#21#kkkkkkkkkkk",
            "2#10#kkkk0kkkkkk",
            "1#10#kkkkkkkkkkk",
            "################",
        ],
    )
    tiles[23] = tiles[22].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    tiles[46] = paint(
        16,
        16,
        [
            "################",
            "33333333########",
            "MMMMMM##33333333",
            "mmmm##MMMMMMMMMM",
            "mm##Mmmmm#######",
            "1#Mmm##33333332#",
            "_#m2#tubbbbbbu2#",
            "M#m2#tbuuuubbu2#",
            "m#m2#tbbbbbbbu2#",
            "2#21#3333g3333g#",
            "1#21#tbuubbbbuy#",
            "_#21#tbbbubbbu2#",
            "m#21#tbbbbbbbu2#",
            "2#10#2222222222#",
            "1#10#uubuuubbu2#",
            "################",
        ],
    )
    tiles[47] = tiles[46].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    tiles[46] = set_px(tiles[46], [(15, 9, "g"), (15, 10, "y")])
    tiles[47] = set_px(tiles[47], [(0, 9, "g"), (0, 10, "y")])

    # --- Architectural Props: Monolith Block (64), Oak Crate (63), Column (65), Chest (91), Stairs (56), Fountain (19,31,32) ---
    # 64: Carved Stone Crypt Monolith (calm slate + subtle gold corner studs, zero distracting cyan!)
    tiles[64] = paint(
        16,
        16,
        [
            "################",
            "#3333333333333M#",
            "#MgMMMMMMMMMMgM#",
            "#Mmmmmmmmmmmmm2#",
            "#Mmm22211222mm2#",
            "#mm2211001122m1#",
            "#m22100gg001221#",
            "#m2210gyyg01221#",
            "#m22100gg001221#",
            "#m2211000011221#",
            "#22111222211120#",
            "#21111111111110#",
            "#11000000000000#",
            "#10000000000000#",
            "#00000000000000#",
            "################",
        ],
    )

    # 63: Breakable Oak Crate (crisp framed oak planks + clean diagonal brace + iron corners)
    tiles[63] = paint(
        16,
        16,
        [
            "................",
            ".##############.",
            ".#33#tttttt#32#.",
            ".#32#bbbbbb#22#.",
            ".####uuuuuu####.",
            ".#tt#tbbbbb#bb#.",
            ".#tb#btbbbb#bu#.",
            ".#tb#ubtbbb#bu#.",
            ".#tb#bubtbb#bu#.",
            ".#tb#bbubtb#bu#.",
            ".#bu#bbbbub#uu#.",
            ".####uuuuuu####.",
            ".#22#bbbbbb#21#.",
            ".#21#uuuuuu#11#.",
            ".##############.",
            "................",
        ],
    )

    # 65: Carved Slate Pedestal / Pillar (quiet stone + subtle gold inlay)
    tiles[65] = paint(
        16,
        16,
        [
            "..############..",
            ".#33333333333M#.",
            ".#MMMMgMMgMMMM#.",
            ".#mmmmmmmmmmmm#.",
            "..##Mmmm22mm##..",
            "...#mmm22mm2#...",
            "...#mm2gg2m2#...",
            "...#m22yy221#...",
            "...#222gg211#...",
            "...#22111110#...",
            "..##11111110##..",
            ".#Mmmmmmmmmmm2#.",
            ".#m22222222221#.",
            ".#111111111110#.",
            ".##############.",
            "................",
        ],
    )

    # 91: Hearth & Slate Treasure Chest (warm oak + forged gold straps & lock)
    tiles[91] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#gggggggggggg#.",
            ".#gttttttbbbbg#.",
            ".#gbbbbbbbbbbg#.",
            ".#gggg####gggg#.",
            ".#guu#gyyg#uug#.",
            ".#guu#gbbg#uug#.",
            ".#gggg####gggg#.",
            ".#gbbbbbbbbbbg#.",
            ".#gbuuuuuuuubg#.",
            ".#guuuuuuuuuug#.",
            ".#gggggggggggg#.",
            ".##############.",
            "................",
            "................",
        ],
    )

    # 56: Descending Stone Stairs (crisp stepped stone treads descending into darkness)
    tiles[56] = paint(
        16,
        16,
        [
            ".##############.",
            "#3333333333333M#",
            "#Mg##########g2#",
            "#m#3333333333#2#",
            "#m#MMMMMMMMMM#2#",
            "#m############2#",
            "#m#mmmmmmmm##k2#",
            "#m#22222222#kk2#",
            "#2##########kk1#",
            "#2#222222##kkk1#",
            "#2#111111#kkkk1#",
            "#1########kkkk0#",
            "#1#0000##kkkkk0#",
            "#Mgmmmm222222g0#",
            ".##############.",
            "................",
        ],
    )

    # 19/31/32: Healing Fountain (empty gargoyle, empty basin, emerald-filled basin)
    tiles[19] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#33333333333M#.",
            ".#Mmm#M44M#mm2#.",
            ".#m22#m33m#221#.",
            ".#m2###22###21#.",
            ".#m#MM#11#MM#1#.",
            ".#2####00####1#.",
            ".#2111#kk#1110#.",
            ".#1100#kk#0000#.",
            ".#100000000000#.",
            ".#111111111111#.",
            ".#000000000000#.",
            ".##############.",
            "................",
            "................",
        ],
    )
    tiles[31] = paint(
        16,
        16,
        [
            "................",
            ".##############.",
            "#3333333333333M#",
            "#M##11111111##2#",
            "#m#1000000001#2#",
            "#m#0000000000#2#",
            "#m#0000000000#2#",
            "#m#0000000000#2#",
            "#m#0000000000#2#",
            "#2#0000000000#1#",
            "#2##00000000##1#",
            "#111########111#",
            "#00000000000000#",
            ".##############.",
            "................",
            "................",
        ],
    )
    tiles[32] = paint(
        16,
        16,
        [
            "................",
            ".##############.",
            "#3333333333333M#",
            "#M##llllllll##2#",
            "#m#lwwlleeell#2#",
            "#m#leellleeeF#2#",
            "#m#leeeeeeeFF#2#",
            "#m#elleelleFF#2#",
            "#m#eelllleFFF#2#",
            "#2#FeFFeeFFFF#1#",
            "#2##FFFFFFFF##1#",
            "#111########111#",
            "#00000000000000#",
            ".##############.",
            "................",
            "................",
        ],
    )

    # --- 5 Forged Weapons (106 Longsword, 103 Daggers, 117 Hammer, 129 Scatter Staff, 130 Arcane Lance) ---
    tiles[106] = paint(
        16,
        16,
        [
            ".......##.......",
            "......#w4#......",
            "......#w4#......",
            "......#w4#......",
            "......#w4#......",
            "......#w4#......",
            "......#w4#......",
            "......#wz#......",
            "......#43#......",
            "......#43#......",
            "...#########....",
            "...#ygggggg#....",
            "....###R###.....",
            "......#u#.......",
            "......#a#.......",
            "......###.......",
        ],
    )
    tiles[103] = paint(
        16,
        16,
        [
            "................",
            "........###.....",
            ".......#wwl#....",
            "......#w44e#....",
            ".....#w4432#....",
            "....#w4432#.....",
            "....#4432#......",
            ".....#432#......",
            "......#2#.......",
            "...#########....",
            "...#3gyyyg3#....",
            "....###R###.....",
            "......#r#.......",
            "......#g#.......",
            "......###.......",
            "................",
        ],
    )
    tiles[117] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#gMMMMMMMMMMg#.",
            ".#yMmgoyyogmmg#.",
            ".#gmmoyyyyomm2#.",
            ".#g222gooo222g#.",
            ".#g2222222211u#.",
            "..############..",
            "......#gb#......",
            "......#bu#......",
            "......#bu#......",
            "......#bu#......",
            "......#gb#......",
            "......#bu#......",
            "......#gb#......",
            "......###.......",
        ],
    )
    tiles[129] = paint(
        16,
        16,
        [
            "...##......##...",
            "..#gp#....#pg#..",
            "..#gp#.##.#pg#..",
            "...##.#pw#.##...",
            "....##pwwp##....",
            "....#gpppVg#....",
            ".....#gVVg#.....",
            "......#gb#......",
            "......#tb#......",
            ".....#tu#.......",
            "......#bu#......",
            "......#tb#......",
            ".......#bu#.....",
            "......#bu#......",
            "......#g#.......",
            "......###.......",
        ],
    )
    tiles[130] = paint(
        16,
        16,
        [
            ".......##.......",
            "......#wz#......",
            ".....#zwwz#.....",
            ".....#zwaa#.....",
            "....#gazzag#....",
            "...#g.zaaz.g#...",
            "...##.#gg#.##...",
            "......#g3#......",
            "......#g3#......",
            "......#32#......",
            "......#g3#......",
            "......#32#......",
            "......#32#......",
            "......#32#......",
            "......#g#.......",
            "......###.......",
        ],
    )

    # --- 8 Relic Icons (102, 105, 107, 114, 115, 116, 118, 119) ---
    tiles[102] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#gggggggggggg#.",
            ".#gzzazzzzazzg#.",
            ".#gawwaaaawaag#.",
            ".#gaaa4444aaag#.",
            ".#gaa4aww4aaag#.",
            ".#gaaaaaaaa3ag#.",
            "..#gaaaaaaaag#..",
            "..#gaaaaa33ag#..",
            "...#g3aaaa3g#...",
            "....#ggaa3g#....",
            ".....#gggg#.....",
            "......####......",
            "................",
            "................",
        ],
    )
    tiles[105] = paint(
        16,
        16,
        [
            "................",
            ".......###......",
            "......#wzz#.....",
            ".....#zaaa#.....",
            ".....#azza#.....",
            ".....#a33a#.....",
            ".....#a33#......",
            "......#a3#......",
            "......#a3#......",
            "....#######.....",
            "....#3aaa3#.....",
            ".....##a##......",
            "......#3#.......",
            "......#w#.......",
            "......###.......",
            "................",
        ],
    )
    tiles[107] = paint(
        16,
        16,
        [
            ".......##.......",
            "......#wo#......",
            ".....#orrR#.....",
            ".....#rryR#.....",
            ".....#rroR#.....",
            ".....#rryR#.....",
            ".....#rRRR#.....",
            ".....#rRR#......",
            "......#RR#......",
            "...#########....",
            "..#gygggggyg#...",
            "...###rRr###....",
            "......#R#.......",
            "......#g#.......",
            "......###.......",
            "................",
        ],
    )
    # 114 emerald moss, 115 ember crimson, 116 sky frost flasks
    for tile_id, hi, mid, lo in [
        (114, "l", "e", "F"),
        (115, "y", "o", "r"),
        (116, "z", "a", "2"),
    ]:
        tiles[tile_id] = paint(
            16,
            16,
            [
                "................",
                "......####......",
                "......#tb#......",
                ".....######.....",
                ".....#4gg3#.....",
                "......#w3#......",
                ".....#w##3#.....",
                "....##zww4##....",
                f"...#4{hi}{hi}{hi}{mid}{mid}{lo}4#...",
                f"..#4{hi}w{hi}{hi}{mid}{mid}{lo}{lo}3#..",
                f"..#{hi}{hi}{hi}{mid}{mid}{mid}{lo}{lo}{lo}3#..",
                f"..#{mid}{mid}{mid}{mid}{lo}{lo}{lo}{lo}{lo}3#..",
                f"...#{lo}{lo}{lo}{lo}{lo}{lo}{lo}3#...",
                "....########....",
                "................",
                "................",
            ],
        )
    tiles[118] = paint(
        16,
        16,
        [
            "................",
            "..###......###..",
            ".#yyg#.##.#gyy#.",
            "#yggu##gb##uggy#",
            "#gggu#gggg#uggg#",
            "#guug#gggg#guug#",
            ".#uu##gggg##uu#.",
            "..###.#gb#.###..",
            "......#bu#......",
            "......#bu#......",
            "......#bu#......",
            "......#bu#......",
            "......#gb#......",
            "......#bu#......",
            "......#g#.......",
            "......###.......",
        ],
    )
    tiles[119] = paint(
        16,
        16,
        [
            "................",
            ".###.......###..",
            "#w44#..##.#442#.",
            "#w43###Mm##332#.",
            "#432##m22m##32#.",
            ".#32#.#22#.#2#..",
            "..##..#bu#..##..",
            "......#bu#......",
            "......#bu#......",
            "......#bu#......",
            "......#rR#......",
            "......#bu#......",
            "......#32#......",
            "......#bu#......",
            "......#g#.......",
            "......###.......",
        ],
    )

    # 98 Hero static icon (used by hero_icon.png)
    tiles[98] = build_hero_16_with_eyes()

    # 111 Alley Sapper (bomber icon, 16x16)
    tiles[111] = paint(
        16,
        16,
        [
            "......####......",
            "....##tbbu##....",
            "...#ttbbbbuu#...",
            "..#tbb####bbu#..",
            "..#tb#kkkk#bu#..",
            "..#ub#okk0#uu#..",
            "..#u##rRRr##u#..",
            "...##rrRRrr##...",
            "..#ubbgbbgbb#y..",
            ".#ubtbubgubb#o#.",
            ".#ubbubbbbu#32#.",
            "..##ubbgbbu#22#.",
            "...#ubbbbuu####.",
            "...#uu#..#uu#...",
            "...#01#..#01#...",
            "...###....###...",
        ],
    )

    # 121 Crypt Shade (shade icon, 16x16)
    tiles[121] = paint(
        16,
        16,
        [
            ".....######.....",
            "....#pwwwwp#....",
            "...#pwppppwp#...",
            "..#pw#VVVV#wp#..",
            "..#pp#VkkV#pp#..",
            "..#pV#pkkp#Vp#..",
            "..#pV#VVVV#Vp#..",
            ".#pVV#V11V#VVp#.",
            ".#pVVVVppVVVVp#.",
            ".#VVVVpwwpVVVV#.",
            "..#11VVppVV11#..",
            "..#011VVVV110#..",
            "..#0011VV1100#..",
            "...#0##00##0#...",
            "...#0#.##.#0#...",
            "....#..##..#....",
        ],
    )

    # --- 13 Plain Consistent Relic Tomes (tiles 068..080) ---
    # Every relic shares the exact same leather-bound tome frame & cream pages,
    # distinguished calmly by cover tint and a crisp 2-3px central rune.
    tome_specs = [
        # (tile_id, hi, mid, lo, rune_char)
        (68, "o", "r", "R", "y"),   # ember_wake
        (69, "z", "a", "2", "w"),   # arc_conduit
        (70, "r", "R", "u", "y"),   # blood_reset
        (71, "3", "2", "1", "o"),   # decoy_mine
        (72, "p", "V", "1", "w"),   # rift_cleave
        (73, "z", "a", "1", "y"),   # vortex_slam
        (74, "w", "4", "3", "z"),   # mirror_guard
        (75, "l", "e", "F", "w"),   # reaper_siphon
        (76, "4", "a", "2", "y"),   # volt_nova
        (77, "3", "m", "1", "t"),   # shatter_quake
        (78, "p", "V", "0", "z"),   # phantom_echo
        (79, "y", "g", "b", "w"),   # golden_cleave
        (80, "t", "b", "u", "y"),   # concussion
    ]
    for tid, hi, mid, lo, rune in tome_specs:
        tiles[tid] = paint(
            16,
            16,
            [
                "................",
                "................",
                "..############..",
                f"..#g#{hi * 8}#..",
                f"..#b#{hi}{mid * 7}#..",
                f"..#g#{hi}{mid * 2}{rune * 2}{mid * 3}#..",
                f"..#b#{hi}{mid}{rune}{hi}{rune}{mid * 3}#..",
                f"..#g#{hi}{mid * 2}{rune * 2}{mid * 3}#..",
                f"..#b#{mid * 7}{lo}#..",
                f"..#g#{lo * 8}#..",
                "..############..",
                "..#b#wwwwwww#...",
                "..#g#333333w#...",
                "..###########...",
                "................",
                "................",
            ],
        )

    return tiles


def build_hero_16() -> Image.Image:
    """
    Hearth & Slate Vanguard (16x16):
    Clean steel plate (SLATE_2/3/4), Sky-Blue cloak/scarf (SKY_1/2), Forged Gold clasp/belt (GOLD_1/2),
    warm oak hair & skin, unified #14131a ink. Zero danger-red on the hero for 50ms figure separation!
    """
    return paint(
        16,
        16,
        [
            "................",
            "....########....",
            "...#bttbbbbu#...",
            "..##bbtbbbbu##..",
            "..#bbttttttbb#..",
            "..#bttttttttb#..",
            "..#tttttttttt#..",
            "..##tttttttt##..",
            "..##bttttttb##..",
            "...#zaaaaaaz#...",
            "..##aazggzaa##..",
            ".#22g344443g22#.",
            "#34234444443243#",
            "#22#33gggg33#22#",
            "#####22##22#####",
            ".####uu##uu####.",
        ],
    )


def build_hero_16_with_eyes() -> Image.Image:
    base = build_hero_16()
    return set_px(
        base,
        [
            (6, 7, "k"), (6, 8, "k"),
            (10, 7, "k"), (10, 8, "k"),
            (7, 12, "w"), (8, 12, "4"),
        ],
    )


def build_hero_frames() -> dict[str, Image.Image]:
    base = build_hero_16_with_eyes()
    blink = set_px(base, [(6, 7, "t"), (6, 8, "k"), (10, 7, "t"), (10, 8, "k")])
    glint = set_px(base, [(5, 9, "w"), (6, 12, "w"), (7, 13, "y"), (8, 13, "y")])
    return build_creature_cycle(
        base,
        blink,
        glint,
        SKY_2,
        20,
        20,
        "hero",
        charge_rim_col=GOLD_2,
    )


def build_enemy_frames() -> dict[str, Image.Image]:
    """Legacy creature frames preserved for exact 512x236 atlas compatibility, unified onto Hearth & Slate."""
    frames: dict[str, Image.Image] = {}

    ooze0 = paint(
        16,
        16,
        [
            "................",
            ".....######.....",
            "...##llllll##...",
            "..#llwwwwllll#..",
            ".#llllleelllll#.",
            ".#leeeeeeeeeeF#.",
            "#lee#kk##kk#eeF#",
            "#ee##yg##gy##eF#",
            "#eee########eeF#",
            "#eeFFFllllFFFFF#",
            "#eFFeeeeeeeeFFF#",
            "#FFeeeelleeeeFF#",
            "#FFeeeeeeeFeeFF#",
            ".#FFFFFFFFFFFF#.",
            "..############..",
            "................",
        ],
    )
    ooze_glint = set_px(ooze0, [(4, 4, "w"), (6, 7, "w"), (9, 7, "w"), (11, 10, "l")])
    ooze_blink = set_px(ooze0, [(5, 7, "e"), (6, 7, "e"), (9, 7, "e"), (10, 7, "e")])
    frames.update(build_creature_cycle(ooze0, ooze_blink, ooze_glint, MOSS_2, 20, 20, "slime", "telegraph"))

    cult0 = paint(
        16,
        16,
        [
            "................",
            "...##..##..##...",
            "..#34######43#..",
            "...##rRRRRr##...",
            "..##RRRRRRRR##..",
            "..#RR######RR#..",
            "..#R#kkkkkk#R#..",
            "..#R#kpkkpk#R#..",
            "..#R#kkkkkk#R#..",
            "...##gggggg##...",
            "..##RRRRRRRR##..",
            ".#VVRRggggRRVV#.",
            "#11VRRRppRRV111#",
            "#VV#RRRRRRRR#VV#",
            ".###RRRRRRR####.",
            "..#VV##..##VV#..",
        ],
    )
    cult_glint = set_px(cult0, [(6, 7, "w"), (9, 7, "w"), (7, 12, "w"), (8, 12, "p")])
    cult_blink = set_px(cult0, [(6, 7, "k"), (9, 7, "k")])
    frames.update(build_creature_cycle(cult0, cult_blink, cult_glint, PLUM_1, 20, 20, "wizard", "cast"))

    mino0 = paint(
        24,
        24,
        [
            "........................",
            "..##................##..",
            ".#ww#..............#ww#.",
            ".#w4#..##########..#4w#.",
            ".#43#.##mMMMMMMm##.#34#.",
            "..###mMM44444444MMm###..",
            "...#mmm##333333##mmm#...",
            "...#mm#tbbbbbbbbt#mm#...",
            "....##bbkkkkkkkkbb##....",
            "....#bbkrrkbbkrrkbb#....",
            "....#b#kkkkkkkkkk#b#....",
            "....#u#bb#gyyg#bb#u#....",
            "...##uuu#g#bb#g#uuu##...",
            "..#3M#uuu######uuu#M3#..",
            ".#Mm2#tttuuuuuuttt#2mM#.",
            ".#m21#ttbuuuuuubtt#12m#.",
            "#3m2#buuugRggRgbbub#2m3#",
            "#2##uuuugggggggguuuu##2#",
            "....#uuuuuuuuuuuuuu#....",
            "....#RuuuuuuuuuuuuR#....",
            "....####uu####uu####....",
            "....#22####..####22#....",
            "....######....######....",
            "........................",
        ],
    )
    mino_glint = set_px(mino0, [(8, 9, "y"), (9, 9, "w"), (14, 9, "w"), (15, 9, "y"), (11, 11, "w"), (12, 11, "w")])
    mino_blink = set_px(mino0, [(8, 9, "k"), (9, 9, "k"), (14, 9, "k"), (15, 9, "k")])
    frames.update(build_creature_cycle(mino0, mino_blink, mino_glint, CRIM_1, 24, 24, "cyclops", "charge"))

    ward0 = paint(
        26,
        26,
        [
            "..........................",
            "....##......##......##....",
            "...#gM#....#yg#....#Mg#...",
            "...#Mm#..########..#mM#...",
            "....##.##33MMMM33##.##....",
            ".....##MMgmmmmmmgMM##.....",
            "....#MMmmmgGGGGgmmmMM#....".replace("G", "g"),
            "....#mm##############m#...",
            "....#m#koookkkkoook#mm#...",
            "....#m#koyykkkkoyyk#mm#...",
            "....#m2##kkkkkkkk##2mm#...",
            "...##m22m########m22m##...",
            "..#ggMmmmggggggggmmmMgg#..",
            ".#gMMmmmm22gggg22mmmmMMg#.",
            "#gMmm2222ggrrrrgg2222mmMg#",
            "#2mm#222gggrrrrggg222#mm2#",
            "#22##22222gggggg22222##22#",
            "....#2222222222222222#....",
            "....#11gggggggggggg11#....",
            "....#111#111gg111#111#....",
            "....####111####111####....",
            ".....#Mmmm#....#mmmM#.....",
            ".....#m222#....#222m#.....",
            ".....#2222#....#2222#.....",
            "......####......####......",
            "..........................",
        ],
    )
    ward_glint = set_px(ward0, [(9, 9, "w"), (17, 9, "w"), (12, 13, "y"), (13, 13, "y"), (3, 13, "w"), (22, 13, "w")])
    ward_blink = set_px(ward0, [(8, 9, "r"), (9, 9, "r"), (10, 9, "r"), (15, 9, "r"), (16, 9, "r"), (17, 9, "r")])
    frames.update(build_creature_cycle(ward0, ward_blink, ward_glint, GOLD_1, 26, 26, "warden", "charge"))

    boss_rows = [
        "......##................##......",
        ".....#3M#..##..##..##..#M3#.....",
        "....#Mm#..#yg##yy##gy#..#mM#....",
        "....#m2#..#gggggggggg#..#2m#....",
        "....#m2####gggrrrgggg####2m#....",
        ".....#m22mggggggggggggm22m#.....",
        "......##m2#RRRRRRRRRR#2m##......",
        ".......#22#RRRRrrRRRR#22#.......",
        "........##RR#kkkkkk#RR##........",
        "........#RR#kookkkook#R#........",
        "........#RR#koyk#koyk#R#........",
        "........#RR#kkkkkkkkk#RR#.......",
        "........#RR##kwkkwkk##RR#.......",
        ".......##RRR#w#ww#w#RRR##.......",
        ".....##rRRRRR#######RRRRRr##....",
        "...##rRRRRRRRRRRRRRRRRRRRRRr##..",
        "..#rRRRggMmmmmRRRRmmmmMggRRRRr#.",
        ".#rRR#gMmm22ggoooogg22mmMg#RRRr#",
        ".#RR##mm22ggoyyyyyyogg22mm##RRR#",
        "#rR#.#m222goywwwwwwyog222m#.#Rr#",
        "#R#..#2222goywyyyywyog2222#..#R#",
        ".....#22111ggoyyyyogg11122#.....",
        ".....#111111ggoooogg111111#.....",
        ".....##111gggggggggggg111##.....",
        ".....#R#111##111111##111#R#.....",
        "....#RR#000#.#0000#.#000#RR#....",
        "....#R##000#..####..#000##R#....",
        "......#m222#........#222m#......",
        "......#2111#........#1112#......",
        "......#gggg#........#gggg#......",
        ".......####..........####.......",
        "................................",
    ]
    boss0 = paint(32, 32, boss_rows)
    boss_glint = set_px(
        boss0,
        [(13, 19, "w"), (18, 19, "w"), (15, 2, "w"), (16, 2, "w"), (13, 10, "w"), (18, 10, "w")],
    )
    boss_blink = set_px(boss0, [(13, 9, "r"), (14, 9, "r"), (13, 10, "R"), (14, 10, "R"), (18, 9, "r"), (19, 9, "r")])
    frames.update(build_creature_cycle(boss0, boss_blink, boss_glint, EMBER, 32, 32, "boss", "attack"))

    return frames


def build_prop_anims() -> dict[str, Image.Image]:
    """Coins, gems, hearts, torches, fire, binary spikes, fountain, barrels, orbs, booms, shadows."""
    frames: dict[str, Image.Image] = {}

    # Coins (16x16 forged gold)
    coin_a = paint(
        16,
        16,
        [
            "................",
            "................",
            ".....######.....",
            "...##yyyygg##...",
            "..#yygggggggb#..",
            "..#yggyyyyggb#..",
            ".#ygbywwwwyggb#.",
            ".#ygbywggbyggb#.",
            ".#ygbywwwwyggb#.",
            ".#ygbyyyyyyggb#.",
            "..#gggggggguu#..",
            "..#gbuuuuuugg#..",
            "...##gggguu##...",
            ".....######.....",
            "................",
            "................",
        ],
    )
    coin_b = paint(
        16,
        16,
        [
            "................",
            "................",
            "......####......",
            "....##yygg##....",
            "...#yygggggb#...",
            "...#ygyyyggb#...",
            "...#ygywygbb#...",
            "...#ygywygbb#...",
            "...#ygywygbb#...",
            "...#ygyyyggb#...",
            "...#ggggguuu#...",
            "....##uuuu##....",
            "......####......",
            "................",
            "................",
            "................",
        ],
    )
    coin_c = paint(
        16,
        16,
        [
            "................",
            "................",
            ".......##.......",
            "......#yg#......",
            "......#yg#......",
            "......#wg#......",
            "......#wg#......",
            "......#yg#......",
            "......#gg#......",
            "......#gu#......",
            "......#gu#......",
            ".......##.......",
            "................",
            "................",
            "................",
            "................",
        ],
    )
    frames["coin_0"] = coin_a
    frames["coin_1"] = coin_b
    frames["coin_2"] = coin_c
    frames["coin_3"] = coin_b.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    # Gems (16x16 faceted dusk-amethyst crystal)
    gem0 = paint(
        16,
        16,
        [
            "................",
            "......####......",
            ".....#ppVV#.....",
            "....#pwwwwp#....",
            "...#ppwppppV#...",
            "..#ppppppppVV#..",
            "..#pppppppVVV#..",
            "..#VVpppVVVVV#..",
            "...#VVVVVVVV#...",
            "....#VVVV11#....",
            ".....#VV11#.....",
            "......#10#......",
            ".......##.......",
            "................",
            "................",
            "................",
        ],
    )
    frames["gem_0"] = gem0
    frames["gem_1"] = set_px(gem0, [(4, 5, "w"), (5, 5, "w"), (9, 7, "p")])
    frames["gem_2"] = set_px(gem0, [(5, 4, "w"), (10, 6, "w")])
    frames["gem_3"] = set_px(gem0, [(8, 3, "p"), (7, 8, "p")])

    # Hearts (clean 9x7 crimson heart centered in 16x16)
    heart0 = paint(
        16,
        16,
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "....###.###.....",
            "...#orr#rrR#....",
            "...#wrrrrRR#....",
            "....#rrrRR#.....",
            ".....#rrR#......",
            "......#r#.......",
            ".......#........",
            "................",
            "................",
            "................",
            "................",
        ],
    )
    heart1 = set_px(heart0, [(4, 6, "w"), (5, 6, "o"), (4, 7, "o"), (9, 6, "o")])
    frames["heart_0"] = heart0
    frames["heart_1"] = heart1

    # Torches (16x16 wrought-iron sconce + warm hearth ember flame)
    torch_base = paint(
        16,
        16,
        [
            ".......##.......",
            "......#yo#......",
            ".....#yyyo#.....",
            ".....#oyyo#.....",
            "....#royyor#....",
            "....#rowwor#....",
            ".....#oooo#.....",
            ".....######.....",
            ".....#g22g#.....",
            "......#32#......",
            "......#m2#......",
            "......#22#......",
            ".....#Mm22#.....",
            "......####......",
            ".......##.......",
            "................",
        ],
    )
    frames["torch_0"] = torch_base
    frames["torch_1"] = set_px(torch_base, [(7, 0, "o"), (6, 2, "w"), (9, 3, "o"), (8, 4, "w")])
    frames["torch_2"] = set_px(torch_base, [(8, 0, "o"), (7, 1, "w"), (5, 4, "y"), (10, 4, "r")])
    frames["torch_3"] = set_px(torch_base, [(7, 1, "r"), (8, 2, "w"), (6, 4, "y"), (8, 5, "y")])

    # Fire patches (16x16 warm danger hearth flames)
    fire0 = paint(
        16,
        16,
        [
            ".......##.......",
            "......#ro#......",
            ".....#roy#......",
            "...##ooyy#..##..",
            "..#rooyyyo##ro#.",
            "..#royywyyoroy#.",
            ".#rooywwwyooyy#.",
            ".#ooyywwwyyyyo#.",
            ".#ooyyyyyyyyor#.",
            ".#rrooyyyyyooo#.",
            "..#rooyyyyooo#..",
            "..#RRooooooor#..",
            "...##rrrrrr##...",
            ".....######.....",
            "................",
            "................",
        ],
    )
    frames["fire_0"] = fire0
    frames["fire_1"] = fire0.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    frames["fire_2"] = set_px(fire0, [(7, 4, "w"), (8, 5, "w"), (12, 2, "y")])
    frames["fire_3"] = set_px(fire0.transpose(Image.Transpose.FLIP_LEFT_RIGHT), [(6, 6, "y"), (9, 4, "w")])

    # -----------------------------------------------------------------------
    # BINARY 2-STATE SPIKES (ZERO ambiguous warning half-state!)
    # spikes_0: flat recessed dark slate iron plate with 4 crisp dark sockets (UNMISTAKABLY OFF / SAFE)
    # spikes_2 (& spikes_1 identical copy): 4 tall razor-sharp triangular steel spears erupting out of
    #           crimson-armed danger sockets (UNMISTAKABLY ON / LETHAL, zero candle illusion!)
    # -----------------------------------------------------------------------
    spikes_off = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#111111111111#.",
            ".#100000000001#.",
            ".#10###00###01#.",
            ".#10###00###01#.",
            ".#101110011101#.",
            ".#100000000001#.",
            ".#100000000001#.",
            ".#100000000001#.",
            ".#10###00###01#.",
            ".#10###00###01#.",
            ".#101110011101#.",
            ".#000000000000#.",
            "..############..",
            "................",
        ],
    )
    spikes_on = paint(
        16,
        16,
        [
            "....#......#....",
            "...#w#....#w#...",
            "..#w43#..#w43#..",
            "..#w43#..#w43#..",
            ".#r432#rr#432r#.",
            ".#r###0RR0###r#.",
            ".#R0#000000#0R#.",
            ".#R#w#0000#w#R#.",
            ".##w43#00#w43##.",
            ".##w43#00#w43##.",
            ".#r432#RR#432r#.",
            ".#r###0rr0###r#.",
            ".#R0rrrRRrrr0R#.",
            ".#RR00000000RR#.",
            "..############..",
            "................",
        ],
    )
    frames["spikes_0"] = spikes_off
    frames["spikes_1"] = spikes_on.copy()
    frames["spikes_2"] = spikes_on

    # Fountain anim frames (slate gargoyle pouring moss-emerald healing water)
    frames["fountain_0"] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#33333333333M#.",
            ".#Mmm#M44M#mm2#.",
            ".#m22#m33m#221#.",
            ".#m2###22###21#.",
            ".#m#MM#ll#MM#1#.",
            ".#2####ee####1#.",
            ".#211#leel#110#.",
            ".#110#eweF#000#.",
            ".#100#eeFe#000#.",
            ".#111#leeF#111#.",
            ".#000#eeeF#000#.",
            ".#####eeeF#####.",
            ".....#leeF#.....",
            "......####......",
        ],
    )
    frames["fountain_1"] = set_px(frames["fountain_0"], [(6, 9, "l"), (8, 10, "w"), (7, 13, "w"), (8, 14, "l")])

    # TNT Barrel (16x16 crimson iron-hooped powder keg with sparking ember fuse)
    frames["barrel_tnt"] = paint(
        16,
        16,
        [
            "........##......",
            ".......#yo#.....",
            "......#t###.....",
            "....#######.....",
            "...#gg333gg#....",
            "..#rrrrrrrrR#...",
            "..#orrrrrrrR#...",
            "..#322222223#...",
            "..#rrrygyrrR#...",
            "..#rrrygyrrR#...",
            "..#322222223#...",
            "..#rrrrrrrrR#...",
            "...#2RRRRR2#....",
            "....########....",
            "................",
            "................",
        ],
    )

    # Projectiles: 50ms semantic separation!
    # Enemy orb = warm danger (CRIM_0 / CRIM_1 / EMBER / GOLD_2 / BONE)
    orb_e = paint(
        16,
        16,
        [
            "................",
            "................",
            ".....######.....",
            "...##rooRR##....",
            "..#royyyyyoRR#..",
            "..#oywwwwyyor#..",
            ".#roywwwwwyorR#.",
            ".#ooywwwwwyorR#.",
            ".#ooyyyyyyyorR#.",
            ".#RoorrrrroorR#.",
            "..#RroorrrrRR#..",
            "..##RRRRRRRR##..",
            "....########....",
            "................",
            "................",
            "................",
        ],
    )
    frames["orb_enemy_0"] = orb_e
    frames["orb_enemy_1"] = orb_e.transpose(Image.Transpose.ROTATE_90)
    frames["orb_enemy_2"] = orb_e.transpose(Image.Transpose.ROTATE_180)
    frames["orb_enemy_3"] = orb_e.transpose(Image.Transpose.ROTATE_270)

    # Friendly orb = cool sky-ice (SKY_1 / SKY_2 / BONE / SLATE_2)
    orb_f = paint(
        16,
        16,
        [
            "................",
            "................",
            ".....######.....",
            "...##zaaaa2##...",
            "..#zzzzzzzaa2#..",
            "..#zwwwwwwza2#..",
            ".#zzzwwwwwwza2#.",
            ".#azzwwwwwwza2#.",
            ".#azzzzzzzzaa2#.",
            ".#2aaaaaaa2aa2#.",
            "..#22aaaa2222#..",
            "..##22222222##..",
            "....########....",
            "................",
            "................",
            "................",
        ],
    )
    frames["orb_friendly_0"] = orb_f
    frames["orb_friendly_1"] = orb_f.transpose(Image.Transpose.ROTATE_90)
    frames["orb_friendly_2"] = orb_f.transpose(Image.Transpose.ROTATE_180)
    frames["orb_friendly_3"] = orb_f.transpose(Image.Transpose.ROTATE_270)

    # Boom burst (24x24 punchy ember & slate smoke puff)
    frames["boom_0"] = paint(
        24,
        24,
        [
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
            ".........######.........",
            ".......##yyyyyy##.......",
            "......#yywwwwwwyy#......",
            ".....#ywwwwwwwwwwy#.....",
            ".....#ywwwwwwwwwwy#.....",
            ".....#ywwwwwwwwwwy#.....",
            ".....#ywwwwwwwwwwy#.....",
            "......#yywwwwwwyy#......",
            ".......#ooyyyyoo#.......",
            "........#oooooo#........",
            ".........######.........",
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
        ],
    )
    frames["boom_1"] = paint(
        24,
        24,
        [
            "........................",
            "........................",
            ".......##......##.......",
            "......#yy#....#yy#......",
            "....##oooo####oooo##....",
            "...#ooyyyyyyyyyyyyoo#...",
            "..#oywwwwwwwwwwwwwwyo#..",
            "..#oywwwwwwwwwwwwwwyo#..",
            ".#oywwwwwwwwwwwwwwwwyo#.",
            ".#oywwwwwwwwwwwwwwwwyo#.",
            ".#ooywwwwwwwwwwwwwwyoo#.",
            ".#rooyyyyywwwwyyyyyoor#.",
            "..#rrooooyyyyyyoooorr#..",
            "..#RrroooooooooooorrR#..",
            "...#RrrroooooooorrrR#...",
            "....##RRrrrrrrrrRR##....",
            "......###RRRRRR###......",
            "........########........",
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
        ],
    )
    frames["boom_2"] = paint(
        24,
        24,
        [
            "........................",
            "....##............##....",
            "...#rr#...####...#rr#...",
            "..#roo#..#oooo#..#oor#..",
            "...###.##yyyyyy##.###...",
            "....##oyyoo##ooyyo##....",
            "..##rroyo#2mm2#oyorr##..",
            ".#roooro#mMMMMm#oroooor#".replace("oooor#", "ooor#."),
            ".#royyo#mMm22mMm#oyyor#.",
            "..#ooo#mm211112mm#ooo#..",
            "...###221100001122###...",
            "..#ooo#2110000112#ooo#..",
            ".#royy#m21100112m#yyor#.",
            ".#roorr#m221122m#rroor#.",
            "..##RRrr##m22m##rrRR##..",
            "....##RR##m22m##RR##....",
            "......###.####.###......",
            "....##............##....",
            "...#RR#..........#RR#...",
            "....##............##....",
            "........................",
            "........................",
            "........................",
            "........................",
        ],
    )
    frames["boom_3"] = paint(
        24,
        24,
        [
            "........................",
            "..##................##..",
            ".#m2#..............#2m#.",
            "..##................##..",
            ".......##......##.......",
            "......#m2#....#2m#......",
            "......#21#....#12#......",
            "...##..##......##..##...",
            "..#21#............#12#..",
            "...##......##......##...",
            "..........#21#..........",
            "..........#10#..........",
            "...........##...........",
            "..##................##..",
            ".#21#..............#12#.",
            "..##...##......##...##..",
            "......#21#....#12#......",
            ".......##......##.......",
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
            "........................",
        ],
    )

    # Pixel contact shadows (unified #14131a ink, translucent)
    for name, rx, ry in [("shadow_sm", 5, 2), ("shadow_md", 6, 3), ("shadow_lg", 7, 3)]:
        im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        px = im.load()
        for y in range(16):
            for x in range(16):
                dx = (x - 7.5) / rx
                dy = (y - 7.5) / ry
                if dx * dx + dy * dy <= 1.0:
                    px[x, y] = (20, 19, 26, 110)
        frames[name] = im

    return frames


def pack_atlas(
    tiles: dict[int, Image.Image],
    creatures: dict[str, Image.Image],
    props: dict[str, Image.Image],
) -> tuple[Image.Image, dict]:
    """
    Pack tile_000..tile_131 into exact 28-col x 18px-stride top band (512px wide),
    matching shopView.ts / atlasIcon.ts / dungeonle.test.ts, then row-pack all frames below.
    """
    atlas_w = 512
    cols = 28
    stride = 18
    pad = 2

    max_tile = 131
    tile_rows = (max_tile // cols) + 1  # 5 rows -> y up to 92
    grid_bottom = pad + tile_rows * stride

    placed: list[tuple[str, int, int, Image.Image]] = []

    for idx in range(max_tile + 1):
        img = tiles.get(idx)
        if img is not None:
            tx = pad + (idx % cols) * stride
            ty = pad + (idx // cols) * stride
            placed.append((f"tile_{idx:03d}", tx, ty, img))

    cur_x = pad
    cur_y = grid_bottom
    row_h = 0

    for name, img in list(creatures.items()) + list(props.items()):
        w, h = img.size
        if cur_x + w + pad > atlas_w:
            cur_x = pad
            cur_y += row_h + pad
            row_h = 0
        placed.append((name, cur_x, cur_y, img))
        cur_x += w + pad
        row_h = max(row_h, h)

    total_h = cur_y + row_h + pad
    atlas_img = Image.new("RGBA", (atlas_w, total_h), (0, 0, 0, 0))
    frames_meta: dict[str, dict] = {}
    for name, x, y, img in placed:
        atlas_img.alpha_composite(img, (x, y))
        w, h = img.size
        frames_meta[name] = {
            "frame": {"x": x, "y": y, "w": w, "h": h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
        }

    atlas_json = {
        "frames": frames_meta,
        "meta": {
            "app": "dungeonle-world-builder",
            "version": "3.0-hearth-slate",
            "image": "dungeon_atlas.png",
            "format": "RGBA8888",
            "size": {"w": atlas_w, "h": total_h},
            "scale": "1",
        },
    }
    return atlas_img, atlas_json


def audit_atlas(atlas_img: Image.Image, atlas_json: dict, tiles: dict[int, Image.Image], props: dict[str, Image.Image]) -> None:
    """Enforce exact layout invariants, zero pure #000000, calm floor luminance, and binary spikes."""
    assert atlas_img.size == (512, 236), f"Expected 512x236 atlas, got {atlas_img.size}"
    assert len(atlas_json["frames"]) == 159, f"Expected 159 frames, got {len(atlas_json['frames'])}"
    assert atlas_json["frames"]["barrel_tnt"]["frame"] == {"x": 20, "y": 210, "w": 16, "h": 16}, (
        f"barrel_tnt moved: {atlas_json['frames']['barrel_tnt']['frame']}"
    )

    # Zero pure #000000 or pure #ffffff opaque pixels
    px = atlas_img.load()
    for y in range(atlas_img.height):
        for x in range(atlas_img.width):
            r, g, b, a = px[x, y]
            if a > 0:
                assert (r, g, b) != (0, 0, 0), f"Pure #000000 found at ({x},{y})"
                assert (r, g, b) != (255, 255, 255), f"Pure #ffffff found at ({x},{y})"

    # Floor tiles must stay in calm L 14-23% band
    def flat_pixels(im: Image.Image) -> list[tuple[int, int, int, int]]:
        fn = getattr(im, "get_flattened_data", im.getdata)
        return list(fn())

    for fid in (42, 48, 49, 50, 51, 52, 53):
        im = tiles[fid]
        ls = []
        for r, g, b, a in flat_pixels(im):
            if a > 0:
                _, l, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
                ls.append(l * 100)
        assert 14.0 <= min(ls) and max(ls) <= 23.0, f"Floor tile {fid} L range {min(ls):.1f}-{max(ls):.1f}% outside 14-23%"

    # Binary spikes check: spikes_1 == spikes_2, spikes_0 != spikes_2
    assert flat_pixels(props["spikes_1"]) == flat_pixels(props["spikes_2"]), "spikes_1 must match spikes_2 (binary ON)"
    assert flat_pixels(props["spikes_0"]) != flat_pixels(props["spikes_2"]), "spikes_0 must differ from spikes_2"


def write_standalone_icons(tiles: dict[int, Image.Image], props: dict[str, Image.Image]) -> None:
    """Export crisp integer nearest-neighbor UI icons matching Hearth & Slate."""
    def export(img: Image.Image, scale: int, filename: str) -> None:
        scaled = img.resize((img.width * scale, img.height * scale), Image.Resampling.NEAREST)
        scaled.save(DUNGEON_DIR / filename)

    export(tiles[48], 4, "stone_tile.png")        # 64x64 seamless calm slate flagstone CSS backdrop
    export(tiles[98], 3, "hero_icon.png")         # 48x48
    export(props["torch_0"], 2, "torch_icon.png") # 32x32
    export(tiles[106], 2, "sword_icon.png")       # 32x32
    export(tiles[91], 2, "chest_icon.png")        # 32x32
    export(props["coin_0"], 2, "coin_icon.png")   # 32x32
    export(tiles[102], 2, "shield_icon.png")      # 32x32
    export(tiles[115], 2, "potion_icon.png")      # 32x32


def make_preview_sheet(
    tiles: dict[int, Image.Image],
    creatures: dict[str, Image.Image],
    props: dict[str, Image.Image],
) -> Image.Image:
    """Render a crisp 3x zoomed visual QA sheet showing room mock, binary spikes, weapons/relics, hero & props."""
    w, h = 420, 224
    canvas = Image.new("RGBA", (w, h), INK)

    # 7x5 mock Stone Crypt room corner
    for r in range(5):
        for c in range(7):
            t_id = 42 if (r == 2 and c == 3) else 48 + ((r + c) % 6)
            if r == 0:
                t_id = 1 if c == 0 else 29 if c == 1 else 22 if c == 3 else 23 if c == 4 else 28 if c == 5 else 14
            elif c == 0:
                t_id = 57
            canvas.alpha_composite(tiles[t_id], (8 + c * 16, 8 + r * 16))
    canvas.alpha_composite(props["torch_0"], (8 + 2 * 16, 8))
    canvas.alpha_composite(tiles[64], (8 + 1 * 16, 8 + 1 * 16))
    canvas.alpha_composite(tiles[63], (8 + 5 * 16, 8 + 1 * 16))
    canvas.alpha_composite(tiles[91], (8 + 3 * 16, 8 + 2 * 16))
    canvas.alpha_composite(tiles[56], (8 + 5 * 16, 8 + 3 * 16))
    canvas.alpha_composite(props["fountain_0"], (8 + 2 * 16, 8 + 2 * 16))
    canvas.alpha_composite(tiles[32], (8 + 2 * 16, 8 + 3 * 16))
    # Binary spikes OFF (left) and ON (right) directly on Stone Crypt floor!
    canvas.alpha_composite(props["spikes_0"], (8 + 1 * 16, 8 + 3 * 16))
    canvas.alpha_composite(props["spikes_2"], (8 + 1 * 16, 8 + 4 * 16))
    canvas.alpha_composite(props["barrel_tnt"], (8 + 4 * 16, 8 + 3 * 16))
    canvas.alpha_composite(creatures["hero_idle_0"], (8 + 3 * 16 - 2, 8 + 3 * 16 - 2))

    # Row of 5 weapons, 8 relics, pickups & orbs on top right
    weapons = [106, 103, 117, 129, 130]
    for i, wid in enumerate(weapons):
        canvas.alpha_composite(tiles[wid], (136 + i * 20, 12))
    relics = list(range(68, 81))
    for i, rid in enumerate(relics):
        canvas.alpha_composite(tiles[rid], (136 + i * 18, 36))
    extras = [
        props["coin_0"], props["gem_0"], props["heart_0"],
        props["fire_0"], props["orb_enemy_0"], props["orb_friendly_0"],
        props["spikes_0"], props["spikes_1"], props["spikes_2"],
    ]
    for i, im in enumerate(extras):
        # Put dark floor under spikes for realistic contrast inspection
        if i >= 6:
            canvas.alpha_composite(tiles[48], (136 + i * 20, 62))
        canvas.alpha_composite(im, (136 + i * 20, 62))

    # Big 2x inset callout of spikes OFF vs ON on floor (32x32 each) at top far right!
    for idx, sp_key in enumerate(["spikes_0", "spikes_2"]):
        tile_bg = tiles[48].copy()
        tile_bg.alpha_composite(props[sp_key], (0, 0))
        big = tile_bg.resize((32, 32), Image.Resampling.NEAREST)
        canvas.alpha_composite(big, (332 + idx * 40, 14))

    # Hero & legacy creature lineup along middle
    lineup = [
        creatures["hero_idle_0"],
        creatures["hero_dash_0"],
        creatures["hero_charge_0"],
        creatures["slime_idle_0"],
        creatures["wizard_idle_0"],
        creatures["cyclops_idle_0"],
        creatures["warden_idle_0"],
        creatures["boss_idle_0"],
        props["boom_1"],
        props["boom_2"],
    ]
    cx = 12
    for spr in lineup:
        by = 158 - spr.height
        canvas.alpha_composite(spr, (cx, by))
        cx += spr.width + 8

    # Closed door + pillar + empty fountain + hero walk cycle + boss idle along bottom
    canvas.alpha_composite(tiles[46], (12, 178))
    canvas.alpha_composite(tiles[47], (28, 178))
    canvas.alpha_composite(tiles[65], (54, 178))
    canvas.alpha_composite(tiles[19], (78, 178))
    canvas.alpha_composite(tiles[31], (78, 194))
    for i in range(4):
        canvas.alpha_composite(creatures[f"hero_run_{i}"], (112 + i * 24, 180))
    for i in range(4):
        canvas.alpha_composite(creatures[f"boss_idle_{i}"], (224 + i * 38, 176))

    return canvas.resize((w * 3, h * 3), Image.Resampling.NEAREST)


def main() -> None:
    tiles = build_tiles()
    creatures: dict[str, Image.Image] = {}
    creatures.update(build_hero_frames())
    creatures.update(build_enemy_frames())
    props = build_prop_anims()

    atlas_img, atlas_json = pack_atlas(tiles, creatures, props)
    audit_atlas(atlas_img, atlas_json, tiles, props)

    atlas_img.save(OUT_PNG)
    OUT_JSON.write_text(json.dumps(atlas_json, indent=2) + "\n")
    write_standalone_icons(tiles, props)
    print(f"Wrote {OUT_PNG} {atlas_img.size} and {OUT_JSON} ({len(atlas_json['frames'])} frames) [audit PASS]")

    try:
        SCRATCH_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        preview = make_preview_sheet(tiles, creatures, props)
        preview.save(SCRATCH_PREVIEW)
        print(f"Wrote 3x world preview -> {SCRATCH_PREVIEW} {preview.size}")
    except OSError as err:
        print(f"Skipped preview: {err}")


if __name__ == "__main__":
    main()
