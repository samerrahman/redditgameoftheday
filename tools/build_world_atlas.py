#!/usr/bin/env python3
"""
Builds the complete original "Obsidian Torchlight & Forged Gold" 16x16 world,
weapon, relic, prop, hero, enemy, and 32x32 boss atlas for Dungeonle.

All sprites share:
  - Unified obsidian-plum ink outline: #1c1221
  - Exact 1:1 native pixel grid (rendered at uniform 3.0x on a 768x480 / 256x160 arena)
  - Larger monsters use larger native canvases (24x24, 26x26, 32x32) rather than zoom mixels.

Outputs:
  - public/assets/dungeon/dungeon_atlas.png  (512px wide; 28-col x 18px tile grid + packed anims)
  - public/assets/dungeon/dungeon_atlas.json
  - public/assets/dungeon/{stone_tile,hero_icon,torch_icon,sword_icon,chest_icon,coin_icon,shield_icon,potion_icon}.png
  - /Users/Samer/.gemini/antigravity/brain/.../scratch/world_atlas_preview.png (4x inspection grid)
"""

from __future__ import annotations

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

# Unified Obsidian Torchlight & Forged Gold palette
INK = (28, 18, 33, 255)       # #1c1221 unified outline
MORTAR = (22, 16, 32, 255)    # #161020 deep stone crease

PAL: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "#": INK,
    "_": MORTAR,
    "k": (26, 20, 44, 255),
    # Obsidian / slate stones (floor & gothic masonry)
    "0": (31, 24, 43, 255),     # darkest obsidian flagstone
    "1": (41, 32, 56, 255),     # mid-dark floor stone
    "2": (53, 43, 73, 255),     # mid obsidian slate
    "3": (72, 60, 96, 255),     # wall base stone
    "4": (96, 82, 126, 255),    # wall lit bevel stone
    "5": (124, 108, 156, 255),  # crisp upper rim highlight
    # Cold steel / silver blades
    "w": (245, 247, 255, 255),
    "W": (255, 255, 255, 255),
    "c": (196, 210, 232, 255),
    "C": (132, 149, 178, 255),
    "S": (78, 92, 122, 255),
    # Forged gold / warm brass
    "y": (254, 240, 138, 255),
    "g": (245, 194, 52, 255),
    "G": (198, 125, 24, 255),
    "o": (124, 65, 16, 255),
    # Warm timber / oak / chestnut hair / leather
    "t": (198, 132, 82, 255),
    "b": (150, 86, 48, 255),
    "B": (98, 50, 32, 255),
    # Skin tones
    "s": (248, 198, 140, 255),
    "m": (222, 156, 102, 255),
    "d": (178, 112, 74, 255),
    # Crimson / ember red / demon glow
    "h": (254, 180, 162, 255),
    "r": (232, 64, 58, 255),
    "R": (176, 32, 36, 255),
    "X": (110, 18, 30, 255),
    # Fire / ember oranges
    "v": (255, 237, 196, 255),
    "U": (251, 146, 60, 255),
    "u": (234, 88, 22, 255),
    # Toxic emerald / ooze / healing greens
    "e": (167, 243, 208, 255),
    "l": (74, 222, 128, 255),
    "L": (34, 197, 94, 255),
    "f": (20, 128, 68, 255),
    "F": (14, 76, 46, 255),
    # Arcane cyan / ice
    "q": (224, 247, 255, 255),
    "z": (103, 232, 249, 255),
    "Z": (34, 211, 238, 255),
    "a": (8, 145, 178, 255),
    "A": (56, 189, 248, 255),
    "n": (14, 96, 156, 255),
    # Amethyst / hex violet / shadow indigo
    "p": (245, 208, 254, 255),
    "P": (217, 70, 239, 255),
    "V": (147, 51, 234, 255),
    "M": (94, 30, 148, 255),
    "N": (54, 20, 88, 255),
}


def paint(w: int, h: int, rows: list[str], extra: dict[str, tuple[int, int, int, int]] | None = None) -> Image.Image:
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
    """Clean 1px idle/squash dip that preserves face/eye pixel rows cleanly."""
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
    """Lift one foot 1px for crisp walk stride frames."""
    w, h = cell.size
    out = cell.copy()
    px = out.load()
    mid = w // 2
    x0, x1 = (2, mid) if side == "left" else (mid, w - 2)
    # Find bottommost opaque row
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
        out["hero_dash_0"] = c0
        out["hero_dash_1"] = c1
        out["hero_charge_0"] = shift_upper_breath(add_rim(idle0, rim_col))
        out["hero_charge_1"] = add_rim(pad_to_cell(glint, w, h, 0, -1), rim_col)
    else:
        out[f"{prefix}_{pose3}_0"] = c0
        out[f"{prefix}_{pose3}_1"] = c1
    return out


