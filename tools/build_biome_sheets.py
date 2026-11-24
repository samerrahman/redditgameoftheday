#!/usr/bin/env python3
"""
Builds shader-calibrated, 100% original 1:1 outdoor biome sprite sheets for Dungeonle
(inspired by Stardew Valley, Minish Cap, Enter the Gungeon, Celeste, and Advance Wars):

  - public/assets/ski/tilemap_packed.png    (192x176, 12 cols x 11 rows)
  - public/assets/town/tilemap_packed.png   (192x176, 12 cols x 11 rows)
  - public/assets/battle/tilemap_packed.png (288x176, 18 cols x 11 rows)
  - public/assets/farm/tilemap_packed.png   (192x176, 12 cols x 11 rows)

Palettes are tuned specifically for DungeonAtmosphereFilter.ts (uGrade = [1.35, 1.08, 1.06, 0.35])
so ground tiles stay cohesive and restful while enemies and hazards read crisply.
"""

from __future__ import annotations

import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
SCRATCH_DIR = Path(
    "/Users/Samer/.gemini/antigravity/brain/681e0dd1-392e-45a9-b08c-5ca9e857fe94/scratch"
)
SCRATCH_PREVIEW = SCRATCH_DIR / "biome_sheets_preview.png"
SCRATCH_ROOMS = SCRATCH_DIR / "biome_rooms_preview.png"

# Carefully calibrated palette: selective dark biome-tinted outlines on terrain/props,
# unified #1c1221 ink outlines on actors/hazards, muted earthy ground values.
PAL: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "#": (28, 18, 33, 255),      # #1c1221 character/enemy ink outline
    "@": (42, 30, 24, 255),      # selective warm walnut outline (wood/hay/soil/brick)
    "%": (36, 52, 34, 255),      # selective deep moss outline (leaves/bushes/hedges)
    "&": (40, 48, 62, 255),      # selective cool slate outline (rock/metal/snow)
    # ------------------------------------------------------------------
    # Snow & alpine ice (Celeste-inspired twilight values so torchlight won't blow out white)
    "Q": (182, 200, 222, 255),   # snow drift crest highlight
    "q": (152, 174, 198, 255),   # snow midtone
    "z": (124, 146, 172, 255),   # snow soft hollow / drift shadow
    "Z": (98, 120, 148, 255),    # deep snow track / glacier crevice
    "a": (56, 189, 248, 255),    # glowing yeti eye cyan
    "A": (34, 134, 198, 255),    # deep water blue
    "k": (186, 230, 253, 255),   # frost spell crystal gleam
    # Cool granite & wrought steel
    "W": (228, 235, 244, 255),   # crisp specular steel/horn tip
    "w": (176, 186, 202, 255),   # light steel / bone highlight
    "s": (118, 130, 148, 255),   # mid steel / slate stone
    "S": (84, 95, 114, 255),     # dark steel / basalt mid
    "d": (58, 66, 82, 255),      # shadowed stone / tread
    "D": (42, 46, 60, 255),      # deepest iron / tread recess
    # Old Town Minish/Gungeon flagstones (low-contrast warm taupe/plum-slate, zero harsh black grid)
    "n": (106, 97, 114, 255),    # cobble top-left highlight
    "N": (88, 80, 96, 255),      # cobble stone midtone A
    "m": (78, 70, 86, 255),      # cobble stone midtone B
    "M": (66, 59, 74, 255),      # cobble bottom-right bevel
    "_": (56, 49, 63, 255),      # subtle low-contrast mortar
    # Earth, timber, oak bark & soil (Stardew earthy browns)
    "t": (166, 132, 90, 255),    # sawn heartwood / light straw / khaki highlight
    "b": (122, 86, 54, 255),     # oak plank midtone / chestwood
    "B": (88, 60, 38, 255),      # dark bark / shaded timber
    "x": (64, 44, 30, 255),      # deep earth / churned mud crevice
    "X": (80, 62, 48, 255),      # tilled soil base / smooth battlefield earth
    "T": (98, 76, 58, 255),      # tilled soil lit ridge / earth fleck
    "h": (146, 126, 92, 255),    # military khaki sandbag lit
    "H": (118, 102, 74, 255),    # military khaki sandbag shade
    # Muted Stardew sage meadow grass (never neon under uGrade vibrance!)
    "E": (102, 128, 76, 255),    # warm sunlight leaf highlight
    "e": (86, 114, 65, 255),     # grass tuft highlight / courtyard leaf
    "g": (70, 96, 54, 255),      # meadow grass midtone (main floor)
    "G": (58, 82, 46, 255),      # subtle blade shadow / deep moss
    "f": (46, 68, 42, 255),      # pine/canopy mid-dark green
    "F": (33, 52, 34, 255),      # deep evergreen shadow
    "l": (126, 168, 56, 255),    # tank tactical olive-lime stripe
    # Straw hay, amber & autumn leaves (restrained golden wheat tones, never neon!)
    "Y": (212, 194, 138, 255),   # cream blossom / wool / sunlit straw tip
    "y": (176, 146, 76, 255),    # golden hay top / corn cob / sunflower
    "o": (142, 110, 54, 255),    # wheat hay mid / autumn maple
    "O": (108, 78, 38, 255),     # shaded straw / autumn shadow
    # Desaturated crimson, rust, terracotta & ember
    "r": (182, 68, 62, 255),     # banner / tomato / comb crimson
    "R": (132, 44, 42, 255),     # shaded crimson / brick shadow
    "v": (158, 92, 66, 255),     # terracotta amphora highlight
    "V": (118, 64, 46, 255),     # terracotta shadow
    "u": (214, 122, 54, 255),    # fuse spark / carrot / warm flame
    "p": (236, 108, 174, 255),   # bull glow eye / pink accent
    # Cobalt pennant
    "c": (66, 118, 198, 255),
    "C": (44, 78, 142, 255),
}


def paint16(rows: list[str], extra: dict[str, tuple[int, int, int, int]] | None = None) -> Image.Image:
    assert len(rows) == 16, f"Expected 16 rows, got {len(rows)}"
    pal = dict(PAL)
    if extra:
        pal.update(extra)
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        assert len(row) == 16, f"Row {y} len {len(row)} != 16: {row!r}"
        for x, ch in enumerate(row):
            if ch != ".":
                px[x, y] = pal[ch]
    return im


def fill_solid(ch: str) -> list[str]:
    return [ch * 16 for _ in range(16)]


def set_pixels(rows: list[str], edits: list[tuple[int, int, str]]) -> list[str]:
    grid = [list(r) for r in rows]
    for x, y, ch in edits:
        grid[y][x] = ch
    return ["".join(r) for r in grid]


