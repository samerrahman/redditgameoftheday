#!/usr/bin/env python3
"""
Builds true 1:1 Kenney-style pixel-art costumes and hats/accessories
for Dungeonle, packing them into:
  - public/assets/dungeon/cosmetics_atlas.png
  - public/assets/dungeon/cosmetics_atlas.json
Also writes a 4x visual inspection sheet to scratch/ (if writable).
"""

from __future__ import annotations

import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DUNGEON_DIR = ROOT / "public" / "assets" / "dungeon"
ATLAS_PNG = DUNGEON_DIR / "dungeon_atlas.png"
ATLAS_JSON = DUNGEON_DIR / "dungeon_atlas.json"

OUT_PNG = DUNGEON_DIR / "cosmetics_atlas.png"
OUT_JSON = DUNGEON_DIR / "cosmetics_atlas.json"

SCRATCH_PREVIEW = Path(
    "/Users/Samer/.gemini/antigravity/brain/681e0dd1-392e-45a9-b08c-5ca9e857fe94/scratch/cosmetics_preview.png"
)

# Unified Obsidian Torchlight outline & core colors
OUTLINE = (28, 18, 33, 255)      # #1c1221
EYE_DARK = (26, 20, 44, 255)     # #1a142c
SKIN_LIGHT = (248, 198, 140, 255)
SKIN_MID = (222, 156, 102, 255)
SKIN_SHADE = (178, 112, 74, 255)
HAIR_DARK = (98, 50, 32, 255)
HAIR_MID = (150, 86, 48, 255)
WHITE = (255, 255, 255, 255)

PALETTE: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "#": OUTLINE,
    "k": EYE_DARK,
    # Skin
    "s": SKIN_LIGHT,
    "m": SKIN_MID,
    "d": SKIN_SHADE,
    # Warm browns / wood / hair
    "b": HAIR_MID,
    "B": HAIR_DARK,
    # Whites / silvers / steel
    "w": (248, 250, 252, 255),
    "W": WHITE,
    "c": (192, 203, 220, 255),
    "C": (139, 155, 180, 255),
    "S": (82, 96, 124, 255),
    # Golds / yellows
    "y": (254, 240, 138, 255),
    "g": (251, 191, 36, 255),
    "G": (217, 119, 6, 255),
    "o": (146, 64, 14, 255),
    # Reds / crimsons / pinks
    "r": (239, 68, 68, 255),
    "R": (185, 28, 28, 255),
    "X": (127, 29, 29, 255),
    "p": (249, 168, 212, 255),
    "P": (244, 114, 182, 255),
    # Oranges (Snoo & fire)
    "u": (255, 102, 26, 255),
    "U": (251, 146, 60, 255),
    "v": (255, 237, 213, 255),
    # Greens
    "e": (134, 239, 172, 255),
    "l": (74, 222, 128, 255),
    "L": (34, 197, 94, 255),
    "f": (21, 128, 61, 255),
    "F": (20, 83, 45, 255),
    # Cyans / ice blues
    "q": (224, 242, 254, 255),
    "z": (103, 232, 249, 255),
    "Z": (34, 211, 238, 255),
    "a": (8, 145, 178, 255),
    "A": (56, 189, 248, 255),
    "n": (2, 132, 199, 255),
    # Purples / indigos
    "i": (196, 181, 253, 255),
    "V": (147, 51, 234, 255),
    "M": (107, 33, 168, 255),
    "N": (59, 7, 100, 255),
    "I": (49, 46, 129, 255),
    "D": (30, 27, 75, 255),
    "t": (99, 102, 241, 255),
}


def load_dungeon_atlas() -> tuple[Image.Image, dict]:
    atlas = Image.open(ATLAS_PNG).convert("RGBA")
    meta = json.loads(ATLAS_JSON.read_text())["frames"]
    return atlas, meta


def crop_frame(atlas: Image.Image, meta: dict, name: str) -> Image.Image:
    f = meta[name]["frame"]
    return atlas.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))


def recolor(img: Image.Image, mapping: dict[tuple[int, int, int], tuple[int, int, int, int]]) -> Image.Image:
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 128:
                px[x, y] = (0, 0, 0, 0)
            elif (r, g, b) in mapping:
                px[x, y] = mapping[(r, g, b)]
    return out


def paint_grid(w: int, h: int, rows: list[str], extra: dict[str, tuple[int, int, int, int]] | None = None) -> Image.Image:
    assert len(rows) == h, f"Expected {h} rows, got {len(rows)}"
    pal = dict(PALETTE)
    if extra:
        pal.update(extra)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        assert len(row) == w, f"Row {y} len {len(row)} != {w}: {row}"
        for x, ch in enumerate(row):
            if ch != ".":
                px[x, y] = pal[ch]
    return img


def overlay_onto(base: Image.Image, top: Image.Image, dx: int = 0, dy: int = 0) -> Image.Image:
    out = base.copy()
    out.alpha_composite(top, (dx, dy))
    return out


def set_pixels(img: Image.Image, points: list[tuple[int, int, str]]) -> Image.Image:
    out = img.copy()
    px = out.load()
    for x, y, ch in points:
        if 0 <= x < out.width and 0 <= y < out.height:
            px[x, y] = PALETTE[ch]
    return out