def build_tiles() -> dict[int, Image.Image]:
    """Create all dark-fantasy 16x16 tiles mapped to tile_000..tile_131."""
    tiles: dict[int, Image.Image] = {}

    # --- Obsidian dungeon floor tiles (48..53 + 42 subtle carved inlay) ---
    base_floor = paint(
        16,
        16,
        [
            "2222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111211111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111101110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0000000000000000",
        ],
    )
    tiles[48] = base_floor
    tiles[49] = set_px(base_floor, [(4, 4, "0"), (5, 4, "0"), (11, 10, "2")])
    tiles[50] = set_px(base_floor, [(9, 3, "2"), (10, 3, "2"), (5, 11, "0")])
    tiles[51] = set_px(base_floor, [(2, 11, "0"), (3, 12, "0"), (12, 4, "2")])
    tiles[52] = set_px(base_floor, [(7, 7, "0"), (8, 7, "2"), (3, 3, "2")])
    tiles[53] = set_px(base_floor, [(12, 12, "0"), (13, 12, "0"), (1, 14, "0")])
    tiles[42] = paint(
        16,
        16,
        [
            "2222222222222210",
            "2111111111111110",
            "2111000000011110",
            "2110112221101110",
            "2101122222110110",
            "2101223223221010",
            "2101222112221010",
            "2101221001221010",
            "2101221001221010",
            "2101222112221010",
            "2101223223221010",
            "2101122222110110",
            "2110111111101110",
            "2111000000011110",
            "1111111111111110",
            "0000000000000000",
        ],
    )

    # --- North gothic fortress wall (14) + crypt grate (28) + royal crimson-gold banner (29) + corners (1, 3) ---
    tiles[14] = paint(
        16,
        16,
        [
            "################",
            "5555555555555555",
            "4444444344444443",
            "3333333_3333333_",
            "3332233_3332233_",
            "2222222_2222222_",
            "________________",
            "444_44444444_444",
            "332_33333332_333",
            "222_22222222_222",
            "211_11122111_111",
            "________________",
            "3333333_3333333_",
            "2221222_2221222_",
            "1111111_1111111_",
            "################",
        ],
    )
    tiles[28] = paint(
        16,
        16,
        [
            "################",
            "5555555555555555",
            "4444444444444444",
            "333#########3333",
            "33#kCkkCkkCk#33_",
            "22#kCkkCkkCk#22_",
            "__#kSkkSkkSk#___",
            "44#kCkkCkkCk#444",
            "33#kCkkCkkCk#333",
            "22#kSkkSkkSk#222",
            "21#kkkkkkkkk#111",
            "__###########___",
            "3333333_3333333_",
            "2221222_2221222_",
            "1111111_1111111_",
            "################",
        ],
    )
    tiles[29] = paint(
        16,
        16,
        [
            "################",
            "555g55555555g555",
            "444#GGGGGGGG#443",
            "333#rrrrrrrr#33_",
            "332#rrRggRrr#23_",
            "222#rRgyygRr#22_",
            "___#rRgYYgRr#___".replace("Y", "y"),
            "444#rRRggRRr#444",
            "332#RRRRRRRR#333",
            "222#RRXXXXRR#222",
            "211.#RXXXXR#.111",
            "____.#XXXX#.____",
            "33333.#RR#.3333_",
            "222122.##.22122_",
            "1111111_1111111_",
            "################",
        ],
    )
    tiles[1] = paint(
        16,
        16,
        [
            "################",
            "#555555555555555",
            "#544444434444443",
            "#4333333_333333_",
            "#4322222_222222_",
            "#4321111_111111_",
            "#4321___________",
            "#4321444_4444444",
            "#4321332_3333333",
            "#4321222_2222222",
            "#4321211_1111111",
            "#4321___________",
            "#432133333333333",
            "#432122222222222",
            "#432111111111111",
            "#4321###########",
        ],
    )
    tiles[3] = tiles[1].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    # --- Side walls (57 west, 59 east) + south parapet wall (26) + south corners (25, 27) ---
    tiles[57] = paint(
        16,
        16,
        [
            "#432_2222222222_",
            "#543_2111111111_",
            "#543_1111111110_",
            "#543_1111111110_",
            "#432_1111111110_",
            "#432____________",
            "#432_222_222222_",
            "#543_211_211110_",
            "#543_111_111110_",
            "#432_111_111110_",
            "#432_100_110000_",
            "#432____________",
            "#543_2222222_22_",
            "#543_2111111_21_",
            "#432_1111110_11_",
            "#432_0000000_00_",
        ],
    )
    tiles[59] = tiles[57].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    tiles[26] = paint(
        16,
        16,
        [
            "################",
            "5555555555555555",
            "4444444444444444",
            "3333333333333333",
            "################",
            "333_33333333_333",
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
            "#4321###########",
            "#543155555555555",
            "#543144444444444",
            "#432133333333333",
            "#4321###########",
            "#432_33333333333",
            "#432_22222222222",
            "#432_11111111111",
            "#432____________",
            "#432_2222222_222",
            "#432_1111111_111",
            "#321_0000000_000",
            "#321____________",
            "#321_11111111111",
            "#210_00000000000",
            "################",
        ],
    )
    tiles[27] = tiles[25].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    # --- Vaulted Doors: open dark stone arch (22, 23) + closed iron-studded oak gate (46, 47) ---
    tiles[22] = paint(
        16,
        16,
        [
            "################",
            "55555555########",
            "444444##55555555",
            "3333##4444444444",
            "33##433########.",
            "2#433##kkkkkkkk.",
            "_#32#k0kkkkkkkk.",
            "4#32#kkkkkkkkkk.",
            "3#32#kkkkkkkkkk.",
            "2#21#k1kkkkkkkk.",
            "2#21#kkkkkkkkkk.",
            "_#21#kkkkkkkkkk.",
            "3#21#kkkkkkkkkk.",
            "2#10#kkkk0kkkkk.",
            "1#10#kkkkkkkkkk.",
            "################",
        ],
    )
    tiles[23] = tiles[22].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    tiles[22] = set_px(tiles[22], [(15, y, "k") for y in range(4, 15)] + [(14, 4, "#"), (15, 4, "#")])
    tiles[23] = set_px(tiles[23], [(0, y, "k") for y in range(4, 15)] + [(0, 4, "#"), (1, 4, "#")])

    tiles[46] = paint(
        16,
        16,
        [
            "################",
            "55555555########",
            "444444##55555555",
            "3333##4444444444",
            "33##433########.",
            "2#433##CCCCCCCC#",
            "_#32#tBbbbbbbBS#",
            "4#32#tbBBBBbbBS#",
            "3#32#tbbbbbbbBS#",
            "2#21#CCCCgCCCcS#",
            "2#21#tbBBybbbBS#",
            "_#21#tbbbBbbbBS#",
            "3#21#tbbbbbbbBS#",
            "2#10#SSSSSSSSSS#",
            "1#10#BBbBBBbbBS#",
            "################",
        ],
    )
    tiles[47] = tiles[46].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    # Keep gold lock centered across 46+47
    tiles[46] = set_px(tiles[46], [(15, 9, "g"), (15, 10, "y")])
    tiles[47] = set_px(tiles[47], [(0, 9, "g"), (0, 10, "y")])

    # --- Dungeon monolith block (64), crate (63), altar column (65), chest (91), stairs (56), fountains (19, 31, 32) ---
    tiles[64] = paint(
        16,
        16,
        [
            "################",
            "#55555555555554#",
            "#44444444444443#",
            "#433333gg333332#",
            "#43222gZZg22232#",
            "#3322gZqqZg2232#",
            "#3322gZqqZg2221#",
            "#32222gZZg22221#",
            "#222_22gg22_221#",
            "#221_112211_110#",
            "#211111__111110#",
            "#11110111101110#",
            "#10000111100000#",
            "#00000000000000#",
            "#______________#",
            "################",
        ],
    )

    tiles[63] = paint(
        16,
        16,
        [
            "................",
            ".##############.",
            ".#ccCCCCCCCCcS#.",
            ".#c#tttttttt#S#.",
            ".#C#ttBBBBtb#S#.",
            ".#C#tbBttbbB#S#.",
            ".#C#tBBBBbbt#S#.",
            ".#C#bBttbbbb#S#.",
            ".#C#bbbbtBbb#S#.",
            ".#C#bbBtBBBB#S#.",
            ".#C#BBBBBBBB#S#.",
            ".#SS########SS#.",
            ".#SSSSSSSSSSSS#.",
            ".#BBBBBBBBBBBB#.",
            ".##############.",
            "................",
        ],
    )

    tiles[65] = paint(
        16,
        16,
        [
            "..############..",
            ".#555555555554#.",
            ".#4444g44g4443#.",
            ".#333333333332#.",
            "..##43322334##..",
            "...#332ZZ223#...",
            "...#322qq222#...",
            "...#222ZZ221#...",
            "...#22222211#...",
            "...#22111110#...",
            "..##11111110##..",
            ".#433333333332#.",
            ".#322222222221#.",
            ".#111111111110#.",
            ".##############.",
            "................",
        ],
    )

    tiles[91] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#ggggGGGGgggg#.",
            ".#gRRRRrrRRRRg#.",
            ".#grrrRrrRrrrg#.",
            ".#gggg####gggg#.",
            ".#gBB#gyyg#BBg#.",
            ".#gBB#grrg#BBg#.",
            ".#GGGG####GGGG#.",
            ".#gBBBBBBBBBBg#.",
            ".#gBBBBBBBBBBg#.",
            ".#gXXXXXXXXXXg#.",
            ".#GGGGGGGGGGGG#.",
            ".##############.",
            "................",
            "................",
        ],
    )

    tiles[56] = paint(
        16,
        16,
        [
            ".##############.",
            "#55555555555554#",
            "#4g##########g3#",
            "#3#5444444444#2#",
            "#3#33333333##k2#",
            "#3#2222222##kk2#",
            "#2#111111##kkk2#",
            "#2#00000##kkkk1#",
            "#2#____##kkkkk1#",
            "#2#kkk##kkkkkk1#",
            "#2#kk##kkkkkkk1#",
            "#1#k##kkkkkkkk0#",
            "#1###########k0#",
            "#4g3333222222g0#",
            ".##############.",
            "................",
        ],
    )

    tiles[19] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#555555555554#.",
            ".#433#4334#332#.",
            ".#322#3223#221#.",
            ".#32###22###21#.",
            ".#3#44#11#44#1#.",
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
            "#55555555555554#",
            "#4##11111111##3#",
            "#3#1000000001#2#",
            "#3#0000000000#2#",
            "#3#0000000000#2#",
            "#3#0000000000#2#",
            "#3#0000000000#2#",
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
            "#55555555555554#",
            "#4##llllllll##3#",
            "#3#leeeeLLLLl#2#",
            "#3#lLLWWLLLfL#2#",
            "#3#lLLLLLLLff#2#",
            "#3#LllLLllLff#2#",
            "#3#LLllllLfff#2#",
            "#2#fLLffLLffF#1#",
            "#2##ffffffff##1#",
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
            "......#Ww#......",
            "......#wc#......",
            "......#wc#......",
            "......#wc#......",
            "......#wc#......",
            "......#wc#......",
            "......#wZ#......",
            "......#wc#......",
            "......#cC#......",
            "...#########....",
            "...#ygGGGGg#....",
            "....###R###.....",
            "......#B#.......",
            "......#Z#.......",
            "......###.......",
        ],
    )
    tiles[103] = paint(
        16,
        16,
        [
            "................",
            "........###.....",
            ".......#WWl#....",
            "......#WwcL#....",
            ".....#WwcCS#....",
            "....#WwcCS#.....",
            "....#wcCS#......",
            ".....#cCS#......",
            "......#S#.......",
            "...#########....",
            "...#CgyyygC#....",
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
            ".#g4444444444g#.",
            ".#y43gUyyUg33g#.",
            ".#g33UyyyyU22G#.",
            ".#g222gUUg222G#.",
            ".#G2222222211o#.",
            "..############..",
            "......#gG#......",
            "......#bB#......",
            "......#bB#......",
            "......#bB#......",
            "......#gG#......",
            "......#bB#......",
            "......#gG#......",
            "......###.......",
        ],
    )
    tiles[129] = paint(
        16,
        16,
        [
            "...##......##...",
            "..#gp#....#pg#..",
            "..#gP#.##.#Pg#..",
            "...##.#pw#.##...",
            "....##pWWP##....",
            "....#gPppVg#....",
            ".....#gVVG#.....",
            "......#gG#......",
            "......#tb#......",
            ".....#tB#.......",
            "......#bB#......",
            "......#tb#......",
            ".......#bB#.....",
            "......#bB#......",
            "......#g#.......",
            "......###.......",
        ],
    )
    tiles[130] = paint(
        16,
        16,
        [
            ".......##.......",
            "......#Wq#......",
            ".....#qZZz#.....",
            ".....#zWWZ#.....",
            "....#gZqqZg#....",
            "...#g.ZaaZ.g#...",
            "...##.#gg#.##...",
            "......#gG#......",
            "......#gG#......",
            "......#3S#......",
            "......#gG#......",
            "......#3S#......",
            "......#3S#......",
            "......#3S#......",
            "......#g#.......",
            "......###.......",
        ],
    )

    # --- Relic icons (102, 105, 107, 114, 115, 116, 118, 119) ---
    tiles[102] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#gggggggggggg#.",
            ".#gqqZqqqqZqqg#.",
            ".#gZWWZZZZWWZg#.",
            ".#gZZZZccZZZZg#.",
            ".#gZZcZWWZcZZg#.",
            ".#gaaZZccZZaag#.",
            "..#GaaZZZZaaG#..",
            "..#GaaaaaaaaG#..",
            "...#GaaaaaaG#...",
            "....#GGaaGG#....",
            ".....#GggG#.....",
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
            "......#Wqq#.....",
            ".....#qZZZ#.....",
            ".....#ZqqZ#.....",
            ".....#ZaaZ#.....",
            ".....#Zaa#......",
            "......#Za#......",
            "......#Za#......",
            "....#######.....",
            "....#CZZZC#.....",
            ".....##Z##......",
            "......#a#.......",
            "......#W#.......",
            "......###.......",
            "................",
        ],
    )
    tiles[107] = paint(
        16,
        16,
        [
            ".......##.......",
            "......#Wh#......",
            ".....#hrrR#.....",
            ".....#rryR#.....",
            ".....#rrUR#.....",
            ".....#rryR#.....",
            ".....#rRXR#.....",
            ".....#rRX#......",
            "......#RX#......",
            "...#########....",
            "..#gygggggyg#...",
            "...###rRr###....",
            "......#X#.......",
            "......#g#.......",
            "......###.......",
            "................",
        ],
    )
    # 114 emerald, 115 ember crimson, 116 cobalt frost flasks
    for tile_id, hi, mid, lo in [
        (114, "e", "l", "f"),
        (115, "v", "U", "r"),
        (116, "q", "z", "n"),
    ]:
        tiles[tile_id] = paint(
            16,
            16,
            [
                "................",
                "......####......",
                "......#tb#......",
                ".....######.....",
                ".....#cggC#.....",
                "......#wC#......",
                ".....#w##C#.....",
                "....##qWWc##....",
                "...#c{hi}{hi}{hi}{mid}{mid}{lo}c#...".format(hi=hi, mid=mid, lo=lo),
                "..#c{hi}W{hi}{hi}{mid}{mid}{lo}{lo}C#..".format(hi=hi, mid=mid, lo=lo),
                "..#{hi}{hi}{hi}{mid}{mid}{mid}{lo}{lo}{lo}C#..".format(hi=hi, mid=mid, lo=lo),
                "..#{mid}{mid}{mid}{mid}{lo}{lo}{lo}{lo}{lo}C#..".format(mid=mid, lo=lo),
                "...#{lo}{lo}{lo}{lo}{lo}{lo}{lo}C#...".format(lo=lo),
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
            "#yggG##gG##Gggy#",
            "#gggG#gggg#Gggg#",
            "#GooG#gggg#GooG#",
            ".#oo##GggG##oo#.",
            "..###.#gG#.###..",
            "......#bB#......",
            "......#bB#......",
            "......#bB#......",
            "......#bB#......",
            "......#gG#......",
            "......#bB#......",
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
            "#Wcc#..##.#ccS#.",
            "#wcC###43##CCS#.",
            "#cCS##3223##CS#.",
            ".#CS#.#22#.#S#..",
            "..##..#bB#..##..",
            "......#bB#......",
            "......#bB#......",
            "......#bB#......",
            "......#rR#......",
            "......#bB#......",
            "......#3S#......",
            "......#bB#......",
            "......#g#.......",
            "......###.......",
        ],
    )

    # 98 Hero static icon (used by hero_icon.png)
    hero16 = set_px(
        build_hero_16(),
        [(6, 7, "k"), (6, 8, "k"), (10, 7, "k"), (10, 8, "k"), (6, 6, "s"), (10, 6, "s"), (7, 8, "s"), (8, 8, "m"), (9, 8, "s"), (7, 12, "w"), (8, 12, "c")],
    )
    tiles[98] = hero16

    # 111 Alley Sapper (bomber, 16x16): hooded outlaw holding a lit iron bomb
    tiles[111] = paint(
        16,
        16,
        [
            "......####......",
            "....##tbbB##....",
            "...#ttbbbbBB#...",
            "..#tbb####bbB#..",
            "..#tb#kkkk#bB#..",
            "..#Bb#UkkU#BB#..",
            "..#B##rRRr##B#..",
            "...##rrRRrr##...",
            "..#BbbgBBgbb#v..",
            ".#BbtbBggBbb#U#.",
            ".#BbbBbbbbB#cS#.",
            "..##BbbggbB#SS#.",
            "...#BbbbbBB####.",
            "...#BB#..#BB#...",
            "...#01#..#01#...",
            "...###....###...",
        ],
    )

    # 121 Crypt Shade (shade, 16x16): floating spectral violet wraith with glowing core
    tiles[121] = paint(
        16,
        16,
        [
            ".....######.....",
            "....#pwwwwp#....",
            "...#pwppppwp#...",
            "..#pw#NNNN#wp#..",
            "..#pp#NkkN#pp#..",
            "..#pV#PkkP#Vp#..",
            "..#pV#NNNN#Vp#..",
            ".#pVV#NMMN#VVp#.",
            ".#pVVVVppVVVVp#.",
            ".#VVVVpWWpVVVV#.",
            "..#MMVVppVVMM#..",
            "..#NMMVVVVMMN#..",
            "..#NNMMVVMMNN#..",
            "...#N##NN##N#...",
            "...#N#.##.#N#...",
            "....#..##..#....",
        ],
    )

    return tiles