def place_tiles(cols: int, rows: int, mapping: dict[int, Image.Image]) -> Image.Image:
    sheet = Image.new("RGBA", (cols * 16, rows * 16), (0, 0, 0, 0))
    for idx, im in mapping.items():
        sheet.alpha_composite(im, ((idx % cols) * 16, (idx // cols) * 16))
    return sheet


# ---------------------------------------------------------------------------
# 1. Frozen Slopes (ski/tilemap_packed.png — 12 cols x 11 rows)
# ---------------------------------------------------------------------------
def build_ski_sheet() -> tuple[Image.Image, dict[int, Image.Image]]:
    # Celeste-style sculpted soft twilight snow (cool grey-blue shadows, crisp top-left drift ridges)
    snow_base = paint16(
        set_pixels(
            fill_solid("q"),
            [
                (2, 2, "Q"), (3, 2, "Q"), (4, 3, "z"),
                (10, 5, "Q"), (11, 5, "Q"), (11, 6, "z"),
                (5, 10, "z"), (6, 10, "z"), (7, 10, "z"), (6, 9, "Q"),
                (12, 13, "Q"), (13, 13, "z"), (1, 13, "z"),
            ],
        )
    )
    snow_tracks = paint16(
        set_pixels(
            fill_solid("q"),
            [
                (3, 1, "z"), (4, 2, "Z"), (4, 3, "z"), (5, 4, "Z"), (5, 5, "z"),
                (6, 6, "Z"), (6, 7, "z"), (7, 8, "Z"), (7, 9, "z"), (8, 10, "z"),
                (7, 1, "z"), (8, 2, "Z"), (8, 3, "z"), (9, 4, "Z"), (9, 5, "z"),
                (10, 6, "Z"), (10, 7, "z"), (11, 8, "Z"), (11, 9, "z"), (12, 10, "z"),
                (2, 11, "Q"), (3, 11, "Q"), (13, 13, "z"),
            ],
        )
    )
    snow_drift = paint16(
        [
            "qqqqqqqqqqqqqqqq",
            "qQQQQqQqqqqqqqqq",
            "qqzzqzzqqqQQqqqq",
            "qqqqqqqqqqqqqqqq",
            "qqqqqQQQQqqqqqqq",
            "qqqqqzzzzzzqqqqq",
            "qqqqqqqqqqqqqqqq",
            "qqqqqqqqqqqQQqqq",
            "qqqqqqqqqqqzzqqq",
            "qQQqQqqqqqqqqqqq",
            "qqzzqqqqqQQQQqqq",
            "qqqqqqqqqqzzzzqq",
            "qqqqqqqqqqqqqqqq",
            "qqqqQQqqqqqqqqqq",
            "qqqqzzqqqqqqqQQq",
            "qqqqqqqqqqqqqqqq",
        ]
    )
    icy_path_a = paint16(
        [
            "zzqqqqqzzzzqqqqz",
            "zqQQqqqzZZzqQQqz",
            "zqqzzqqzzzqqzzqz",
            "zzzzzzzzzzzzzzzz",
            "qzzqqqqqzzqqqqqz",
            "qzQQqzzqqzQqqzzz",
            "qqzzqqqqqqqzzqqz",
            "zzzZZzzzzzzzzZZz",
            "zzqqqqzqqqqqqzzz",
            "zqQQqqzzQQqqqqqz",
            "zqqzzzzzqqqzzqqz",
            "zzzzZZzzzzzzZZzz",
            "qqqqqqzzqqqqqqqz",
            "qQQqqqzzQQqqqzzz",
            "qqqzzzzzqqqzzzzz",
            "zzzzzzzzzzzzzzzz",
        ]
    )
    icy_path_b = paint16(
        [
            "zzzzqqqqzzqqqqqz",
            "zZZzQqqqzQQqzzqz",
            "zzzzqzzqzzzzzzqz",
            "qzqqqqqqqqzzqzzz",
            "qQQqzzqqqqzZZzqz",
            "qqqzzqqqQQqqzzqz",
            "zzzzzZZzzzzzzzzz",
            "zzqqqqzzqqqqqzqz",
            "zqQqqqzzQqqqqzzz",
            "zqqzzzzzqqqqzZZz",
            "zzzzZZzzzzzzzzzz",
            "qzzqqqqqzzqqqqqz",
            "qzzQQqqqzzQqqzzz",
            "qqqqqzzzzzqqqzzz",
            "zzzzzzzzzzzzzzzz",
            "zzqqqqzzzzqqqzzz",
        ]
    )
    # 81: Glacier Crag (angular layered stone draped unevenly in alpine snow, selective & outline)
    glacier_crag = paint16(
        [
            "....&&&.........",
            "..&&QQQ&&&......",
            ".&QQQQqqQQ&&&...",
            "&QQqqzqqzQQqq&&.",
            "&qzssSSSSzqzzq&.",
            "&sSssSSSSSszzs&.",
            "&SSddddSSSSSSSd&",
            "&SddDDdSSSSdSSd&",
            "&ddDDDDdSSddddd&",
            "&dDDDDDddddDDdD&",
            ".&DDDDDddddddDD&",
            ".&&DDDDDDDDDDD&.",
            "..&&&DDDDDDD&&..",
            "....&&&&&&&&&...",
            "................",
            "................",
        ]
    )
    # 6 + 18: Asymmetric layered snow-capped pine
    tall_pine_top = paint16(
        [
            ".......&&.......",
            "......&QQ&......",
            ".....&QQqq&.....",
            ".....&fGGz&.....",
            "....&gfFFff&....",
            "...&QQqfFFqQ&...",
            "...&qzGfFFGz&...",
            "..&ggFFFFFFgf&..",
            ".&QQqfFFFFFqQQ&.",
            ".&zzGfFFFFFGzz&.",
            ".&fGFFFFFFFFGf&.",
            "&QQzfFFFFFFFzQQ&",
            "&zzGFFFFFFFFGzz&",
            ".&fFFGFFFFGFFf&.",
            "&QQzFFFFFFFFzQQ&",
            ".&zzFFFFFFFFzz&.",
        ]
    )
    tall_pine_bot = paint16(
        [
            "&gfFFFFFFFFFFfg&",
            "&QQzFFFFFFFFzQQ&",
            ".&zz&fFFFFf&zz&.",
            "....&&fFFf&&....",
            "......@bB@......",
            "......@bB@......",
            "......@BB@......",
            ".....@xBBx@.....",
            "....&qz@@zq&....",
            "...&QQqzzqQQ&...",
            "....&&&&&&&&....",
            "................",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    small_pine = paint16(
        [
            "................",
            ".......&&.......",
            "......&QQ&......",
            ".....&QQqz&.....",
            "....&gfFFff&....",
            "...&QQzFFzQQ&...",
            "...&zzGFFGzz&...",
            "..&gfFFFFFFfg&..",
            ".&QQzFFFFFFzQQ&.",
            ".&zz&FFFFFF&zz&.",
            "....&&@@@@&&....",
            "......@bB@......",
            ".....@xBBx@.....",
            "....&qz@@zq&....",
            ".....&&&&&&.....",
            "................",
        ]
    )
    bare_top = paint16(
        [
            "...&&......&&...",
            "..&QB&....&BQ&..",
            "..&qB@....@Bq&..",
            "...&Bb@..@bB@...",
            ".&&.@Bb@@bB@.&&.",
            "&QQ&@BBbbBB@&QQ&",
            ".&&qz@BBBB@zq&&.",
            "....@@BBbB@@....",
            ".....@BBBB@.....",
            ".....@xBBb@.....",
            ".....@xBBb@.....",
            ".....@xBBb@.....",
            ".....@xBBb@.....",
            ".....@xBBb@.....",
            ".....@xBBb@.....",
            ".....@xBBb@.....",
        ]
    )
    bare_bot = paint16(
        [
            ".....@xBBb@.....",
            ".....@xBBb@.....",
            "....&@xBBb@&....",
            "...&QQxBBbQQ&...",
            "....&zxBBbz&....",
            "....@@xBBx@@....",
            "...@xxBBBBxx@...",
            "..&QQz@@@@zQQ&..",
            "...&&&&&&&&&&...",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    snowman = paint16(
        [
            ".....&&&&&&.....",
            "....&dDDDDd&....",
            "....&DDDDDD&....",
            "...&&&&&&&&&&...",
            "....&QQQQqz&....",
            "....&Q&QQ&q&....",
            "....&QQuuqz&....",
            ".....@rrrr@.....",
            "....@RRrrRR@....",
            "...&QQQqqqz&....",
            "..@@BQQ&QzzB@@..",
            ".@B.@QQqqzz@.B@.",
            "....&qqzzzz&....",
            ".....&&&&&&.....",
            "................",
            "................",
        ]
    )
    stump = paint16(
        [
            "................",
            "................",
            "....@@@@@@@@....",
            "...&QQQqqqzz&...",
            "..&QQztbbtzzq&..",
            "..&qz@@@@@@zq&..",
            "...@bBBBBBBx@...",
            "...@bBBxBBxx@...",
            "..@bbBBxxBBxx@..",
            ".@xbBBBxxBBBxx@.",
            ".&qzz@@@@@@zzq&.",
            "..&&&&&&&&&&&&..",
            "................",
            "................",
            "................",
            "................",
        ]
    )

    def flag_pair(hi: str, lo: str) -> tuple[Image.Image, Image.Image]:
        top = paint16(
            [
                "....@@..........",
                "...&wS&.........",
                "...&wS@@@@@.....",
                "...&wS@" + hi * 4 + "@@...",
                "...&wS@" + hi * 5 + lo + "@..",
                "...&wS@" + hi * 3 + lo * 4 + "@@",
                "...&wS@" + lo * 6 + "@..",
                "...&wS@" + lo * 5 + "@@..",
                "...&wS@@@@@@@...",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
            ]
        )
        bot = paint16(
            [
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&wS&.........",
                "...&qz&.........",
                "..&QQzz&........",
                "...&&&&.........",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
            ]
        )
        return top, bot

    red_flag_top, red_flag_bot = flag_pair("r", "R")
    blue_flag_top, blue_flag_bot = flag_pair("c", "C")

    # 78, 79, 80: Frost Yeti Enemy (broad tufted glacier yeti w/ curved horns & glowing eyes, # ink outline)
    yeti_walk_0 = paint16(
        [
            "..###......###..",
            ".#wS##QQQQ##Sw#.",
            "..##QQQQqqqq##..",
            "..#QQ#dDDDD#q#..",
            ".#QQq#DaDDa#qq#.",
            ".#Qqz#dDDDD#qz#.",
            "#QQqq########zz#",
            "#Qq#QQqqqqzz#zz#",
            "#q.#QQqzzzzz#.Z#",
            "#..#qzzZZZZZ#.#.",
            "...#zzZ##Zzz#...",
            "...#zZ#..#ZZ#...",
            "..#zz#....#ZZ#..",
            "..###......###..",
            "................",
            "................",
        ]
    )
    yeti_walk_1 = paint16(
        [
            "................",
            "..###......###..",
            ".#wS##QQQQ##Sw#.",
            "..##QQQQqqqq##..",
            "..#QQ#dDDDD#q#..",
            ".#QQq#DaDDa#qq#.",
            ".#Qqz#dDDDD#qz#.",
            "#QQqq########zz#",
            "#Qq#QQqqqqzz#zZ#",
            ".#.#QQqzzzzz#.#.",
            "...#qzz##ZZZ#...",
            "...#zz#..#ZZ#...",
            "..####....#zz#..",
            "..........####..",
            "................",
            "................",
        ]
    )
    yeti_cast = paint16(
        [
            ".##...####...##.",
            "#ka#.#QQQQ#.#ak#",
            "#aQ#.#S##S#.#Qa#",
            "#QQ##QzZZzQ##QQ#",
            ".#QQz#dDDd#zQQ#.",
            ".#Qzd#k##k#dzQ#.",
            "..##d#d##d#d##..",
            "...#z#######z#..",
            "...#QQqaaaqzz#..",
            "...#QQqakaqzz#..",
            "...#qzqaaaqzZ#..",
            "...#zzZZZZZZZ#..",
            "...#zzZ##ZZz#...",
            "..#zz#....#ZZ#..",
            "..###......###..",
            "................",
        ]
    )

    mapping: dict[int, Image.Image] = {
        0: snow_base,
        13: snow_tracks,
        16: snow_drift,
        49: icy_path_a,
        52: icy_path_b,
        81: glacier_crag,
        6: tall_pine_top,
        18: tall_pine_bot,
        30: small_pine,
        7: bare_top,
        19: bare_bot,
        69: snowman,
        47: stump,
        8: red_flag_top,
        20: red_flag_bot,
        9: blue_flag_top,
        21: blue_flag_bot,
        78: yeti_walk_0,
        79: yeti_walk_1,
        80: yeti_cast,
    }
    return place_tiles(12, 11, mapping), mapping


# ---------------------------------------------------------------------------
# 2. Old Town (town/tilemap_packed.png — 12 cols x 11 rows)
# ---------------------------------------------------------------------------
def build_town_sheet() -> tuple[Image.Image, dict[int, Image.Image]]:
    # Soft earthy Stardew grass patches matching town cobble luminance
    grass_plain = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (2, 3, "e"), (3, 3, "e"), (3, 4, "G"),
                (10, 2, "G"), (11, 2, "e"), (13, 6, "G"),
                (5, 9, "e"), (6, 9, "G"), (11, 12, "e"), (12, 12, "G"),
                (2, 13, "G"), (14, 14, "e"),
            ],
        )
    )
    grass_clover = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (3, 3, "e"), (4, 3, "E"), (4, 4, "G"),
                (10, 5, "G"), (11, 4, "e"), (12, 5, "e"),
                (6, 11, "E"), (7, 11, "e"), (6, 12, "G"),
                (13, 12, "G"), (2, 10, "e"),
            ],
        )
    )
    grass_flowers = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (3, 3, "Y"), (4, 3, "y"), (3, 4, "G"),
                (11, 5, "Y"), (12, 5, "r"), (11, 6, "G"),
                (6, 11, "Y"), (7, 11, "Y"), (6, 12, "G"),
                (13, 12, "e"), (1, 13, "G"),
            ],
        )
    )
    # 25: Battlefield churned earth patch (smooth compacted mud/loam, zero noisy checkerboard)
    mud_patch = paint16(
        [
            "XXXXXXXXXXXXXXXX",
            "XXXXTTTXXXXXXXXX",
            "XXTTXXXXXxxXXXXX",
            "XXXXXXXXxxxxXXXX",
            "XXTXXXXXXXXXXXTX",
            "XXXxxXXXXXTTTXXX",
            "XXXxXXXXXXXXXXXX",
            "XXXXXXXXXXxxXXXX",
            "XXXXTTTXXXxxXXXX",
            "XXTTXXXXXXXXXXXX",
            "XXXXXXXxxXXXXXTX",
            "XXXXXXxxxxXXXXXX",
            "XXTXXXXXXXXTTTXX",
            "XXXXXXXXXXXXxXXX",
            "XXXXXTTTXXXXXXXX",
            "XXXXXXXXXXXXXXXX",
        ]
    )
    # 109: Minish Cap / Enter the Gungeon organic rounded flagstones (soft warm taupe, quiet seams)
    cobble = paint16(
        [
            "_nnnnM_NNN_nmmM_",
            "mnNNmM_nNm_NmmMM",
            "mMMMM__MMM_MMMM_",
            "________________",
            "NNN_mmmm_nNNNNm_",
            "NmM_nNNm_nNmmmM_",
            "MM__MMM__MMMMMM_",
            "________________",
            "_nnnnmM_mmmm_nn_",
            "mnNNNMM_nNNm_NmM",
            "_MMMMMM_MMMM_MM_",
            "________________",
            "mMM_nnnnnn_mmMN_",
            "NmM_nNNNNm_NNmM_",
            "MM__MMMMMM_MMM__",
            "________________",
        ]
    )
    # Solid Blocks: 106 (Stout Oak Log), 130 (Oak Barrel), 107 (Terracotta Pot), 131 (Rain Barrel)
    oak_log = paint16(
        [
            "................",
            "................",
            "...@@@@@@@@@@...",
            "..@t@bbbbbbBB@..",
            ".@tb@bBBBeeeBB@.",
            ".@tt@bbBgeGbbB@.",
            ".@tb@bbBBBBbbB@.",
            ".@tB@bBBBBbbxB@.",
            ".@B@@bbBBxxxxB@.",
            "..@x@BBBBxxxx@..",
            "...@@@@@@@@@@...",
            "................",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    barrel_block = paint16(
        [
            "....@@@@@@@@....",
            "..@@tbbbbbbb@@..",
            ".@tbBBBBBBBBBx@.",
            ".@ssssssssssss@.",
            "@dSSSSSSSSSSSSd@",
            "@tbbbbBBBBbbbbx@",
            "@tbbtBBBBBBbxBx@",
            "@tbbbbBBBBbbbbx@",
            "@tbbbbBBBBbbbbx@",
            "@ssssssssssssss@",
            "@dSSSSSSSSSSSSd@",
            "@bBBBBxxxxBBBBx@",
            ".@bBBBBxxBBBBx@.",
            ".@@BBBBxxBBBB@@.",
            "...@@@@@@@@@@...",
            "................",
        ]
    )
    pot_block = paint16(
        [
            "................",
            "....@@@@@@@@....",
            "...@vvvvvVVV@...",
            "....@VV@@@@V@...",
            "...@@vvVVVV@@...",
            "..@vv@@vv@@VV@..",
            ".@vvvVVVVVVVVV@.",
            ".@vvvVVVVVVVVV@.",
            ".@vVVVVVVVVVVV@.",
            "..@VVVVVVVVVV@..",
            "..@VVVVVVVVVV@..",
            "...@VVVVVVVV@...",
            "....@VVVVVV@....",
            "....@@@@@@@@....",
            "................",
            "................",
        ]
    )
    water_barrel = paint16(
        [
            "....@@@@@@@@....",
            "..@@t#aaaa#B@@..",
            ".@tb#kAAAAa#bx@.",
            ".@ss#aaaaaa#ss@.",
            "@dSS########SSd@",
            "@tbbbBBBBBBBBbx@",
            "@tbbbBBBBBBBBbx@",
            "@tbbbbBBBBbbbbx@",
            "@ssssssssssssss@",
            "@dSSSSSSSSSSSSd@",
            "@bBBBBxxxxBBBBx@",
            ".@bBBBBxxBBBBx@.",
            ".@@BBBBxxBBBB@@.",
            "...@@@@@@@@@@...",
            "................",
            "................",
        ]
    )
    # 105: Alley Sapper iron bomb (# ink outline so hazard always pops!)
    sapper_bomb = paint16(
        [
            "..........#uY#..",
            ".........#Y#.#u.",
            "........#B#.....",
            ".......#B#......",
            ".....######.....",
            "....#yooooO#....",
            "...##dddddd##...",
            "..#dwwsdddddd#..",
            "..#dwsddddddd#..",
            "..#dddddddddd#..",
            "..#ddddDDdddd#..",
            "..#dddDDDDddd#..",
            "...#dDDDDDDd#...",
            "....#DDDDDD#....",
            ".....######.....",
            "................",
        ]
    )

    def town_tree(outl: str, hi: str, mid: str, lo: str, dark: str) -> tuple[Image.Image, Image.Image]:
        top = paint16(
            [
                "....%%" + outl * 4 + "%%....",
                "..%%" + hi * 4 + mid * 4 + "%%..",
                "." + outl + hi * 4 + mid * 5 + lo * 3 + outl + ".",
                "." + outl + hi * 2 + mid * 6 + lo * 4 + outl + ".",
                outl + hi * 2 + mid * 6 + lo * 4 + dark * 2 + outl,
                outl + mid * 7 + lo * 5 + dark * 2 + outl,
                outl + mid * 5 + lo * 6 + dark * 3 + outl,
                outl + mid * 4 + lo * 6 + dark * 4 + outl,
                outl + lo * 9 + dark * 5 + outl,
                "." + outl + lo * 6 + dark * 6 + outl + ".",
                "." + outl + lo * 4 + dark * 8 + outl + ".",
                "..%%%" + dark * 6 + "%%%..",
                ".....@@@@@@.....",
                ".....@bBBB@.....",
                ".....@bBBB@.....",
                ".....@xBBx@.....",
            ]
        )
        bot = paint16(
            [
                ".....@bBBB@.....",
                ".....@bBBB@.....",
                ".....@bBBB@.....",
                ".....@xBBx@.....",
                ".....@xBBx@.....",
                "....@bxBBxb@....",
                "...%xB@@@@Bx%...",
                "...%%%%%%%%%%...",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
            ]
        )
        return top, bot

    green_tree_top, green_tree_bot = town_tree("%", "e", "g", "G", "f")
    autumn_tree_top, autumn_tree_bot = town_tree("@", "y", "o", "O", "R")

    bush = paint16(
        [
            "................",
            "................",
            "....%%%%%%%%....",
            "..%%eeeggggg%%..",
            ".%eegggRggGggG%.",
            ".%egGgggggRGGG%.",
            "%egGGgGggGGGGGG%",
            "%gGGgRGGgGGGRGG%",
            "%gGGGGGGGGGGGGG%",
            ".%GGGGffffGGGG%.",
            ".%%GffffffffG%%.",
            "...%%%%%%%%%%...",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    signpost = paint16(
        [
            "................",
            "..@@@@@@@@@@@@..",
            ".@tttttttttttb@.",
            ".@tbbtbbbtbbtB@.",
            ".@tbbbbbbbbbBB@.",
            ".@BbbbbBBBBBBB@.",
            "..@@@@@@@@@@@@..",
            "......@bB@......",
            "......@bB@......",
            "......@bB@......",
            "......@xB@......",
            ".....%gxBg%.....",
            "......%%%%......",
            "................",
            "................",
            "................",
        ]
    )
    beehive = paint16(
        [
            "................",
            ".....@@@@@@.....",
            "....@yyyyyy@....",
            "...@yyyyoooo@...",
            "...@@@@@@@@@@...",
            "..@yyyooooooo@..",
            "..@@@@@@@@@@@@..",
            "..@yyoooo@@OO@..",
            "..@oooooo@@OO@..",
            "...@@@@@@@@@@...",
            "...@OOooooOO@...",
            "....@@@@@@@@....",
            "....@B@..@B@....",
            "....@@@..@@@....",
            "................",
            "................",
        ]
    )

    mapping: dict[int, Image.Image] = {
        109: cobble,
        0: grass_plain,
        1: grass_clover,
        2: grass_flowers,
        25: mud_patch,
        130: barrel_block,
        107: pot_block,
        131: water_barrel,
        105: sapper_bomb,
        4: green_tree_top,
        16: green_tree_bot,
        3: autumn_tree_top,
        15: autumn_tree_bot,
        5: bush,
        83: signpost,
        94: beehive,
        106: oak_log,
    }
    return place_tiles(12, 11, mapping), mapping


# ---------------------------------------------------------------------------
# 3. Battlefield (battle/tilemap_packed.png — 18 cols x 11 rows)
# ---------------------------------------------------------------------------
def build_battle_sheet() -> tuple[Image.Image, dict[int, Image.Image]]:
    # Restrained Stardew meadow grass: readable & restful in Farmlands, warm olive under 0xd9e68a
    meadow_0 = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (2, 2, "e"), (3, 3, "G"), (11, 2, "e"), (14, 6, "G"),
                (6, 9, "e"), (7, 9, "e"), (12, 11, "G"), (3, 13, "e"),
                (14, 14, "e"), (1, 10, "G"), (8, 5, "G"),
            ],
        )
    )
    meadow_1 = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (4, 3, "e"), (5, 3, "E"), (4, 4, "G"), (12, 7, "e"),
                (13, 7, "E"), (13, 8, "G"), (2, 12, "G"), (9, 13, "e"),
                (10, 13, "G"), (6, 1, "G"), (15, 11, "G"),
            ],
        )
    )
    meadow_2 = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (3, 4, "Y"), (4, 4, "Y"), (3, 5, "G"), (11, 9, "y"),
                (12, 9, "Y"), (11, 10, "e"), (6, 2, "e"), (14, 3, "G"),
                (2, 13, "e"), (9, 14, "G"),
            ],
        )
    )
    # 25: Military Khaki Sandbag & Timber Barricade (desaturated tan sandbags, dark wood stakes)
    barricade = paint16(
        [
            "................",
            "..@bb@....@bb@..",
            "..@tB@@@@@@Bt@..",
            ".@hhhhHHHHhhhh@.",
            ".@hhh@@@@@@hhh@.",
            "@hhh@BBBBBB@hhh@",
            "@HHH@@@@@@@@HHH@",
            "@thhhhHHHthhhhH@",
            "@hhHHHHHHhhHHHH@",
            "@thhhHHHHthhhHH@",
            "@HHHHHHHHHHHHHH@",
            ".@HHHHHHHHHHHH@.",
            "..@@@@@@@@@@@@..",
            "................",
            "................",
            "................",
        ]
    )
    # 23: Weathered Steel Czech Hedgehog Tank Trap
    tank_trap = paint16(
        [
            "..&&........&&..",
            ".&ws&......&sw&.",
            ".&sSd&....&dSs&.",
            "..&sSd&..&dSs&..",
            "...&sS&&&&Ss&...",
            "....&wwssSS&....",
            "...&&sSSSSs&&...",
            "..&ws&dSSd&Sw&..",
            "..&sS&&dd&&Ss&..",
            "...&&.&SS&.&&...",
            ".....&sSSs&.....",
            "...&&sSd&dS&&...",
            "..&wSs&..&sSD&..",
            ".&sSD&....&DSs&.",
            ".&DD&......&DD&.",
            "..&&........&&..",
        ]
    )
    # 5: Mossy Granite Boulder (solid obstacle)
    boulder = paint16(
        [
            "....&&&&&&&&....",
            "..&&wwssssss&&..",
            ".&wwsssssSSsss&.",
            ".&wsssSSssssSS&.",
            "&ssSSSdddSSSSSd&",
            "&eessdddddddSSd&",
            "&GesssddddddddD&",
            "&GGesssDDDDdddD&",
            "&ddGGDDDDDDDDdd&",
            ".&ddDDDDDDDDdd&.",
            "..&&DDDDDDDD&&..",
            "....&&&&&&&&....",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    spruce = paint16(
        [
            ".......%%.......",
            "......%gg%......",
            ".....%ggGG%.....",
            "....%GGffGG%....",
            "...%ggffffGG%...",
            "..%GGffffffGG%..",
            "..%Gfffffffff%..",
            "...%%ffffff%%...",
            "..%ggffffffGG%..",
            ".%GGFFFFFFFFGG%.",
            "..%%FFFFFFFF%%..",
            "......@Bx@......",
            "......@Bx@......",
            ".....@xBBx@.....",
            "......@@@@......",
            "................",
        ]
    )
    tree_pair = paint16(
        [
            "...%%...........",
            "..%gg%.....%%...",
            ".%ggGG%...%gg%..",
            "%GGffGG%.%ggGG%.",
            ".%ffff%.%GGffGG%",
            "%GGffGG%%fffff%.",
            "%ffffffG%GGffGG%",
            ".%%ff%%.%ffffff%",
            "..@Bx@...%%ff%%.",
            "..@Bx@....@Bx@..",
            "..@@@.....@Bx@..",
            "..........@@@...",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    war_flag = paint16(
        [
            "...@y@..........",
            "...&s@@@@@......",
            "...&s@rrrr@@@...",
            "...&s@ryrrrRR@..",
            "...&s@ryyrrr@...",
            "...&s@rrrrRR@@..",
            "...&s@RRRRR@....",
            "...&s@@@@@@@....",
            "...&s&..........",
            "...&S&..........",
            "...&S&..........",
            "...&S&..........",
            "..&dSd&.........",
            "..&&&&&.........",
            "................",
            "................",
        ]
    )
    bunker = paint16(
        [
            "................",
            "...&&&&&&&&&&...",
            "..&wwssssssSS&..",
            ".&wssssssssSSSd&",
            ".&s&&&&&&&&&&Sd&",
            "&sS&DDDDDDDD&Sd&",
            "&sS&D&&&&&&D&Sd&",
            "&SS&DDDDDDDD&Sd&",
            "&SS&&&&&&&&&&Sd&",
            "&ddSSddddddSSdd&",
            "&ddDDDDDDDDDDdd&",
            "&dDDDDDDDDDDDDd&",
            ".&&&&&&&&&&&&&&.",
            "................",
            "................",
            "................",
        ]
    )
    # 152 & 153: Iron Tank (Advance Wars / Metal Slug detailed turret & caterpillar treads, # ink)
    tank_roll = paint16(
        [
            "................",
            "....########....",
            "...#wwssssss#...",
            "...#wsSSSSSS#...",
            "..###s#ll#SS###.",
            ".#wwsssllssssSS#",
            ".#ssss####sswww#",
            "#sSSSSs##sSSsww#",
            "#sSSSSSSSSSSs##.",
            "#ddddddddddddd#.",
            "#dD#s#D#s#D#s#d#",
            "#dDDDDDDDDDDDDd#",
            ".##############.",
            "................",
            "................",
            "................",
        ]
    )
    tank_fire = paint16(
        [
            "..........#YY#..",
            "....######YuuY#.",
            "...#wwssss#YuY#.",
            "...#wsSSSS##Y#..",
            "..###s#ll#SS###.",
            ".#wwsssllssssSS#",
            ".#ssss####sssss#",
            "#sSSSSs##sSSs##.",
            "#sSSSSSSSSSSs#..",
            "#ddddddddddddd#.",
            "#dD#s#D#s#D#s#d#",
            "#dDDDDDDDDDDDDd#",
            ".##############.",
            "................",
            "................",
            "................",
        ]
    )

    mapping: dict[int, Image.Image] = {
        0: meadow_0,
        1: meadow_1,
        2: meadow_2,
        25: barricade,
        23: tank_trap,
        5: boulder,
        94: spruce,
        112: tree_pair,
        16: war_flag,
        24: bunker,
        152: tank_roll,
        153: tank_fire,
    }
    return place_tiles(18, 11, mapping), mapping


# ---------------------------------------------------------------------------
# 4. Farmlands (farm/tilemap_packed.png — 12 cols x 11 rows)
# ---------------------------------------------------------------------------
def build_farm_sheet() -> tuple[Image.Image, dict[int, Image.Image]]:
    # Tilled Soil 4-tile strips: Stardew organic dirt beds blending cleanly into grass
    soil_a_left = paint16(
        [
            "................",
            "..@@@@@@@@@@@@@@",
            ".@TTTTTTXXXXXXXX",
            "@TTTxxxxXXXXXXXX",
            "@TXXXXTTXXXXXXXX",
            "@TxxXXXXXXXXXXXX",
            "@TTTTTTTXXXXXXXX",
            "@TTTxxxxXXXXXXXX",
            "@XXXXXXXTTXXXXXX",
            "@TxxXXXXXXXXXXXX",
            "@TTTTTTTXXXXXXXX",
            "@TTTxxxxXXXXXXXX",
            "@XXXXXXXXXXXXXXX",
            ".@xxxxXXXXXXXXXX",
            "..@@@@@@@@@@@@@@",
            "................",
        ]
    )
    soil_a_mid = paint16(
        [
            "................",
            "@@@@@@@@@@@@@@@@",
            "TTTTTTTTXXXXXXXX",
            "xxxxxxxxxxxxxxxx",
            "XXXXTTXXXXXXXXXX",
            "xxxxXXTXXXXXXXXX",
            "TTTTTTTTXXXXXXXX",
            "xxxxxxxxxxxxxxxx",
            "XXXXXXXXTTXXXXXX",
            "xxxxxxxxXXTXXXXX",
            "TTTTTTTTXXXXXXXX",
            "xxxxxxxxxxxxxxxx",
            "XXXXXXXXXXXXXXXX",
            "xxxxxxxxxxxxxxxx",
            "@@@@@@@@@@@@@@@@",
            "................",
        ]
    )
    soil_a_right = paint16(
        [
            "................",
            "@@@@@@@@@@@@@@..",
            "TTTTTTTTTTTTT@..",
            "xxxxxxxxxxxxXX@.",
            "XXXXTTXXXXXXXX@.",
            "XXXXXXXXXXXXxx@.",
            "TTTTTTTTTTTTTX@.",
            "xxxxxxxxxxxxXX@.",
            "XXXXXXXXTTXXXX@.",
            "XXXXXXXXXXXXxx@.",
            "TTTTTTTTTTTTTX@.",
            "xxxxxxxxxxxxXX@.",
            "XXXXXXXXXXXXXX@.",
            "xxxxxxxxxxxxx@..",
            "@@@@@@@@@@@@@@..",
            "................",
        ]
    )

    def sprout_soil(base: Image.Image, pts: list[tuple[int, int]]) -> Image.Image:
        out = base.copy()
        px = out.load()
        for sx, sy in pts:
            for dx, dy, c in [
                (0, 0, PAL["f"]),
                (-1, -1, PAL["e"]),
                (1, -1, PAL["E"]),
                (0, -2, PAL["g"]),
            ]:
                nx, ny = sx + dx, sy + dy
                if 0 <= nx < 16 and 0 <= ny < 16:
                    px[nx, ny] = c
        return out

    soil_b_left = sprout_soil(soil_a_left, [(7, 5), (12, 9)])
    soil_b_mid1 = sprout_soil(soil_a_mid, [(4, 5), (11, 9)])
    soil_b_mid2 = sprout_soil(soil_a_mid, [(5, 9), (12, 5)])
    soil_b_right = sprout_soil(soil_a_right, [(5, 5), (9, 9)])

    # 96 & 97: Authentic rectangular 3/4 bound golden wheat hay bales (zero round pumpkins!)
    hay_a = paint16(
        [
            "................",
            "..@@@@@@@@@@@@..",
            ".@yyyyyRyyyyyy@.",
            "@yyyyooRooooyyy@",
            "@YyyoooRoooooyy@",
            "@yyyyooRoooooyy@",
            "@ooOOOO@OOOOOoo@",
            "@ooooRoooRooooo@",
            "@ooOoRoooRoOooo@",
            "@oOOORoooROOOoo@",
            "@oOOORoooROOOoo@",
            ".@OOORoooROOOO@.",
            "..@@@@@@@@@@@@..",
            "................",
            "................",
            "................",
        ]
    )
    hay_b = paint16(
        [
            "...@@@@@@@@@@...",
            "..@yyyyRyyyyy@..",
            ".@yyoooRooooyy@.",
            ".@ooOOOROOOOoo@.",
            "..@@@@@@@@@@@@..",
            ".@yyyyyRyyyyyy@.",
            "@yyyoooRoooooyy@",
            "@ooooRoooRooooo@",
            "@oOOORoooROOOoo@",
            "@oOOORoooROOOoo@",
            "@OOOORoooROOOOO@",
            ".@OOOOOOOOOOOO@.",
            "..@@@@@@@@@@@@..",
            "................",
            "................",
            "................",
        ]
    )

    pine_top = paint16(
        [
            ".......%%.......",
            "......%ee%......",
            ".....%eegg%.....",
            "....%ggGGgg%....",
            "...%eeffffGG%...",
            "...%%ffffff%%...",
            "..%eeggffggGG%..",
            ".%eeffffffffGG%.",
            ".%%ffffffffff%%.",
            "..%eeggffggGG%..",
            "%eeffffffffffGG%",
            "%GffffffffffffF%",
            ".%%%ffffffff%%%.",
            ".....@bBBB@.....",
            ".....@bBBB@.....",
            ".....@xBBx@.....",
        ]
    )
    pine_bot = paint16(
        [
            ".....@bBBB@.....",
            ".....@bBBB@.....",
            ".....@xBBx@.....",
            ".....@xBBx@.....",
            "....@bxBBxb@....",
            "...%gB@@@@Bg%...",
            "....%%%%%%%%....",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    berry_bush = paint16(
        [
            "................",
            "................",
            "....%%%%%%%%....",
            "..%%eeeggggg%%..",
            ".%eegpggggpggg%.",
            ".%egGgggggGGgg%.",
            "%egpGGgGggGgpGG%",
            "%gGGGGGgGGGGGgG%",
            "%GGffGGGGGGffGG%",
            ".%GffffffffffG%.",
            "..%%ffffffff%%..",
            "....%%%%%%%%....",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    cider_barrel = paint16(
        [
            "................",
            "....@@@@@@@@....",
            "..@@tbbbbbbb@@..",
            ".@tbBBBBBBBBBx@.",
            ".@ssssssssssss@.",
            ".@tbbb@rR@bbbx@.",
            ".@tbbbBBBBbbbx@.",
            ".@tbbbbBBBBbbx@.",
            ".@ssssssssssss@.",
            ".@bBBBBxxxxBBx@.",
            "..@BBBBxxBBBx@..",
            "...@@@@@@@@@@...",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    sunflower = paint16(
        [
            "....@@@@@@@@....",
            "..@@yyyyyyyy@@..",
            ".@yyyo@BB@oyyy@.",
            ".@yyo@BBBB@oyy@.",
            ".@yyo@BxxB@oyy@.",
            "..@@yo@BB@oy@@..",
            "...%yyyyyyyy%...",
            "....%%%%%%%%....",
            "......%gg%......",
            "....%%eGg%......",
            "...%eeg%gG%.....",
            "....%%%gGe%.....",
            "......%gg%%.....",
            "......%GG%......",
            "......%%%%......",
            "................",
        ]
    )
    carrot = paint16(
        [
            ".....%%..%%.....",
            "....%ee%%ee%....",
            ".....%egge%.....",
            "......%gg%......",
            ".....@@@@@@.....",
            "....@uuuuuu@....",
            "....@uuRuuu@....",
            ".....@uuuu@.....",
            ".....@uRuu@.....",
            "......@uu@......",
            "......@uu@......",
            ".......@@.......",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    corn = paint16(
        [
            "......@@@@......",
            ".....@YYYY@.....",
            "....@YyYyYy@....",
            "....@yYyYyY@....",
            "....@YyYyYy@....",
            "...%%yYyYyY%%...",
            "..%ee@YYYY@eg%..",
            "..%egG@@@@GgG%..",
            "...%egGggGGg%...",
            "....%GGffGG%....",
            ".....%fGGf%.....",
            "......%GG%......",
            "......%%%%......",
            "................",
            "................",
            "................",
        ]
    )
    tomato = paint16(
        [
            ".......%%.......",
            "......%gg%......",
            ".....@@@@@@.....",
            "...@@rrRRRR@@...",
            "..@rrWrrrrRRR@..",
            "..@rrrrrrRRRR@..",
            "..@rrrrrrrrRR@..",
            "...@rrrrRRRR@...",
            "....@RRRRRR@....",
            ".....@@@@@@.....",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    cabbage = paint16(
        [
            "................",
            "....%%%%%%%%....",
            "..%%eeEEEEee%%..",
            ".%eEeggggggEeG%.",
            ".%egEeeeeeEegG%.",
            "%eggegggggggegG%",
            "%gGggGGGGGGggGG%",
            "%GGffGGGGGGffGG%",
            ".%ffffffffffff%.",
            "..%%ffffffff%%..",
            "....%%%%%%%%....",
            "................",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    chicken = paint16(
        [
            "................",
            ".....@@@@.......",
            "....@rrrr@......",
            "...&WWWWWW&.....",
            "..@uWW#WWWs&....",
            "..@@WWWWWWws&...",
            "....&WWwwWWws&..",
            "...&WWwsssWWww&.",
            "...&WWsssssWWW&.",
            "....&ssWWWWss&..",
            ".....&&&&&&&&...",
            "......@u@.@u@...",
            ".....@uu@.@uu@..",
            "................",
            "................",
            "................",
        ]
    )
    sheep = paint16(
        [
            "................",
            "....&&&&&&&&....",
            "..&&WWWWWWWW&&..",
            ".&WWwwWWWWwwWW&.",
            "&WW#dddddd#WWwW&",
            "&WW#dd#d#d#WWwW&",
            "&WW#dddddd#WWww&",
            ".&wW######WWww&.",
            ".&WWWWWWWWwwWW&.",
            "..&wwWWWWwwww&..",
            "...&&&&&&&&&&...",
            "....#dd##dd#....",
            "....###..###....",
            "................",
            "................",
            "................",
        ]
    )
    # 121 & 123: Stampede Bull (clear horn-lowered charging bull w/ glowing pink eyes & dust, # ink)
    bull_0 = paint16(
        [
            ".##..........##.",
            "#YY#........#YY#",
            ".#Yw########wY#.",
            "..##bbbbbbbb##..",
            "...#b#p##p#b#...",
            "..##bbbbbbbb##..",
            ".#bB#bBBBBb#Bb#.",
            "#bBB#b#yy#b#BBx#",
            "#bBBb######bBBx#",
            ".#bbBBBBBBBBxx#.",
            ".#xBBBBBBBBxxx#.",
            "..#xx######xx#..",
            "..#x#......#B#..",
            ".#d#........#d#.",
            ".##..........##.",
            "................",
        ]
    )
    bull_1 = paint16(
        [
            "................",
            ".##..........##.",
            "#YY#........#YY#",
            ".#Yw########wY#.",
            "..##bbbbbbbb##..",
            "...#b#p##p#b#...",
            "..##bbbbbbbb##..",
            ".#bB#bBBBBb#Bb#.",
            "#bBB#b#yy#b#BBx#",
            "#bBBb######bBBx#",
            ".#bbBBBBBBBBxx#.",
            ".#xBBBBBBBBxxx#.",
            "..#B#......#x#..",
            "..#d#......#d#..",
            "..##........##..",
            "................",
        ]
    )

    mapping: dict[int, Image.Image] = {
        48: soil_a_left,
        49: soil_a_mid,
        50: soil_a_mid,
        51: soil_a_right,
        60: soil_b_left,
        61: soil_b_mid1,
        62: soil_b_mid2,
        63: soil_b_right,
        96: hay_a,
        97: hay_b,
        3: pine_top,
        15: pine_bot,
        39: berry_bush,
        85: cider_barrel,
        83: sunflower,
        8: carrot,
        32: corn,
        44: tomato,
        56: cabbage,
        122: chicken,
        120: sheep,
        121: bull_0,
        123: bull_1,
    }
    return place_tiles(12, 11, mapping), mapping


# ---------------------------------------------------------------------------
# Visual QA Previews (3x Sprite Grid + Post-Shader Mock Rooms matching DungeonAtmosphereFilter)
# ---------------------------------------------------------------------------
def tint_tile(im: Image.Image, hex_color: int) -> Image.Image:
    if hex_color == 0xFFFFFF:
        return im
    tr = ((hex_color >> 16) & 0xFF) / 255.0
    tg = ((hex_color >> 8) & 0xFF) / 255.0
    tb = (hex_color & 0xFF) / 255.0
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            px[x, y] = (int(r * tr), int(g * tg), int(b * tb), a)
    return out


def simulate_shader_room(
    im: Image.Image, ambient: tuple[float, float, float], torch_tint: tuple[float, float, float]
) -> Image.Image:
    """Apply approximate DungeonAtmosphereFilter grade ([1.35, 1.08, 1.06, 0.35]) + central hero light."""
    w, h = im.size
    out = im.copy().convert("RGB")
    px = out.load()
    ar, ag, ab = ambient
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            br, bg, bb = r / 255.0, g / 255.0, b / 255.0
            dx = (x / w - 0.5) * 1.5
            dy = y / h - 0.62
            dist = math.hypot(dx, dy)
            fall = max(0.0, 1.0 - dist / 0.42)
            light = fall * fall * 0.65
            lr = br * min(1.32, ar + torch_tint[0] * light) + light * torch_tint[0] * (0.045 + br * 0.08)
            lg = bg * min(1.32, ag + torch_tint[1] * light) + light * torch_tint[1] * (0.045 + bg * 0.08)
            lb = bb * min(1.32, ab + torch_tint[2] * light) + light * torch_tint[2] * (0.045 + bb * 0.08)
            luma = 0.299 * lr + 0.587 * lg + 0.114 * lb
            chroma = max(lr, lg, lb) - min(lr, lg, lb)
            sat = 1.35 + 0.35 * (1.0 - min(1.0, max(0.0, chroma * 2.0)))
            lr = ((luma + (lr - luma) * sat) - 0.5) * 1.08 + 0.5
            lg = ((luma + (lg - luma) * sat) - 0.5) * 1.08 + 0.5
            lb = ((luma + (lb - luma) * sat) - 0.5) * 1.08 + 0.5
            lr = max(0.0, min(1.0, lr * 1.06))
            lg = max(0.0, min(1.0, lg * 1.06))
            lb = max(0.0, min(1.0, lb * 1.06))
            px[x, y] = (int(lr * 255), int(lg * 255), int(lb * 255))
    return out


def make_room_mockup(
    farm_map: dict[int, Image.Image],
    town_map: dict[int, Image.Image],
    battle_map: dict[int, Image.Image],
    ski_map: dict[int, Image.Image],
) -> Image.Image:
    # Render 4 side-by-side 2x2 post-shader mock rooms (6x4 tiles @ 3x = 288x192 each)
    room_w, room_h = 288, 192
    canvas = Image.new("RGB", (room_w * 2 + 48, room_h * 2 + 96), (14, 9, 20))
    draw = ImageDraw.Draw(canvas)

    def build_room(
        bg_tiles: list[Image.Image],
        patches: list[tuple[int, int, Image.Image]],
        blocks: list[tuple[int, int, Image.Image]],
        actors: list[tuple[int, int, Image.Image]],
        ambient: tuple[float, float, float],
        tint: tuple[float, float, float],
    ) -> Image.Image:
        room = Image.new("RGBA", (96, 64), (0, 0, 0, 255))
        idx = 0
        for r in range(4):
            for c in range(6):
                room.alpha_composite(bg_tiles[idx % len(bg_tiles)], (c * 16, r * 16))
                idx += 1
        for c, r, im in patches:
            room.alpha_composite(im, (c * 16, r * 16))
        for c, r, im in blocks:
            room.alpha_composite(im, (c * 16, r * 16))
        for x, y, im in actors:
            room.alpha_composite(im, (x, y))
        graded = simulate_shader_room(room, ambient, tint)
        return graded.resize((room_w, room_h), Image.Resampling.NEAREST)

    specs = [
        (
            "Farmlands (under shader)",
            build_room(
                [battle_map[0], battle_map[1], battle_map[2]],
                [(1, 1, farm_map[48]), (2, 1, farm_map[49]), (3, 1, farm_map[50]), (4, 1, farm_map[51]),
                 (1, 2, farm_map[60]), (2, 2, farm_map[61]), (3, 2, farm_map[62]), (4, 2, farm_map[63])],
                [(0, 1, farm_map[96]), (5, 1, farm_map[97]), (0, 2, farm_map[3]), (0, 3, farm_map[15]), (5, 3, farm_map[83])],
                [(40, 28, farm_map[121]), (72, 42, farm_map[120])],
                (0.95, 0.90, 0.98), (0.98, 0.58, 0.24),
            ),
        ),
        (
            "Old Town (under shader)",
            build_room(
                [town_map[109]],
                [(1, 1, town_map[0]), (2, 1, town_map[1]), (1, 2, town_map[2])],
                [(4, 1, town_map[130]), (4, 2, town_map[107]), (1, 2, town_map[106]), (5, 0, town_map[4]), (5, 1, town_map[16]), (0, 2, town_map[3]), (0, 3, town_map[15])],
                [(48, 30, town_map[105]), (26, 20, town_map[83])],
                (0.95, 0.90, 0.98), (0.98, 0.58, 0.24),
            ),
        ),
        (
            "Battlefield (under shader)",
            build_room(
                [tint_tile(battle_map[0], 0xD9E68A), tint_tile(battle_map[1], 0xD9E68A)],
                [(1, 1, town_map[25]), (2, 1, town_map[25]), (2, 2, town_map[25])],
                [(1, 1, battle_map[25]), (4, 1, battle_map[25]), (1, 3, battle_map[23]), (4, 2, battle_map[5]), (5, 0, battle_map[94])],
                [(20, 18, battle_map[152]), (66, 28, battle_map[153])],
                (0.95, 0.90, 0.98), (0.98, 0.58, 0.24),
            ),
        ),
        (
            "Frozen Slopes (under shader)",
            build_room(
                [ski_map[0], ski_map[16], ski_map[13]],
                [(2, 1, ski_map[49]), (3, 1, ski_map[52]), (2, 2, ski_map[52])],
                [(1, 1, ski_map[81]), (4, 1, ski_map[81]), (0, 0, ski_map[6]), (0, 1, ski_map[18]), (4, 2, ski_map[8]), (4, 3, ski_map[20]), (5, 0, ski_map[69])],
                [(36, 24, ski_map[78]), (68, 32, ski_map[80])],
                (0.95, 0.90, 0.98), (0.98, 0.58, 0.24),
            ),
        ),
    ]

    for i, (title, rim) in enumerate(specs):
        col = i % 2
        row = i // 2
        x = 16 + col * (room_w + 16)
        y = 16 + row * (room_h + 36)
        draw.text((x, y), title, fill=(245, 194, 52))
        canvas.paste(rim, (x, y + 20))
    return canvas


def make_preview(groups: list[tuple[str, list[tuple[str, Image.Image]]]]) -> Image.Image:
    cell_w = 88
    cell_h = 84
    pad = 16
    max_cols = max(len(items) for _, items in groups)
    w = max_cols * cell_w + pad * 2
    h = sum(34 + cell_h + 12 for _ in groups) + pad * 2
    canvas = Image.new("RGBA", (w, h), (15, 10, 22, 255))
    draw = ImageDraw.Draw(canvas)
    y = pad
    for title, items in groups:
        draw.text((pad, y), title, fill=(245, 194, 52, 255))
        y += 22
        for i, (lbl, im16) in enumerate(items):
            x = pad + i * cell_w
            draw.rectangle([x, y, x + 78, y + 66], fill=(38, 27, 56, 255), outline=(64, 46, 92, 255))
            scaled = im16.resize((48, 48), Image.Resampling.NEAREST)
            canvas.alpha_composite(scaled, (x + 15, y + 6))
            draw.text((x + 6, y + 69), lbl, fill=(224, 212, 240, 255))
        y += cell_h + 24
    return canvas


def main() -> None:
    ski_sheet, ski_map = build_ski_sheet()
    town_sheet, town_map = build_town_sheet()
    battle_sheet, battle_map = build_battle_sheet()
    farm_sheet, farm_map = build_farm_sheet()

    outputs = [
        (ASSETS / "ski" / "tilemap_packed.png", ski_sheet),
        (ASSETS / "town" / "tilemap_packed.png", town_sheet),
        (ASSETS / "battle" / "tilemap_packed.png", battle_sheet),
        (ASSETS / "farm" / "tilemap_packed.png", farm_sheet),
    ]
    for path, im in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path)
        print(f"Wrote {path} {im.size}")

    preview = make_preview(
        [
            (
                "Frozen Slopes (ski)",
                [
                    ("0 snow", ski_map[0]), ("13 trk", ski_map[13]), ("16 drft", ski_map[16]),
                    ("49 pthA", ski_map[49]), ("52 pthB", ski_map[52]), ("81 crag", ski_map[81]),
                    ("6 pineT", ski_map[6]), ("18 pineB", ski_map[18]), ("30 smPin", ski_map[30]),
                    ("7 bareT", ski_map[7]), ("19 bareB", ski_map[19]), ("69 snowm", ski_map[69]),
                    ("47 stmp", ski_map[47]), ("8 rFlgT", ski_map[8]), ("9 bFlgT", ski_map[9]),
                    ("78 yeti0", ski_map[78]), ("79 yeti1", ski_map[79]), ("80 yetiC", ski_map[80]),
                ],
            ),
            (
                "Old Town (town)",
                [
                    ("109 cob", town_map[109]), ("0 grs", town_map[0]), ("1 clvr", town_map[1]),
                    ("2 flwr", town_map[2]), ("25 mud", town_map[25]), ("130 brl", town_map[130]),
                    ("107 pot", town_map[107]), ("131 wBrl", town_map[131]), ("105 bomb", town_map[105]),
                    ("4 gTreT", town_map[4]), ("16 gTreB", town_map[16]), ("3 aTreT", town_map[3]),
                    ("15 aTreB", town_map[15]), ("5 bush", town_map[5]), ("83 sign", town_map[83]),
                    ("94 hive", town_map[94]), ("106 log", town_map[106]),
                ],
            ),
            (
                "Battlefield (battle)",
                [
                    ("0 grsA", battle_map[0]), ("1 grsB", battle_map[1]), ("2 grsC", battle_map[2]),
                    ("25 bric", battle_map[25]), ("23 trap", battle_map[23]), ("5 bldr", battle_map[5]),
                    ("94 sprc", battle_map[94]), ("112 tPr", battle_map[112]), ("16 flag", battle_map[16]),
                    ("24 bnkr", battle_map[24]), ("152 tnk0", battle_map[152]), ("153 tnk1", battle_map[153]),
                ],
            ),
            (
                "Farmlands (farm)",
                [
                    ("48 sA0", farm_map[48]), ("49 sA1", farm_map[49]), ("51 sA3", farm_map[51]),
                    ("61 sB1", farm_map[61]), ("96 hayA", farm_map[96]), ("97 hayB", farm_map[97]),
                    ("3 pineT", farm_map[3]), ("15 pineB", farm_map[15]), ("39 bush", farm_map[39]),
                    ("85 cid", farm_map[85]), ("83 sunf", farm_map[83]), ("8 carr", farm_map[8]),
                    ("32 corn", farm_map[32]), ("44 tom", farm_map[44]), ("56 cab", farm_map[56]),
                    ("122 chk", farm_map[122]), ("120 shp", farm_map[120]),
                    ("121 bul0", farm_map[121]), ("123 bul1", farm_map[123]),
                ],
            ),
        ]
    )
    rooms_preview = make_room_mockup(farm_map, town_map, battle_map, ski_map)
    try:
        SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
        preview.save(SCRATCH_PREVIEW)
        rooms_preview.save(SCRATCH_ROOMS)
        print(f"Wrote previews -> {SCRATCH_PREVIEW} & {SCRATCH_ROOMS}")
    except OSError as err:
        print(f"Skipped preview: {err}")


if __name__ == "__main__":
    main()