def shift_upper_breath(cell20: Image.Image) -> Image.Image:
    """Clean 1px breathing compress without crushing eye pixels: shifts head/torso down 1px, keeps feet anchored at y=17."""
    out = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    src = cell20.load()
    dst = out.load()
    for y in range(15, 18):
        for x in range(20):
            dst[x, y] = src[x, y]
    for y in range(14, 1, -1):
        for x in range(20):
            c = src[x, y]
            if c[3] >= 128 and (y + 1 <= 15 or dst[x, y + 1][3] < 128):
                dst[x, y + 1] = c
    return out


def make_step_walk_16(base16: Image.Image, side: str) -> Image.Image:
    """Lift one foot 1px cleanly matching the hero walk cycle."""
    out = base16.copy()
    px = out.load()
    x_range = range(3, 8) if side == "left" else range(8, 13)
    for x in x_range:
        px[x, 14] = px[x, 15]
        px[x, 15] = (0, 0, 0, 0)
    return out


def place_in_20(tile16: Image.Image, dx: int = 0, dy: int = 0) -> Image.Image:
    cell = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    cell.alpha_composite(tile16, (2 + dx, 2 + dy))
    return cell


def add_rim_highlight_cell(cell20: Image.Image, col: tuple[int, int, int, int]) -> Image.Image:
    out = cell20.copy()
    px = out.load()
    w, h = out.size
    hits = []
    for y in range(h):
        for x in range(w):
            if px[x, y][:3] == OUTLINE[:3] and px[x, y][3] >= 128:
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] < 128:
                        hits.append((x, y))
                        break
    for x, y in hits:
        if y < h - 3:
            px[x, y] = col
    return out


def make_blink_16(base16: Image.Image, fill: tuple[int, int, int, int], eye_coords: list[tuple[int, int]]) -> Image.Image:
    out = base16.copy()
    px = out.load()
    for x, y in eye_coords:
        if 0 <= x < 16 and 0 <= y < 16:
            px[x, y] = fill
    return out


def build_standard_costume_frames(
    base16: Image.Image,
    blink16: Image.Image,
    glint16: Image.Image,
    rim_col: tuple[int, int, int, int],
    *,
    alt_run_left16: Image.Image | None = None,
    alt_run_right16: Image.Image | None = None,
) -> dict[str, Image.Image]:
    """Produce standard 12 animated 20x20 frames aligned identically to hero_idle_0..3 / hero_run_0..3."""
    idle0 = place_in_20(base16, 0, 0)
    idle1 = shift_upper_breath(idle0)
    idle2 = place_in_20(glint16, 0, 0)
    idle3 = place_in_20(blink16, 0, 0)

    if alt_run_left16 is not None and alt_run_right16 is not None:
        run0 = place_in_20(alt_run_left16, 0, -1)
        run2 = place_in_20(alt_run_right16, 0, -1)
    else:
        run0 = place_in_20(make_step_walk_16(base16, "left"), 0, -1)
        run2 = place_in_20(make_step_walk_16(glint16, "right"), 0, -1)

    run1 = shift_upper_breath(idle0)
    run3 = place_in_20(base16, 0, 0)

    dash0 = shift_upper_breath(place_in_20(add_rim_highlight_cell(glint16, rim_col), 1, 0))
    dash1 = place_in_20(add_rim_highlight_cell(base16, rim_col), 0, -1)

    charge0 = shift_upper_breath(add_rim_highlight_cell(idle0, rim_col))
    charge1 = place_in_20(add_rim_highlight_cell(glint16, rim_col), 0, -1)

    return {
        "idle_0": idle0,
        "idle_1": idle1,
        "idle_2": idle2,
        "idle_3": idle3,
        "run_0": run0,
        "run_1": run1,
        "run_2": run2,
        "run_3": run3,
        "dash_0": dash0,
        "dash_1": dash1,
        "charge_0": charge0,
        "charge_1": charge1,
    }