def build_hero_16() -> Image.Image:
    """Dungeon Vanguard (16x16): gleam dark steel & forged gold armor, crimson scarf, head outline y=1, eyes (6,7)&(10,7)."""
    return paint(
        16,
        16,
        [
            "................",
            "....########....",
            "...#bbbbbbbb#...",
            "..##bBbbbbBb##..",
            "..#bbttttttbb#..",
            "..#btsssssstb#..",
            "..#tsssssssss#..",
            "..##ssssssss##..",
            "..##dmmddmmd##..",
            "...#rrrrrrrr#...",
            "..##RrrggrrR##..",
            ".#SSgCCCCCCgSS#.",
            "#CCSCCCCCCCCSCC#",
            "#SS#CCggggCC#SS#",
            "#####SS##SS#####",
            ".####BB##BB####.",
        ],
    )


def build_hero_frames() -> dict[str, Image.Image]:
    base = build_hero_16()
    base = set_px(
        base,
        [
            (6, 7, "k"), (6, 8, "k"),
            (10, 7, "k"), (10, 8, "k"),
            (6, 6, "s"), (10, 6, "s"),
            (7, 8, "s"), (8, 8, "m"), (9, 8, "s"),
            (7, 12, "w"), (8, 12, "c"),
        ],
    )
    blink = set_px(base, [(6, 7, "m"), (6, 8, "k"), (10, 7, "m"), (10, 8, "k")])
    glint = set_px(base, [(1, 10, "r"), (0, 11, "R"), (5, 11, "W"), (7, 13, "y")])
    return build_creature_cycle(base, blink, glint, PAL["g"], 20, 20, "hero")


def build_enemy_frames() -> dict[str, Image.Image]:
    frames: dict[str, Image.Image] = {}

    # 1. Abyssal Acid Ooze (20x20, base 16x16 luminous toxic emerald slime)
    ooze0 = paint(
        16,
        16,
        [
            "................",
            ".....######.....",
            "...##llllll##...",
            "..#llWWWWllll#..",
            ".#lllleellllll#.",
            ".#lLLLLLLLLLLf#.",
            "#lLL#kk##kk#LLf#",
            "#LL##yg##gy##Lf#",
            "#LLL########LLf#",
            "#LLfffllllffffF#",
            "#LffLLLLLLLLffF#",
            "#ffLLLLeeLLLLFF#",
            "#ffLLLLLLLfLLFF#",
            ".#FFFFFFFFFFFF#.",
            "..############..",
            "................",
        ],
    )
    ooze_glint = set_px(ooze0, [(4, 4, "W"), (6, 7, "W"), (9, 7, "W"), (11, 10, "e")])
    ooze_blink = set_px(ooze0, [(5, 7, "L"), (6, 7, "L"), (9, 7, "L"), (10, 7, "L")])
    frames.update(build_creature_cycle(ooze0, ooze_blink, ooze_glint, PAL["e"], 20, 20, "slime", "telegraph"))

    # 2. Cultist Hexmancer (20x20, base 16x16 horned crimson-purple cultist)
    cult0 = paint(
        16,
        16,
        [
            "................",
            "...##..##..##...",
            "..#3C######C3#..",
            "...##rRRRRr##...",
            "..##RRRRRRRR##..",
            "..#RR######RR#..",
            "..#R#kkkkkk#R#..",
            "..#R#kPkkPk#R#..",
            "..#X#kkkkkk#X#..",
            "...##gGGGGg##...",
            "..##XRRRRRRX##..",
            ".#MMXRggggRXMM#.",
            "#NNMXXRPPXXMNNN#",
            "#XX#XXXXXXXX#XX#",
            ".###XXXXXXX####.",
            "..#XX##..##XX#..",
        ],
    )
    cult_glint = set_px(cult0, [(6, 7, "p"), (9, 7, "p"), (7, 12, "p"), (8, 12, "P")])
    cult_blink = set_px(cult0, [(6, 7, "k"), (9, 7, "k")])
    frames.update(build_creature_cycle(cult0, cult_blink, cult_glint, PAL["P"], 20, 20, "wizard", "cast"))

    # 3. Obsidian Minotaur (24x24, hulking horned beast with gleaming brass nose ring & muscular torso!)
    mino0 = paint(
        24,
        24,
        [
            "........................",
            "..##................##..",
            ".#wW#..............#Ww#.",
            ".#wc#..##########..#cw#.",
            ".#cC#.##33444433##.#Cc#.",
            "..###3344cccccc4433###..",
            "...#333##CCCCCC##333#...",
            "...#33#tbbbbbbbbt#33#...",
            "....##bbkkkkkkkkbb##....",
            "....#bbkrrkbbkrrkbb#....",
            "....#b#kkkkkkkkkk#b#....",
            "....#B#bb#gyyg#bb#B#....",
            "...##BBB#g#bb#g#BBB##...",
            "..#54#BBB######BBB#45#..",
            ".#432#tttBBBBBBttt#234#.",
            ".#321#ttbBBBBBBbtt#123#.",
            "#C32#bBBBgRggRgBBBb#23C#",
            "#S##BBBBggggggggBBBB##S#",
            "....#BBBBBBBBBBBBBB#....",
            "....#XBBBBBBBBBBBBX#....",
            "....####BB####BB####....",
            "....#SS####..####SS#....",
            "....######....######....",
            "........................",
        ],
    )
    mino_glint = set_px(mino0, [(8, 9, "y"), (9, 9, "W"), (14, 9, "W"), (15, 9, "y"), (11, 11, "W"), (12, 11, "W")])
    mino_blink = set_px(mino0, [(8, 9, "k"), (9, 9, "k"), (14, 9, "k"), (15, 9, "k")])
    frames.update(build_creature_cycle(mino0, mino_blink, mino_glint, PAL["r"], 24, 24, "cyclops", "charge"))

    # 4. Dread Templar Juggernaut (26x26, towering spiked obsidian & gold knight!)
    ward0 = paint(
        26,
        26,
        [
            "..........................",
            "....##......##......##....",
            "...#g4#....#yg#....#4g#...",
            "...#43#..########..#34#...",
            "....##.##55444455##.##....",
            ".....##44g333333g44##.....",
            "....#44333gGGGGg33344#....",
            "....#33##############3#...",
            "....#3#kUUUkkkkUUUk#33#...",
            "....#3#kUyykkkkUyyk#33#...",
            "....#32##kkkkkkkk##233#...",
            "...##3223########3223##...",
            "..#gg4333g223322g3334gg#..",
            ".#g44333322gggg22333344g#.",
            "#g4332222gGrrrrGg2222334g#",
            "#S33#222gGgrrrrGg222#333S#",
            "#S2##22222gggggg22222##2S#",
            "....#2222222222222222#....",
            "....#11gggggggggggg11#....",
            "....#111#111gg111#111#....",
            "....####111####111####....",
            ".....#4333#....#3334#.....",
            ".....#3222#....#2223#.....",
            ".....#SSSS#....#SSSS#.....",
            "......####......####......",
            "..........................",
        ],
    )
    ward_glint = set_px(ward0, [(9, 9, "W"), (17, 9, "W"), (12, 13, "y"), (13, 13, "y"), (3, 13, "W"), (22, 13, "W")])
    ward_blink = set_px(ward0, [(8, 9, "u"), (9, 9, "u"), (10, 9, "u"), (15, 9, "u"), (16, 9, "u"), (17, 9, "u")])
    frames.update(build_creature_cycle(ward0, ward_blink, ward_glint, PAL["g"], 26, 26, "warden", "charge"))

    # 5. The Crimson Overlord Boss (32x32 massive Demon King!)
    boss_rows = [
        "......##................##......",
        ".....#54#..##..##..##..#45#.....",
        "....#43#..#yg##yy##gy#..#34#....",
        "....#32#..#gggggggggg#..#23#....",
        "....#32####gggrrrgggg####23#....",
        ".....#3223gggggggggggg3223#.....",
        "......##32#RRRRRRRRRR#23##......",
        ".......#22#RRRRrrRRRR#22#.......",
        "........##RR#kkkkkk#RR##........",
        "........#RR#kUUkkkUUk#R#........",
        "........#RR#kUyk#kUyk#R#........",
        "........#XR#kkkkkkkkk#RX#.......",
        "........#XX##kwkkwkk##XX#.......",
        ".......##XXX#w#ww#w#XXX##.......",
        ".....##rRXXXX#######XXXXRr##....",
        "...##rRRRRXXXXXXXXXXXXXRRRRr##..",
        "..#rRRRgg43333XXXX33334ggRRRRr#.",
        ".#rRR#g43322ggUUUUgg22334g#RRRr#",
        ".#RR##3322ggUyyyyyyUgg2233##RRR#",
        "#rX#.#3222gUyWWWWWWyUg2223#.#Xr#",
        "#X#..#2222gUyWyyyyWyUg2222#..#X#",
        ".....#22111ggUyyyyUgg11122#.....",
        ".....#111111ggUUUUgg111111#.....",
        ".....##111gggggggggggg111##.....",
        ".....#X#111##111111##111#X#.....",
        "....#XX#000#.#0000#.#000#XX#....",
        "....#X##000#..####..#000##X#....",
        "......#3222#........#2223#......",
        "......#2111#........#1112#......",
        "......#gggg#........#gggg#......",
        ".......####..........####.......",
        "................................",
    ]
    boss0 = paint(32, 32, boss_rows)
    boss_glint = set_px(
        boss0,
        [(13, 19, "W"), (18, 19, "W"), (15, 2, "W"), (16, 2, "W"), (13, 10, "W"), (18, 10, "W")],
    )
    boss_blink = set_px(boss0, [(13, 9, "r"), (14, 9, "r"), (13, 10, "R"), (14, 10, "R"), (18, 9, "r"), (19, 9, "r")])
    frames.update(build_creature_cycle(boss0, boss_blink, boss_glint, PAL["U"], 32, 32, "boss", "attack"))

    return frames