def build_costumes(atlas: Image.Image, meta: dict) -> dict[str, Image.Image]:
    frames: dict[str, Image.Image] = {}

    def register(prefix: str, d: dict[str, Image.Image]) -> None:
        for suffix, img in d.items():
            frames[f"{prefix}_{suffix}"] = img

    # Copy default hero idle frames for shop heroPreview.ts (keeps one clean atlas load)
    for i in range(4):
        frames[f"default_idle_{i}"] = crop_frame(atlas, meta, f"hero_idle_{i}")

    # 1. Crimson Berserker (self-contained 16x16 scarlet war bandana, war paint & battle sash)
    crimson_base = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#rrrrrrrr#...",
            "..##rrRRRRrr##..",
            ".#RrRRRRRRRRR#..",
            "#X###rRRRRrr##..",
            "..##ssssssss##..",
            "..##ssksssks##..",
            "..##dmmddmmd##..",
            "...#mmddddmm#...",
            "..##RrgRRrrR##..",
            ".#XXRr####rrXX#.",
            "#XXrRsRggRsRrXX#",
            "#XX#RR#rR#RR#XX#",
            "#####XX##XX#####",
            ".####XX##XX####.",
        ],
    )
    crimson_base = set_pixels(
        crimson_base,
        [(6, 7, "k"), (10, 7, "k"), (6, 8, "r"), (10, 8, "r"), (6, 6, "s"), (10, 6, "s")],
    )
    crimson_glint = set_pixels(crimson_base, [(7, 2, "p"), (1, 5, "r"), (7, 12, "y")])
    crimson_blink = make_blink_16(crimson_base, SKIN_MID, [(6, 7), (10, 7)])
    register(
        "costume_crimson",
        build_standard_costume_frames(
            crimson_base, crimson_blink, crimson_glint, PALETTE["r"]
        ),
    )

    # 2. Forest Ranger (self-contained 16x16 emerald headband, beard & woodland cloak)
    forest_base = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#bbBBBBbb#...",
            "..##bBBBBBBb##..",
            "..##LLLLgLLL##..",
            "..#b##ffff##b#..",
            "..##ssssssss##..",
            "..##ssksssks##..",
            "..##BmmddmmB##..",
            "...#BBBBBBBB#...",
            "..##LLfffLL##...",
            ".#ffLf####fLf#..",
            "#FLFFfbggbfLFF#.",
            "#FF.#ffffff#.FF.",
            "#####BB##BB#####",
            ".####BB##BB####.",
        ],
    )
    forest_base = set_pixels(forest_base, [(6, 7, "k"), (10, 7, "k"), (8, 4, "y")])
    forest_glint = set_pixels(forest_base, [(8, 4, "W"), (7, 12, "y"), (4, 12, "l")])
    forest_blink = make_blink_16(forest_base, SKIN_MID, [(6, 7), (10, 7)])
    register(
        "costume_forest",
        build_standard_costume_frames(
            forest_base, forest_blink, forest_glint, PALETTE["l"]
        ),
    )

    # 3. Frost Viking (self-contained 16x16 horned steel helm, ginger beard, white wolf-fur mantle & Nordic tunic)
    viking_base = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            ".##############.",
            "#ww###cccc###ww#",
            "#wc##ccCCcc##cw#",
            ".###wCCCCCCw###.",
            "..##ccCSSCcc##..",
            "..##ssksssks##..",
            "...#smssssms#...",
            "...#bbbbbbbb#...",
            "..##wwbbbbww##..",
            ".#wwwA####Awww#.",
            "#wwnnnggggnnnww#",
            "#cc.#nnnnnn#.cc#",
            "#####SS##SS#####",
            ".####SS##SS####.",
        ],
    )
    viking_base = set_pixels(
        viking_base,
        [(6, 7, "k"), (10, 7, "k")],
    )
    viking_glint = set_pixels(viking_base, [(2, 3, "W"), (13, 3, "W"), (8, 12, "y")])
    viking_blink = make_blink_16(viking_base, SKIN_SHADE, [(6, 7), (10, 7)])
    register(
        "costume_viking",
        build_standard_costume_frames(
            viking_base, viking_blink, viking_glint, PALETTE["A"]
        ),
    )

    # 4. Royal Archmage (self-contained 16x16 golden hair, royal purple robes, gold filigree & chest jewel)
    royal_base = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#gGGGGGGg#...",
            "..##GggggggG##..",
            ".#gGssssssssGg#.",
            ".#ggssssssssgg#.",
            ".#g#ssssssss#g#.",
            ".#g#ssksssks#g#.",
            ".#G#dmmddmmd#G#.",
            ".#o##ddmmdd##o#.",
            "..##VgGGGGgV##..",
            ".#VVgV####VgVV#.",
            ".#VVVVgZZgVVVV#.",
            "..#MM#MggM#MM#..",
            "..###MM##MM###..",
            "...#ggG##Ggg#...",
        ],
    )
    royal_base = set_pixels(royal_base, [(6, 7, "k"), (10, 7, "k")])
    royal_glint = set_pixels(royal_base, [(7, 12, "q"), (8, 12, "q"), (8, 2, "y")])
    royal_blink = make_blink_16(royal_base, SKIN_LIGHT, [(6, 7), (10, 7)])
    register(
        "costume_royal",
        build_standard_costume_frames(
            royal_base, royal_blink, royal_glint, PALETTE["i"]
        ),
    )

    # 5. Shadow Shinobi (midnight indigo cowl + glowing cyan eyes + crimson scarf + gold waist crest)
    shadow_base = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#IIIIIIII#...",
            "..##IIttttII##..",
            "..#IIIIIIIIII#..",
            "..#II######II#..",
            "..#I#DDDDDD#I#..",
            "..#I#DzDDzD#I#..",
            "..#I#DDDDDD#I#..",
            "..##rrr##rrr##..",
            ".#rRRRRrrRRRR#..",
            "#RRIII####IIID#.",
            "#DDIIDggggDIIDD#",
            "#II.#IIIIII#.II#",
            "#####DD##DD#####",
            ".####SS##SS####.",
        ],
    )
    shadow_glint = set_pixels(
        shadow_base, [(6, 7, "q"), (10, 7, "q"), (1, 10, "r"), (0, 11, "r")]
    )
    shadow_blink = make_blink_16(shadow_base, PALETTE["D"], [(6, 7), (10, 7)])
    register(
        "costume_shadow",
        build_standard_costume_frames(
            shadow_base, shadow_blink, shadow_glint, PALETTE["Z"]
        ),
    )

    # 6. Snow Yeti (100% original 16x16 glacier beast in unified #1c1221 outline)
    yeti0 = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#WWwwwwWW#...",
            "..#ccwwWWWWww#..",
            "..#ccwwwqqwww#..",
            ".#ccwwwwqqwwww#.",
            ".#cw#CCzzzzCCw#.",
            ".#cw#Cz#zz#zCw#.",
            "..##CCzzzzzzCC#.",
            "..#ww########w#.",
            "#cwwwwqqqqqqwww#",
            "#w.#cwwccccww#.#",
            ".#.#ccCccccCc#..",
            "...#cCC####CC#..",
            "...#cc#....#c#..",
            "...###.....###..",
        ],
    )
    yeti1 = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#WWwwwwWW#...",
            "..#ccwwWWWWww#..",
            "..#ccwwwqqwww#..",
            ".#ccwwwwqqwwww#.",
            ".#cw#CCzzzzCCw#.",
            ".#cw#Cz#zz#zCw#.",
            "..##CCzzzzzzCC#.",
            "..#ww########w#.",
            ".#cwwwqqqqqqww#.",
            ".#.#cwwccccww#..",
            "...#ccC####Cc#..",
            "...#cc#....#c#..",
            "...###.....##...",
            "................",
        ],
    )
    yeti_glint = set_pixels(yeti0, [(7, 3, "W"), (8, 3, "W"), (7, 7, "u"), (10, 7, "u")])
    yeti_blink = make_blink_16(yeti0, PALETTE["z"], [(7, 7), (10, 7)])
    register(
        "costume_yeti",
        build_standard_costume_frames(
            yeti0,
            yeti_blink,
            yeti_glint,
            PALETTE["q"],
            alt_run_left16=yeti0,
            alt_run_right16=yeti1,
        ),
    )

    # 7. Gilded Paladin (self-contained 16x16 gleaming 24k gold full plate + cyan visor glow + royal crimson cape)
    gold_base = paint_grid(
        16,
        16,
        [
            "................",
            ".....######.....",
            "....#yyyyyy#....",
            "...##yggggG##...",
            "..#y#yyyyyy#G#..",
            "..#g#gggggg#G#..",
            "..##g#g#g#g#G#..",
            "...#gzg#g#zgG#..",
            "...#ggggggggG#..",
            "..#gG######Gg#..",
            ".#Rrgg####ggRr#.",
            "#RRRygGGGGgyRRR#",
            "#XX#gGrrrrGg#XX#",
            "....#GGGGGG#....",
            "....###..###....",
            "....#oo##oo#....",
        ],
    )
    gold_glint = set_pixels(gold_base, [(6, 2, "W"), (7, 2, "W"), (5, 7, "q"), (10, 7, "q"), (4, 5, "W")])
    gold_blink = set_pixels(gold_base, [(5, 7, "a"), (10, 7, "a"), (5, 8, "a"), (10, 8, "a")])
    register(
        "costume_gold",
        build_standard_costume_frames(
            gold_base, gold_blink, gold_glint, PALETTE["y"]
        ),
    )

    # 8. Bone Knight (clean bleached ivory skull, dark sockets + glowing emerald eyes, dark iron ribs, purple necromancer cloak)
    skel_base = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#wwwwwwww#...",
            "..##wWwwwwcw##..",
            "..#wwwwwwwwwc#..",
            "..#wwwwwwwwww#..",
            "..#cww#ww#wwc#..",
            "..#cwkLwkLwcc#..",
            "..#cckkcckkcc#..",
            "...#c#w#w#wc#...",
            "..##w######w##..",
            ".#VVcc####ccVV#.",
            "#MM#cSwSwScS#MM#",
            "#NN.#SwcwSc#.NN#",
            "#####cc##cc#####",
            ".####CC##CC####.",
        ],
    )
    skel_glint = set_pixels(skel_base, [(6, 7, "e"), (10, 7, "e"), (5, 3, "W"), (6, 3, "W")])
    skel_blink = make_blink_16(skel_base, EYE_DARK, [(6, 7), (10, 7)])
    register(
        "costume_skeleton",
        build_standard_costume_frames(
            skel_base, skel_blink, skel_glint, PALETTE["l"]
        ),
    )

    # 9. Spectral Wraith (luminous cyan-lavender ghost with bold spooky eyes & symmetric floating wisps)
    wraith_a = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#qqqqqqqz#...",
            "..##qWWWWqqz##..",
            "..#qqqqqqqqzz#..",
            "..#q########z#..",
            "..#q#Z#qq#Z#z#..",
            "..#qqqqqqqqzz#..",
            ".##qqqqqqqqzz##.",
            "#qqq#qqqqq#zzzz#",
            "#q.#qqq#qqq#.zz#",
            "###.qqz#zqq.###.",
            "...#qzqzqzq#....",
            "...#zzqtqzz#....",
            "..#q#z#.#z#t#...",
            "..###.#.#.###...",
        ],
    )
    wraith_b = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#qqqqqqqz#...",
            "..##qWWWWqqz##..",
            "..#qqqqqqqqzz#..",
            "..#q########z#..",
            "..#q#Z#qq#Z#z#..",
            "..#qqqqqqqqzz#..",
            ".##qqqqqqqqzz##.",
            "#qqq#qqqqq#zzzz#",
            ".###qqq#qqq###..",
            "...#qqz#zqq#....",
            "...#qzqzqzq#....",
            "...#zqtqtqz#....",
            "...##.#t#.###...",
            "....#.#.#.#.....",
        ],
    )
    wraith_c = make_blink_16(wraith_a, OUTLINE, [(5, 6), (10, 6)])
    wraith_d = paint_grid(
        16,
        16,
        [
            "................",
            "....########....",
            "...#qqqqqqqz#...",
            "..##qWWWWqqz##..",
            "..#qqqqqqqqzz#..",
            "..#q########z#..",
            "..#q#Z#qq#Z#z#..",
            "..#qqqqqqqqzz#..",
            ".##qqqqqqqqzz##.",
            "#qqq#qqqqq#zzzz#",
            "#z.#qqq#qqq#.qz#",
            ".###qqz#zqq###..",
            "...#qqzqzqq#....",
            "...#zzqtqzz#....",
            "...#t#z#z#q#....",
            "...###.#.###....",
        ],
    )
    register(
        "costume_phantom",
        {
            "idle_0": place_in_20(wraith_a, 0, 0),
            "idle_1": place_in_20(wraith_b, 0, 1),
            "idle_2": place_in_20(wraith_b, 0, 0),
            "idle_3": place_in_20(wraith_c, 0, 0),
            "run_0": place_in_20(wraith_b, 0, -1),
            "run_1": place_in_20(wraith_a, 0, 1),
            "run_2": place_in_20(wraith_d, 0, -1),
            "run_3": place_in_20(wraith_a, 0, 0),
            "dash_0": add_rim_highlight_cell(place_in_20(wraith_b, 1, 0), PALETTE["W"]),
            "dash_1": add_rim_highlight_cell(place_in_20(wraith_a, 0, -1), PALETTE["Z"]),
            "charge_0": add_rim_highlight_cell(place_in_20(wraith_c, 0, 1), PALETTE["Z"]),
            "charge_1": add_rim_highlight_cell(place_in_20(wraith_b, 0, -1), PALETTE["W"]),
        },
    )

    return frames