def build_prop_anims() -> dict[str, Image.Image]:
    """Coins, gems, hearts, torches, fire, spikes, fountain, barrels, orbs, booms, shadows."""
    frames: dict[str, Image.Image] = {}

    # Coins (16x16 centered)
    coin_a = paint(
        16,
        16,
        [
            "................",
            "................",
            ".....######.....",
            "...##yyyygg##...",
            "..#yyggggggGG#..",
            "..#yggyyyyGGg#..",
            ".#ygGyWWWWyGGg#.",
            ".#ygGyWggGyGGg#.",
            ".#ygGyWWWWyGGg#.",
            ".#ygGyyyyyyGGg#.",
            "..#ggGGGGGGoo#..",
            "..#GGooooooGG#..",
            "...##GGGGoo##...",
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
            "...#yygggGGG#...",
            "...#ygyyyGGg#...",
            "...#ygyWygGg#...",
            "...#ygyWygGg#...",
            "...#ygyWygGg#...",
            "...#ygyyyGGg#...",
            "...#ggGGGooo#...",
            "....##oooo##....",
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
            "......#Wg#......",
            "......#Wg#......",
            "......#yg#......",
            "......#gg#......",
            "......#Go#......",
            "......#Go#......",
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

    # Gems (16x16 faceted violet crystal)
    gem0 = paint(
        16,
        16,
        [
            "................",
            "......####......",
            ".....#ppPP#.....",
            "....#pWWWWP#....",
            "...#ppWPPPpV#...",
            "..#pPppPPPPVV#..",
            "..#PPpPPPPVVV#..",
            "..#VVPPPVVVVM#..",
            "...#VVVVVVVM#...",
            "....#VVVVMM#....",
            ".....#VVMM#.....",
            "......#MN#......",
            ".......##.......",
            "................",
            "................",
            "................",
        ],
    )
    frames["gem_0"] = gem0
    frames["gem_1"] = set_px(gem0, [(4, 5, "W"), (5, 5, "p"), (9, 7, "p")])
    frames["gem_2"] = set_px(gem0, [(5, 4, "W"), (10, 6, "W")])
    frames["gem_3"] = set_px(gem0, [(8, 3, "p"), (7, 8, "P")])

    # Hearts (compact 9x7 ruby heart centered in 16x16 frame -> 27x21px at 3x)
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
            "...#hrr#rrR#....",
            "...#WrrrrRR#....",
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
    heart1 = set_px(heart0, [(4, 6, "W"), (5, 6, "h"), (4, 7, "h"), (9, 6, "h")])
    frames["heart_0"] = heart0
    frames["heart_1"] = heart1

    # Torches (16x16 wrought-iron sconce + 4-frame crackling flame)
    torch_base = paint(
        16,
        16,
        [
            ".......##.......",
            "......#yv#......",
            ".....#vyyu#.....",
            ".....#uyyu#.....",
            "....#rUyyUr#....",
            "....#rUWWUr#....",
            ".....#uuuu#.....",
            ".....######.....",
            ".....#gSSg#.....",
            "......#CS#......",
            "......#3S#......",
            "......#SS#......",
            ".....#432S#.....",
            "......####......",
            ".......##.......",
            "................",
        ],
    )
    frames["torch_0"] = torch_base
    frames["torch_1"] = set_px(torch_base, [(7, 0, "u"), (6, 2, "W"), (9, 3, "U"), (8, 4, "W")])
    frames["torch_2"] = set_px(torch_base, [(8, 0, "U"), (7, 1, "W"), (5, 4, "y"), (10, 4, "r")])
    frames["torch_3"] = set_px(torch_base, [(7, 1, "r"), (8, 2, "W"), (6, 4, "y"), (8, 5, "y")])

    # Fire patches (16x16 roaring floor flames)
    fire0 = paint(
        16,
        16,
        [
            ".......##.......",
            "......#rU#......",
            ".....#rUy#......",
            "...##uUyy#..##..",
            "..#rUUyyyU##rU#.",
            "..#rUyyWyyUrUy#.",
            ".#rUUyWWWyUUyy#.",
            ".#uUyyWWWyyyyU#.",
            ".#uUyyyyyyyyUr#.",
            ".#rrUyyyyyyUUu#.",
            "..#rUUyyyyUUu#..",
            "..#XXUUUUUUrr#..",
            "...##rrrrrr##...",
            ".....######.....",
            "................",
            "................",
        ],
    )
    frames["fire_0"] = fire0
    frames["fire_1"] = fire0.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    frames["fire_2"] = set_px(fire0, [(7, 4, "W"), (8, 5, "W"), (12, 2, "y")])
    frames["fire_3"] = set_px(fire0.transpose(Image.Transpose.FLIP_LEFT_RIGHT), [(6, 6, "y"), (9, 4, "W")])

    # Spikes (16x16 dark iron floor grate -> warning gleams -> bloody spikes)
    frames["spikes_0"] = paint(
        16,
        16,
        [
            "################",
            "#11111111111111#",
            "#1#kk#11#kk#111#",
            "#1#SS#11#SS#111#",
            "#1####11####111#",
            "#11111111111111#",
            "#111#kk#11#kk#1#",
            "#111#SS#11#SS#1#",
            "#111####11####1#",
            "#11111111111111#",
            "#1#kk#11#kk#111#",
            "#1#SS#11#SS#111#",
            "#1####11####111#",
            "#00000000000000#",
            "################",
            "................",
        ],
    )
    frames["spikes_1"] = paint(
        16,
        16,
        [
            "################",
            "#1#W##11#W##111#",
            "#1#gC#11#gC#111#",
            "#1#CS#11#CS#111#",
            "#1####11####111#",
            "#111#W##11#W##1#",
            "#111#gC#11#gC#1#",
            "#111#CS#11#CS#1#",
            "#111####11####1#",
            "#1#W##11#W##111#",
            "#1#gC#11#gC#111#",
            "#1#CS#11#CS#111#",
            "#1####11####111#",
            "#00000000000000#",
            "################",
            "................",
        ],
    )
    frames["spikes_2"] = paint(
        16,
        16,
        [
            "################",
            "#11##111111##11#",
            "#1#rW#1111#Wr#1#",
            "#1#cCS#11#SCc#1#",
            "#1####1111####1#",
            "#1111#1##1#1111#",
            "#111#1#rW#1#111#",
            "#11##1#cCS#1111#",
            "#1#rW####1#1111#",
            "#1#cCS#11##1##1#",
            "#1####111#Wr##1#",
            "#11111111#cCS#1#",
            "#11111111#####1#",
            "#00000000000000#",
            "################",
            "................",
        ],
    )

    # Fountain anim frames (gargoyle stone mouth pouring emerald magic)
    frames["fountain_0"] = paint(
        16,
        16,
        [
            "................",
            "..############..",
            ".#555555555554#.",
            ".#433#4334#332#.",
            ".#322#3223#221#.",
            ".#32###22###21#.",
            ".#3#44#ee#44#1#.",
            ".#2####ll####1#.",
            ".#211#eLLl#110#.",
            ".#110#lWLe#000#.",
            ".#100#LLfl#000#.",
            ".#111#elLf#111#.",
            ".#000#lLLf#000#.",
            ".#####LLLf#####.",
            ".....#elLf#.....",
            "......####......",
        ],
    )
    frames["fountain_1"] = set_px(frames["fountain_0"], [(6, 9, "e"), (8, 10, "W"), (7, 13, "W"), (8, 14, "l")])

    # TNT Barrel (16x16 crimson iron-hooped powder keg with sparking fuse)
    frames["barrel_tnt"] = paint(
        16,
        16,
        [
            "........##......",
            ".......#yy#.....",
            "......#b###.....",
            "....#######.....",
            "...#ggCCCgg#....",
            "..#RRRRRRRRR#...",
            "..#rRRRRRRRX#...",
            "..#CSSSSSSSC#...",
            "..#rRRygyRRX#...",
            "..#RRRygyRRX#...",
            "..#CSSSSSSSC#...",
            "..#RRRRRRRRX#...",
            "...#CXXXXXSC#...",
            "....########....",
            "................",
            "................",
        ],
    )

    # Projectiles: enemy crimson-violet hex orb + friendly cyan arcane orb
    orb_e = paint(
        16,
        16,
        [
            "................",
            "................",
            ".....######.....",
            "...##rPPPPX##...",
            "..#rPyyyyyPRX#..",
            "..#PyWWWWWyPR#..",
            ".#rPyWWWWWwPRX#.",
            ".#PPyWWWWWwPRX#.",
            ".#PPyyyyyyyPRX#.",
            ".#XPPrrrrrPPRX#.",
            "..#XPPPRRRRXX#..",
            "..##XXXXXXXX##..",
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

    orb_f = paint(
        16,
        16,
        [
            "................",
            "................",
            ".....######.....",
            "...##zZZZZa##...",
            "..#zqqqqqqZaa#..",
            "..#qWWWWWWqZa#..",
            ".#zqqWWWWWWqZa#.",
            ".#ZqqWWWWWWqZa#.",
            ".#ZqqqqqqqqZaa#.",
            ".#aZZZaaaaZZaa#.",
            "..#aaZZZZaaaA#..",
            "..##AAAAAAAA##..",
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

    # Boom burst (24x24 punchy pixel cloud!)
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
            "......#yyWWWWWWyy#......",
            ".....#yWWWWWWWWWWy#.....",
            ".....#yWWWWWWWWWWy#.....",
            ".....#yWWWWWWWWWWy#.....",
            ".....#yWWWWWWWWWWy#.....",
            "......#yyWWWWWWyy#......",
            ".......#UUyyyyUU#.......",
            "........#UUUUUU#........",
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
            "....##UUUU####UUUU##....",
            "...#UUyyyyyyyyyyyyUU#...",
            "..#UyWWWWWWWWWWWWWWyU#..",
            "..#UyWWWWWWWWWWWWWWyU#..",
            ".#UyWWWWWWWWWWWWWWWWyU#.",
            ".#UyWWWWWWWWWWWWWWWWyU#.",
            ".#UUyWWWWWWWWWWWWWWyUU#.",
            ".#rUUyyyyyWWWWyyyyyUUr#.",
            "..#rrUUUUyyyyyyUUUUrr#..",
            "..#XrrUUUUUUUUUUUUrrX#..",
            "...#XrrrUUUUUUUUrrrX#...",
            "....##XXrrrrrrrrXX##....",
            "......###XXXXXX###......",
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
            "..#rUU#..#UUUU#..#UUr#..",
            "...###.##yyyyyy##.###...",
            "....##UyyUU##UUyyU##....",
            "..##rrUyU#2332#UyUrr##..",
            ".#rUUUrU#344443#UrUUUr#.",
            ".#rUyyU#34322343#UyyUr#.",
            "..#UUU#3321111233#UUU#..",
            "...###221100001122###...",
            "..#UUU#2110000112#UUU#..",
            ".#rUyy#3211001123#yyUr#.",
            ".#rUUrr#32211223#rrUUr#.",
            "..##XXrr##3223##rrXX##..",
            "....##XX##3223##XX##....",
            "......###.####.###......",
            "....##............##....",
            "...#XX#..........#XX#...",
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
            ".#32#..............#23#.",
            "..##................##..",
            ".......##......##.......",
            "......#32#....#23#......",
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

    # Pixel shadows
    for name, rx, ry in [("shadow_sm", 5, 2), ("shadow_md", 6, 3), ("shadow_lg", 7, 3)]:
        im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        px = im.load()
        for y in range(16):
            for x in range(16):
                dx = (x - 7.5) / rx
                dy = (y - 7.5) / ry
                if dx * dx + dy * dy <= 1.0:
                    px[x, y] = (14, 9, 20, 120)
        frames[name] = im

    return frames


def pack_atlas(
    tiles: dict[int, Image.Image],
    creatures: dict[str, Image.Image],
    props: dict[str, Image.Image],
) -> tuple[Image.Image, dict]:
    """
    Pack tile_000..tile_131 into exact 28-col x 18px-stride top band (512px wide),
    matching shopView.ts CSS weapon layout, then pack all animation/entity frames cleanly below.
    """
    atlas_w = 512
    cols = 28
    stride = 18
    pad = 2

    max_tile = 131
    tile_rows = (max_tile // cols) + 1  # 5 rows -> y up to 92
    grid_bottom = pad + tile_rows * stride

    placed: list[tuple[str, int, int, Image.Image]] = []

    # Place tile_000..tile_131 at deterministic slots; unused decorative slots get stone filler or stay clean
    for idx in range(max_tile + 1):
        img = tiles.get(idx)
        if img is not None:
            tx = pad + (idx % cols) * stride
            ty = pad + (idx // cols) * stride
            placed.append((f"tile_{idx:03d}", tx, ty, img))

    # Row-pack creatures and props below grid_bottom
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
            "version": "2.0",
            "image": "dungeon_atlas.png",
            "format": "RGBA8888",
            "size": {"w": atlas_w, "h": total_h},
            "scale": "1",
        },
    }
    return atlas_img, atlas_json


def write_standalone_icons(tiles: dict[int, Image.Image], props: dict[str, Image.Image]) -> None:
    """Export crisp integer nearest-neighbor UI icons matching the new world art."""
    def export(img: Image.Image, scale: int, filename: str) -> None:
        scaled = img.resize((img.width * scale, img.height * scale), Image.Resampling.NEAREST)
        scaled.save(DUNGEON_DIR / filename)

    export(tiles[48], 4, "stone_tile.png")     # 64x64 seamless obsidian flagstone CSS backdrop
    export(tiles[98], 3, "hero_icon.png")      # 48x48
    export(props["torch_0"], 2, "torch_icon.png")   # 32x32
    export(tiles[106], 2, "sword_icon.png")    # 32x32
    export(tiles[91], 2, "chest_icon.png")     # 32x32
    export(props["coin_0"], 2, "coin_icon.png")     # 32x32
    export(tiles[102], 2, "shield_icon.png")   # 32x32
    export(tiles[115], 2, "potion_icon.png")   # 32x32


def make_preview_sheet(
    tiles: dict[int, Image.Image],
    creatures: dict[str, Image.Image],
    props: dict[str, Image.Image],
) -> Image.Image:
    """Render a 4x zoomed visual QA sheet showing every room tile, weapon, relic, enemy, and 32x32 boss."""
    w, h = 420, 220
    canvas = Image.new("RGBA", (w, h), (22, 16, 32, 255))

    # Draw a 6x5 mock dungeon corner showing floor, walls, door, torch, chest, crate, monolith, fountain
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
    canvas.alpha_composite(props["spikes_2"], (8 + 1 * 16, 8 + 3 * 16))
    canvas.alpha_composite(props["barrel_tnt"], (8 + 4 * 16, 8 + 3 * 16))

    # Row of 5 weapons & relics on right top
    weapons = [106, 103, 117, 129, 130]
    for i, wid in enumerate(weapons):
        canvas.alpha_composite(tiles[wid], (136 + i * 20, 14))
    relics = [102, 105, 107, 114, 115, 116, 118, 119]
    for i, rid in enumerate(relics):
        canvas.alpha_composite(tiles[rid], (136 + i * 20, 38))
    # Pickups & anims row
    extras = [props["coin_0"], props["gem_0"], props["heart_0"], props["fire_0"], props["orb_enemy_0"], props["orb_friendly_0"]]
    for i, im in enumerate(extras):
        canvas.alpha_composite(im, (136 + i * 20, 64))

    # Monsters & Hero lineup along bottom (uniform 1:1 native pixel resolution!)
    lineup = [
        ("hero", creatures["hero_idle_0"]),
        ("slime", creatures["slime_idle_0"]),
        ("wizard", creatures["wizard_idle_0"]),
        ("cyclops", creatures["cyclops_idle_0"]),
        ("warden", creatures["warden_idle_0"]),
        ("boss", creatures["boss_idle_0"]),
        ("boss_atk", creatures["boss_attack_0"]),
        ("boom1", props["boom_1"]),
        ("boom2", props["boom_2"]),
    ]
    cx = 12
    for _, spr in lineup:
        by = 160 - spr.height
        canvas.alpha_composite(spr, (cx, by))
        cx += spr.width + 8

    # Closed door + monolith + hero walking frames along bottom right
    canvas.alpha_composite(tiles[46], (12, 176))
    canvas.alpha_composite(tiles[47], (28, 176))
    canvas.alpha_composite(tiles[65], (56, 176))
    canvas.alpha_composite(tiles[19], (80, 176))
    canvas.alpha_composite(tiles[31], (80, 192))
    for i in range(4):
        canvas.alpha_composite(creatures[f"hero_run_{i}"], (120 + i * 24, 180))
    for i in range(4):
        canvas.alpha_composite(creatures[f"boss_idle_{i}"], (230 + i * 36, 176))

    return canvas.resize((w * 3, h * 3), Image.Resampling.NEAREST)


def main() -> None:
    tiles = build_tiles()
    creatures: dict[str, Image.Image] = {}
    creatures.update(build_hero_frames())
    creatures.update(build_enemy_frames())
    props = build_prop_anims()

    atlas_img, atlas_json = pack_atlas(tiles, creatures, props)
    atlas_img.save(OUT_PNG)
    OUT_JSON.write_text(json.dumps(atlas_json, indent=2) + "\n")
    write_standalone_icons(tiles, props)
    print(f"Wrote {OUT_PNG} {atlas_img.size} and {OUT_JSON} ({len(atlas_json['frames'])} frames)")

    try:
        SCRATCH_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        preview = make_preview_sheet(tiles, creatures, props)
        preview.save(SCRATCH_PREVIEW)
        print(f"Wrote 3x world preview -> {SCRATCH_PREVIEW} {preview.size}")
    except OSError as err:
        print(f"Skipped preview: {err}")


if __name__ == "__main__":
    main()