def build_hats() -> dict[str, Image.Image]:
    """
    Build all 10 animated 24x28 pixel-art hats/accessories.
    Hero 20x20 maps to (2, 6) inside 24x28:
      - Hero center (10,10) -> (12, 16)
      - Hero head top #3f2631 -> y=9..10, x=8..15
      - Hero eyes -> y=15..16, x=10 & 14 (center x=11.5)
    """
    frames: dict[str, Image.Image] = {}

    def empty() -> list[str]:
        return ["." * 24 for _ in range(28)]

    def stamp_rows(rows_spec: list[tuple[int, str]]) -> Image.Image:
        rows = empty()
        for y, row in rows_spec:
            rows[y] = row
        return paint_grid(24, 28, rows)

    # 1. Royal Crown (crown_crest) - 3-peak gold crown with ruby + animated sparkle glint
    crown_base = stamp_rows(
        [
            (4, ".......##..##..##......."),
            (5, "......#yg##yg##gy#......"),
            (6, "......#gggggggggg#......"),
            (7, "......#gGgrgGgrGg#......"),
            (8, "......#gggggggggg#......"),
            (9, "......#GGGGGGGGGG#......"),
            (10, ".......##########......."),
        ]
    )
    crown_base = set_pixels(
        crown_base,
        [(11, 7, "r"), (12, 7, "r"), (8, 7, "Z"), (15, 7, "Z"), (7, 5, "y"), (11, 5, "y")],
    )
    frames["hat_crown_crest_0"] = crown_base
    frames["hat_crown_crest_1"] = set_pixels(crown_base, [(7, 5, "W"), (8, 5, "W")])
    frames["hat_crown_crest_2"] = set_pixels(crown_base, [(11, 5, "W"), (12, 5, "W"), (11, 7, "p")])
    frames["hat_crown_crest_3"] = set_pixels(crown_base, [(15, 5, "W"), (16, 5, "W")])

    # 2. Angel Halo (angel_halo) - outlined hollow gold ring bobbing cleanly, shine glints INSIDE outline (no stray dots!)
    halo_norm = stamp_rows(
        [
            (3, "........########........"),
            (4, "......##yggggggy##......"),
            (5, ".....#gG########Gg#....."),
            (6, "......##gggggggg##......"),
            (7, "........########........"),
        ]
    )
    halo_up = stamp_rows(
        [
            (2, "........########........"),
            (3, "......##yggggggy##......"),
            (4, ".....#gG########Gg#....."),
            (5, "......##gggggggg##......"),
            (6, "........########........"),
        ]
    )
    halo_dn = stamp_rows(
        [
            (4, "........########........"),
            (5, "......##yggggggy##......"),
            (6, ".....#gG########Gg#....."),
            (7, "......##gggggggg##......"),
            (8, "........########........"),
        ]
    )
    frames["hat_angel_halo_0"] = set_pixels(halo_norm, [(9, 4, "W"), (10, 4, "W")])
    frames["hat_angel_halo_1"] = set_pixels(halo_up, [(12, 3, "W"), (13, 3, "y")])
    frames["hat_angel_halo_2"] = set_pixels(halo_norm, [(14, 6, "W"), (15, 6, "y")])
    frames["hat_angel_halo_3"] = set_pixels(halo_dn, [(8, 7, "y"), (9, 7, "W")])

    # 3. Bunny Ears (bunny_ears) - tall white outlined ears with pink insides & open center forehead gap
    bunny_up = stamp_rows(
        [
            (1, ".......###....###......."),
            (2, "......#www#..#www#......"),
            (3, "......#wpw#..#wpw#......"),
            (4, "......#wpw#..#wpw#......"),
            (5, "......#wpw#..#wpw#......"),
            (6, "......#wpw#..#wpw#......"),
            (7, "......#wpw#..#wpw#......"),
            (8, "......#wcw#..#wcw#......"),
            (9, "......#www#..#www#......"),
            (10, ".......###....###......."),
        ]
    )
    bunny_flop = stamp_rows(
        [
            (1, ".......###.............."),
            (2, "......#www#....####....."),
            (3, "......#wpw#...#wwww#...."),
            (4, "......#wpw#..#wpppw#...."),
            (5, "......#wpw#..#wpw###...."),
            (6, "......#wpw#..#wpw#......"),
            (7, "......#wpw#..#wpw#......"),
            (8, "......#wcw#..#wcw#......"),
            (9, "......#www#..#www#......"),
            (10, ".......###....###......."),
        ]
    )
    frames["hat_bunny_ears_0"] = bunny_up
    frames["hat_bunny_ears_1"] = set_pixels(bunny_up, [(8, 2, "W"), (15, 2, "W")])
    frames["hat_bunny_ears_2"] = bunny_flop
    frames["hat_bunny_ears_3"] = bunny_flop

    # 4. Snoo Antenna (snoo_antenna) - crisp white outlined curved stalk + bright orange-red glowing orb
    snoo_a = stamp_rows(
        [
            (1, "..............####......"),
            (2, ".............#vuuv#....."),
            (3, "............##uWWu#....."),
            (4, "...........#w#uuuu#....."),
            (5, "..........#w#..##......."),
            (6, "..........#w#..........."),
            (7, "..........#c#..........."),
            (8, "..........#w#..........."),
            (9, "...........#............"),
        ]
    )
    snoo_b = stamp_rows(
        [
            (2, "..............####......"),
            (3, ".............#vuuv#....."),
            (4, "............##uWWu#....."),
            (5, "...........#w#urru#....."),
            (6, "..........#w#..##......."),
            (7, "..........#w#..........."),
            (8, "..........#c#..........."),
            (9, "...........#............"),
        ]
    )
    frames["hat_snoo_antenna_0"] = snoo_a
    frames["hat_snoo_antenna_1"] = set_pixels(snoo_a, [(15, 2, "W"), (16, 2, "W"), (14, 3, "v")])
    frames["hat_snoo_antenna_2"] = snoo_b
    frames["hat_snoo_antenna_3"] = set_pixels(snoo_b, [(15, 3, "y"), (16, 4, "v")])

    # 5. Ember Orbit (flame_halo) - 3 chunky outlined pixel fire wisps orbiting cleanly
    wisp_glyph = [
        "..#..",
        ".#r#.",
        "#rUr#",
        "#Uyu#",
        ".###.",
    ]
    wisp_bright = [
        "..#..",
        ".#U#.",
        "#UyU#",
        "#yWy#",
        ".###.",
    ]

    def place_wisps(centers: list[tuple[int, int]], bright_idx: int) -> Image.Image:
        img = Image.new("RGBA", (24, 28), (0, 0, 0, 0))
        for idx, (cx, cy) in enumerate(centers):
            g = wisp_bright if idx == bright_idx else wisp_glyph
            patch = paint_grid(5, 5, g)
            img.alpha_composite(patch, (cx - 2, cy - 2))
        return img

    frames["hat_flame_halo_0"] = place_wisps([(4, 15), (12, 5), (19, 15)], 1)
    frames["hat_flame_halo_1"] = place_wisps([(5, 9), (18, 9), (12, 21)], 0)
    frames["hat_flame_halo_2"] = place_wisps([(4, 15), (12, 5), (19, 15)], 2)
    frames["hat_flame_halo_3"] = place_wisps([(18, 9), (5, 9), (12, 21)], 1)

    # 6. Cyber Visor (neon_trail) - sleek cyan pixel visor shades across eye rows y=14..17 + animated sheen
    visor_base = stamp_rows(
        [
            (14, ".......##########......."),
            (15, "......#ZZZaaZZZaZ#......"),
            (16, "......#ZZZaZZZZZa#......"),
            (17, ".......####..####......."),
        ]
    )
    frames["hat_neon_trail_0"] = set_pixels(visor_base, [(8, 15, "q"), (9, 15, "z"), (13, 15, "q")])
    frames["hat_neon_trail_1"] = set_pixels(visor_base, [(10, 15, "W"), (9, 16, "q"), (14, 15, "W")])
    frames["hat_neon_trail_2"] = set_pixels(visor_base, [(11, 15, "q"), (12, 15, "q"), (15, 16, "z")])
    frames["hat_neon_trail_3"] = set_pixels(visor_base, [(8, 16, "z"), (14, 16, "W"), (15, 15, "q")])

    # 7. Arcane Hat (wizard_hat) - wide-brimmed pointed indigo mage hat seated slightly higher (y=0..10) so eyes never crowd!
    wiz_base = stamp_rows(
        [
            (0, "..........####.........."),
            (1, ".........#IIII#........."),
            (2, "........#IIttII#........"),
            (3, "........#IIIIII#........"),
            (4, ".......#IIItIIII#......."),
            (5, ".......#IIIIIIII#......."),
            (6, "......#IIItItIIII#......"),
            (7, "......#gggggGgggg#......"),
            (8, "....###IIggyyggII###...."),
            (9, "...#IIIIIIggggIIIIII#..."),
            (10, "....################...."),
        ]
    )
    frames["hat_wizard_hat_0"] = wiz_base
    frames["hat_wizard_hat_1"] = set_pixels(wiz_base, [(11, 4, "y"), (11, 8, "W")])
    frames["hat_wizard_hat_2"] = set_pixels(wiz_base, [(11, 4, "W"), (12, 4, "y"), (9, 6, "q")])
    frames["hat_wizard_hat_3"] = set_pixels(wiz_base, [(11, 4, "y"), (12, 8, "W")])

    # 8. Shadow Cat Ears (cat_ears) - separate left/right ear bases so forehead crown remains open & crisp
    cat_base = stamp_rows(
        [
            (5, ".......##......##......."),
            (6, "......#SS#....#SS#......"),
            (7, ".....#SpS#....#SpS#....."),
            (8, ".....#SPPS#..#SPPS#....."),
            (9, ".....#SSSS#..#SSSS#....."),
            (10, "......####....####......"),
        ]
    )
    cat_twitch = stamp_rows(
        [
            (5, ".......##..............."),
            (6, "......#SS#.....###......"),
            (7, ".....#SpS#....#SpS#....."),
            (8, ".....#SPPS#..#SPPS#....."),
            (9, ".....#SSSS#..#SSSS#....."),
            (10, "......####....####......"),
        ]
    )
    frames["hat_cat_ears_0"] = cat_base
    frames["hat_cat_ears_1"] = cat_base
    frames["hat_cat_ears_2"] = cat_twitch
    frames["hat_cat_ears_3"] = cat_base

    # 9. Demon Horns (devil_horns) - separate left/right horn bases with sharp glowing highlights
    horns_a = stamp_rows(
        [
            (4, ".....##..........##....."),
            (5, "....#rR#........#Rr#...."),
            (6, "....#rR#........#Rr#...."),
            (7, ".....#RR#......#RR#....."),
            (8, ".....#RXR#....#RXR#....."),
            (9, "......#XX#....#XX#......"),
            (10, ".......##......##......."),
        ]
    )
    frames["hat_devil_horns_0"] = horns_a
    frames["hat_devil_horns_1"] = set_pixels(horns_a, [(5, 5, "p"), (18, 5, "p")])
    frames["hat_devil_horns_2"] = set_pixels(horns_a, [(5, 5, "W"), (18, 5, "W"), (6, 6, "u"), (17, 6, "u")])
    frames["hat_devil_horns_3"] = set_pixels(horns_a, [(5, 5, "u"), (18, 5, "u")])

    # 10. Frog Hood (frog_hat) - adorable bright green frog cap with big wide frog eyes that blink!
    frog_open = stamp_rows(
        [
            (4, ".......###....###......."),
            (5, "......#lLl#..#lLl#......"),
            (6, "......#WkL####LkW#......"),
            (7, "......#WWLllllLWW#......"),
            (8, "......#lLLLLLLLLl#......"),
            (9, "......#LLffffffLL#......"),
            (10, ".......##########......."),
        ]
    )
    frog_blink = stamp_rows(
        [
            (5, ".......###....###......."),
            (6, "......#lll#..#lll#......"),
            (7, "......#fff####fff#......"),
            (8, "......#lLLLLLLLLl#......"),
            (9, "......#LLffffffLL#......"),
            (10, ".......##########......."),
        ]
    )
    frames["hat_frog_hat_0"] = frog_open
    frames["hat_frog_hat_1"] = frog_open
    frames["hat_frog_hat_2"] = frog_open
    frames["hat_frog_hat_3"] = frog_blink

    return frames


def pack_atlas(costumes: dict[str, Image.Image], hats: dict[str, Image.Image]) -> tuple[Image.Image, dict]:
    """Pack all 20x20 costume frames and 24x28 hat frames cleanly with 2px padding."""
    pad = 2
    cur_x = pad
    cur_y = pad
    row_h = 0
    placed: list[tuple[str, int, int, Image.Image]] = []

    def place_group(group: list[tuple[str, Image.Image]], cols_per_row: int) -> None:
        nonlocal cur_x, cur_y, row_h
        for i, (name, img) in enumerate(group):
            w, h = img.size
            if i > 0 and i % cols_per_row == 0:
                cur_x = pad
                cur_y += row_h + pad
                row_h = 0
            placed.append((name, cur_x, cur_y, img))
            cur_x += w + pad
            row_h = max(row_h, h)

    default_items = [(k, v) for k, v in costumes.items() if k.startswith("default_")]
    costume_items = [(k, v) for k, v in costumes.items() if not k.startswith("default_")]
    hat_items = list(hats.items())

    place_group(default_items, 12)
    cur_x = pad
    cur_y += row_h + pad
    row_h = 0

    place_group(costume_items, 12)
    cur_x = pad
    cur_y += row_h + pad
    row_h = 0

    place_group(hat_items, 8)
    total_h = cur_y + row_h + pad
    total_w = max(x + im.width + pad for _, x, _, im in placed)

    atlas_img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
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
            "app": "dungeonle-cosmetics-builder",
            "version": "1.0",
            "image": "cosmetics_atlas.png",
            "format": "RGBA8888",
            "size": {"w": total_w, "h": total_h},
            "scale": "1",
        },
    }
    return atlas_img, atlas_json


def make_preview_sheet(costumes: dict[str, Image.Image], hats: dict[str, Image.Image]) -> Image.Image:
    """Render 4x zoomed visual QA grid: all costumes, all hats on hero, and signature combos."""
    costume_names = [
        "default",
        "costume_crimson",
        "costume_forest",
        "costume_viking",
        "costume_royal",
        "costume_shadow",
        "costume_yeti",
        "costume_gold",
        "costume_skeleton",
        "costume_phantom",
    ]
    hat_names = [
        "crown_crest",
        "angel_halo",
        "bunny_ears",
        "snoo_antenna",
        "flame_halo",
        "neon_trail",
        "wizard_hat",
        "cat_ears",
        "devil_horns",
        "frog_hat",
    ]

    cell_w, cell_h = 28, 32
    cols = 10
    rows = 4
    grid = Image.new("RGBA", (cols * cell_w, rows * cell_h), (28, 22, 34, 255))

    def draw_combo(col: int, row: int, cos: str, hat: str | None, frame_idx: int = 0) -> None:
        buf = Image.new("RGBA", (24, 28), (0, 0, 0, 0))
        hero_key = f"{cos}_idle_{frame_idx}"
        buf.alpha_composite(costumes[hero_key], (2, 6))
        if hat:
            dy = 1 if frame_idx == 1 else 0
            buf.alpha_composite(hats[f"hat_{hat}_{frame_idx}"], (0, dy))
        grid.alpha_composite(buf, (col * cell_w + 2, row * cell_h + 2))

    # Row 0: All 10 outfits bare (idle_0)
    for c_idx, c_name in enumerate(costume_names):
        draw_combo(c_idx, 0, c_name, None, 0)

    # Row 1: All 10 outfits running/glinting (idle_2 or run_0)
    for c_idx, c_name in enumerate(costume_names):
        if c_name == "default":
            draw_combo(c_idx, 1, c_name, None, 2)
        else:
            buf = Image.new("RGBA", (24, 28), (0, 0, 0, 0))
            buf.alpha_composite(costumes[f"{c_name}_run_0"], (2, 6))
            grid.alpha_composite(buf, (c_idx * cell_w + 2, 1 * cell_h + 2))

    # Row 2: All 10 hats on default hero
    for h_idx, h_name in enumerate(hat_names):
        draw_combo(h_idx, 2, "default", h_name, 0)

    # Row 3: Cross-combos (diverse outfits + hats animated frame 2!)
    combos = [
        ("costume_crimson", "devil_horns"),
        ("costume_forest", "frog_hat"),
        ("costume_viking", "angel_halo"),
        ("costume_royal", "wizard_hat"),
        ("costume_shadow", "neon_trail"),
        ("costume_yeti", "bunny_ears"),
        ("costume_gold", "crown_crest"),
        ("costume_skeleton", "flame_halo"),
        ("costume_phantom", "snoo_antenna"),
        ("costume_shadow", "cat_ears"),
    ]
    for idx, (c_name, h_name) in enumerate(combos):
        draw_combo(idx, 3, c_name, h_name, 2)

    return grid.resize((grid.width * 4, grid.height * 4), Image.Resampling.NEAREST)


def main() -> None:
    atlas, meta = load_dungeon_atlas()

    costumes = build_costumes(atlas, meta)
    hats = build_hats()
    out_img, out_json = pack_atlas(costumes, hats)

    out_img.save(OUT_PNG)
    OUT_JSON.write_text(json.dumps(out_json, indent=2) + "\n")
    print(f"Wrote {OUT_PNG} {out_img.size} and {OUT_JSON} ({len(out_json['frames'])} frames)")

    try:
        SCRATCH_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        preview = make_preview_sheet(costumes, hats)
        preview.save(SCRATCH_PREVIEW)
        print(f"Wrote 4x preview sheet -> {SCRATCH_PREVIEW} {preview.size}")
    except OSError as err:
        print(f"Skipped scratch preview: {err}")


if __name__ == "__main__":
    main()
