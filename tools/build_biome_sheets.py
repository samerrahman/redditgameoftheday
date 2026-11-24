#!/usr/bin/env python3
"""
Builds 100% original, unified 1:1 Obsidian-outlined sprite sheets for all four
outdoor Dungeonle biomes (replacing all Kenney Tiny Ski/Town/Battle/Farm assets):

  - public/assets/ski/tilemap_packed.png    (192x176, 12 cols x 11 rows)
  - public/assets/town/tilemap_packed.png   (192x176, 12 cols x 11 rows)
  - public/assets/battle/tilemap_packed.png (288x176, 18 cols x 11 rows)
  - public/assets/farm/tilemap_packed.png   (192x176, 12 cols x 11 rows)

Also writes a 4x visual inspection sheet to scratch/ (if writable).
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
SCRATCH_PREVIEW = Path(
    "/Users/Samer/.gemini/antigravity/brain/681e0dd1-392e-45a9-b08c-5ca9e857fe94/scratch/biome_sheets_preview.png"
)

# Unified Obsidian Torchlight palette (#1c1221 ink outlines across every sprite)
PAL: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "#": (28, 18, 33, 255),      # unified #1c1221 outline
    "_": (44, 32, 56, 255),      # soft plum mortar/crease
    # Snow & glacial ice
    "Q": (244, 249, 255, 255),   # crisp snow highlight
    "q": (223, 237, 252, 255),   # mid snow
    "z": (184, 212, 240, 255),   # snow shadow
    "Z": (140, 178, 218, 255),   # deep ice groove
    "a": (56, 189, 248, 255),    # glowing frost cyan
    "A": (14, 165, 233, 255),    # deep frost blue
    "k": (186, 230, 253, 255),   # bright ice glow
    # Obsidian / slate stone & metal
    "W": (248, 250, 252, 255),
    "w": (206, 216, 232, 255),
    "s": (148, 163, 184, 255),   # mid steel/stone
    "S": (100, 116, 139, 255),   # dark steel/stone
    "d": (68, 76, 98, 255),      # shadow slate
    "D": (46, 48, 66, 255),      # deepest slate
    # Warm cobblestone masonry (Old Town)
    "n": (132, 118, 140, 255),   # warm cobble hi
    "N": (106, 94, 116, 255),    # warm cobble mid
    "m": (82, 72, 94, 255),      # warm cobble shadow
    # Earth, wood, bark & leather
    "t": (212, 154, 96, 255),    # light timber / tan straw
    "b": (166, 102, 56, 255),    # oak mid
    "B": (118, 64, 36, 255),     # dark bark / chest / bull shade
    "x": (86, 46, 28, 255),      # deep wood/soil
    "X": (112, 74, 46, 255),     # tilled soil mid
    "T": (142, 98, 62, 255),     # tilled soil ridge
    # Grass & foliage greens
    "E": (163, 230, 110, 255),   # bright lime highlight
    "e": (108, 198, 92, 255),    # leaf/grass light
    "g": (78, 162, 74, 255),     # lush grass mid
    "G": (56, 128, 60, 255),     # grass shade
    "f": (40, 96, 54, 255),      # deep pine green
    "F": (26, 68, 44, 255),      # darkest evergreen
    "l": (132, 204, 22, 255),    # olive/tactical lime stripe
    # Autumn & straw gold
    "Y": (254, 240, 138, 255),   # pale cream/sun
    "y": (250, 204, 21, 255),    # forged gold / corn / hay
    "o": (217, 136, 24, 255),    # warm amber / hay mid
    "O": (168, 86, 18, 255),     # burnt ochre
    # Ember reds, crimson, coral & pink
    "r": (239, 68, 68, 255),     # bright crimson
    "R": (176, 32, 38, 255),     # dark crimson
    "u": (251, 146, 60, 255),    # flame / carrot orange
    "p": (244, 114, 182, 255),   # vivid magenta/pink glow
    # Cobalt & terracotta
    "c": (59, 130, 246, 255),    # cobalt pennant
    "C": (30, 64, 175, 255),     # deep cobalt
    "v": (214, 108, 72, 255),    # terracotta pot highlight
    "V": (168, 74, 48, 255),     # terracotta shadow
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


def fill_solid(color_key: str) -> list[str]:
    return [color_key * 16 for _ in range(16)]


def set_pixels(rows: list[str], edits: list[tuple[int, int, str]]) -> list[str]:
    grid = [list(r) for r in rows]
    for x, y, ch in edits:
        grid[y][x] = ch
    return ["".join(r) for r in grid]


def place_tiles(
    cols: int, rows: int, mapping: dict[int, Image.Image], filler: Image.Image | None = None
) -> Image.Image:
    sheet = Image.new("RGBA", (cols * 16, rows * 16), (0, 0, 0, 0))
    total = cols * rows
    for idx in range(total):
        im = mapping.get(idx, filler)
        if im is not None:
            sheet.alpha_composite(im, ((idx % cols) * 16, (idx // cols) * 16))
    return sheet


# ---------------------------------------------------------------------------
# 1. Frozen Slopes (ski/tilemap_packed.png — 12 cols x 11 rows)
# ---------------------------------------------------------------------------
def build_ski_sheet() -> tuple[Image.Image, dict[int, Image.Image]]:
    snow_base = paint16(
        set_pixels(
            fill_solid("q"),
            [
                (2, 2, "Q"), (3, 2, "Q"), (10, 4, "Q"), (11, 4, "Q"),
                (5, 8, "z"), (6, 8, "z"), (13, 11, "Q"), (3, 13, "z"),
                (9, 13, "z"), (1, 6, "Q"), (7, 1, "z"),
            ],
        )
    )
    snow_tracks = paint16(
        set_pixels(
            fill_solid("q"),
            [
                (3, 1, "z"), (4, 2, "z"), (4, 3, "z"), (5, 4, "z"), (5, 5, "z"),
                (6, 6, "z"), (6, 7, "z"), (7, 8, "z"), (7, 9, "z"), (8, 10, "z"),
                (8, 1, "z"), (9, 2, "z"), (9, 3, "z"), (10, 4, "z"), (10, 5, "z"),
                (11, 6, "z"), (11, 7, "z"), (12, 8, "z"), (12, 9, "z"), (13, 10, "z"),
                (2, 2, "Q"), (11, 13, "Q"),
            ],
        )
    )
    snow_drift = paint16(
        [
            "qqqqqqqqqqqqqqqq",
            "qQQqQqqqqqqqqqqq",
            "qQqqqqqQQqqqqqqq",
            "qqqqqqQQQQqqqqqq",
            "qqqqqQqqqzqqqqqq",
            "qqqqqqqqzzqqqqqq",
            "qqqqqqqqqqqqqqqq",
            "qqqqqqqqqqqQQqqq",
            "qqqqqqqqqqQqzqqq",
            "qqqqqqqqqqqzzqqq",
            "qqqQQQqqqqqqqqqq",
            "qqQqqzzqqqqqqqqq",
            "qqqqqqqqqqqqqqqq",
            "qqqqqqqqqQQqqqqq",
            "qqqqqqqqqqqqqqqq",
            "qqqqqqqqqqqqqqqq",
        ]
    )
    icy_path_a = paint16(
        [
            "zzqqqqqzzzzqqqqz",
            "zqQQqqqzZZzqQQqz",
            "zqqqqqqzzzqqqqqz",
            "zzzzzzzzzzzzzzzz",
            "qzzqqqqqzzqqqqqz",
            "qzQQqzzqqzQqqzzz",
            "qqqqzzqqqqqqqzzz",
            "zzzzzzZzzzzzZZzz",
            "zzqqqqzqqqqqqzzz",
            "zqQQqqzzQQqqqqqz",
            "zqqqzzzzqqqzzqqz",
            "zzzzZzzzzzzZzzzz",
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
            "zzzzqqqqzzzzzzqz",
            "qzqqqqqqqqzzqzzz",
            "qQQqzzqqqqzZZzqz",
            "qqqzzqqqQQqqzzqz",
            "zzzzzZzzzzzzzzzz",
            "zzqqqqzzqqqqqzqz",
            "zqQqqqzzQqqqqzzz",
            "zqqzzzzzqqqqzZZz",
            "zzzzZzzzzzzzzzzz",
            "qzzqqqqqzzqqqqqz",
            "qzzQQqqqzzQqqzzz",
            "qqqqqzzzzzqqqzzz",
            "zzzzzzzzzzzzzzzz",
            "zzqqqqzzzzqqqzzz",
        ]
    )
    # 81: Glacier Slate Boulder (block)
    snow_rock = paint16(
        [
            ".....######.....",
            "...##QQQQQQ##...",
            "..#QQQQqqQQqq#..",
            ".#QQqqqqzzqqqq#.",
            ".#qzzsZZZZszqq#.",
            "#sssdSSSSSSsdss#",
            "#ssSSSSSSSSSSsd#",
            "#sSSddddSSSSddS#",
            "#dSSdDDddSSSddD#",
            "#ddDDDDdddddDDD#",
            "#ddddDDDDDDDDdd#",
            ".#DDDDddddDDDD#.",
            ".##DDDDDDDDDD##.",
            "..############..",
            "...##########...",
            "................",
        ]
    )
    # 6 + 18: Tall Snow-Laden Pine
    tall_pine_top = paint16(
        [
            ".......##.......",
            "......#QQ#......",
            ".....#QQqq#.....",
            ".....#qzzq#.....",
            "....#fGGGGf#....",
            "....#fFFFFf#....",
            "...#QQqFFqQQ#...",
            "...#qzzGGzzq#...",
            "..#fGGFFFFGGf#..",
            "..#fFFFFFFFFf#..",
            ".#QQqGFFFFGqQQ#.",
            ".#qzzGFFFFGzzq#.",
            "#fGGGFFFFFFGGGf#",
            "#fFFFFFFFFFFFFf#",
            ".#QQzFFFFFFzQQ#.",
            "..#zzFFFFFFzz#..",
        ]
    )
    tall_pine_bot = paint16(
        [
            "..#ffFFFFFFff#..",
            ".#QQqGFFFFGqQQ#.",
            ".#qzzGFFFFGzzq#.",
            "#fGGGFFFFFFGGGf#",
            "#ffFFFFFFFFFFff#",
            ".#QQqFFFFFFqQQ#.",
            "..#zz######zz#..",
            "......#Bb#......",
            "......#Bb#......",
            "......#BB#......",
            ".....#xBBb#.....",
            "....#qz##zq#....",
            "...#QQqzzqQQ#...",
            "....########....",
            "................",
            "................",
        ]
    )
    # 30: Small Snow Pine
    small_pine = paint16(
        [
            "................",
            ".......##.......",
            "......#QQ#......",
            ".....#QQqq#.....",
            "....#fGGGGf#....",
            "...#QQzFFzQQ#...",
            "...#zzGFFGzz#...",
            "..#fGGFFFFGGf#..",
            ".#QQqFFFFFFqQQ#.",
            ".#zzGFFFFFFGzz#.",
            "..#ff######ff#..",
            "......#Bb#......",
            ".....#xBBb#.....",
            "....#qz##zq#....",
            ".....######.....",
            "................",
        ]
    )
    # 7 + 19: Frosted Bare Winter Tree
    bare_top = paint16(
        [
            "...##......##...",
            "..#QQ#....#QQ#..",
            "..#qB#....#Bq#..",
            "...#Bb#..#bB#...",
            ".##.#Bb##bB#.##.",
            "#QQ##BBbbBB##QQ#",
            ".##qz#BBBB#zq##.",
            "....##BBbB##....",
            ".....#BBBB#.....",
            ".....#xBBb#.....",
            ".....#xBBb#.....",
            ".....#xBBb#.....",
            ".....#xBBb#.....",
            ".....#xBBb#.....",
            ".....#xBBb#.....",
            ".....#xBBb#.....",
        ]
    )
    bare_bot = paint16(
        [
            ".....#xBBb#.....",
            ".....#xBBb#.....",
            ".....#xBBb#.....",
            "....#qxBBbq#....",
            "...#QQxBBbQQ#...",
            "....#zxBBbz#....",
            "....##xBBx##....",
            "...#xxBBBBxx#...",
            "..#QQz####zQQ#..",
            "...##########...",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    # 69: Winter Snowman
    snowman_im = paint16(
        [
            ".....######.....",
            "....#dDDDDd#....",
            "....#DDDDDD#....",
            "...##########...",
            "....#QQQQqq#....",
            "....#Q#QQ#q#....",
            "....#QQuuqq#....",
            ".....#rrrr#.....",
            "....#RRrrRR#....",
            "...#QQQqqqz#....",
            "..##BQQ#QzzB##..",
            ".#B.#QQqqzz#.B#.",
            "....#qqzzzz#....",
            ".....#zzzz#.....",
            "......####......",
            "................",
        ]
    )
    # 47: Snowy Stump
    stump = paint16(
        [
            "................",
            "................",
            "....########....",
            "...#QQQqqqzz#...",
            "..#QQzttttzzq#..",
            "..#qz######zq#..",
            "...#bBBBBBBx#...",
            "...#bBBxBBxx#...",
            "..#bbBBxxBBxx#..",
            ".#xbBBBxxBBBxx#.",
            ".#qzz######zzq#.",
            "..############..",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    # 8/20 Red Slalom Flag & 9/21 Blue Slalom Flag
    def flag_pair(hi: str, lo: str) -> tuple[Image.Image, Image.Image]:
        top = paint16(
            [
                "....##..........",
                "...#bb#.........",
                "...#bb#####.....",
                "...#bb#" + hi * 4 + "##...",
                "...#bb#" + hi * 5 + lo + "#..",
                "...#bb#" + hi * 3 + lo * 4 + "##",
                "...#bb#" + lo * 6 + "#..",
                "...#bb#" + lo * 5 + "##..",
                "...#bb#######...",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
            ]
        )
        bot = paint16(
            [
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#bb#.........",
                "...#qz#.........",
                "..#QQzz#........",
                "...####.........",
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

    # 78, 79, 80: Frost Yeti Enemy (original glacier beast w/ glowing cyan eyes & ice magic)
    yeti_walk_0 = paint16(
        [
            "...##########...",
            "..#QQ##QQQQ##Q#.",
            ".#QQ#QQQQQQqq#z#",
            "..##QQzzzzzzqq#.",
            "..#QQz#ddddd#z#.",
            "..#QQd#a#d#a#d#.",
            "..#Qzd#ddddd#d#.",
            ".#QQzz#######z#.",
            "#QQqqqqzzzzqqzz#",
            "#Qz#QQqqqqzz#zz#",
            "#q.#QQzzzzzz#.z#",
            ".#.#zzzzZZZZ#.#.",
            "...#zzZ##Zzz#...",
            "...#zz#..#ZZ#...",
            "..####....####..",
            "................",
        ]
    )
    yeti_walk_1 = paint16(
        [
            "................",
            "...##########...",
            "..#QQ##QQQQ##Q#.",
            ".#QQ#QQQQQQqq#z#",
            "..##QQzzzzzzqq#.",
            "..#QQz#ddddd#z#.",
            "..#QQd#a#d#a#d#.",
            "..#Qzd#ddddd#d#.",
            ".#QQzz#######z#.",
            "#Qzqqqqzzzzqqzz#",
            ".#.#QQqqqqzz#z#.",
            "...#zzzzzzZZ#.#.",
            "...#zZ#..#ZZ#...",
            "..####....#zz#..",
            "..........####..",
            "................",
        ]
    )
    yeti_cast = paint16(
        [
            ".##...####...##.",
            "#ka#.#QQQQ#.#ak#",
            "#aQ#.#Q##Q#.#Qa#",
            "#QQ##QzZZzQ##QQ#",
            ".#QQz#dddd#zQQ#.",
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
        81: snow_rock,
        6: tall_pine_top,
        18: tall_pine_bot,
        30: small_pine,
        7: bare_top,
        19: bare_bot,
        69: snowman_im,
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
    grass_plain = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (2, 2, "e"), (3, 3, "G"), (9, 2, "e"), (13, 5, "G"),
                (5, 8, "e"), (6, 8, "e"), (11, 10, "G"), (3, 13, "e"),
                (14, 13, "e"), (1, 11, "G"), (8, 6, "G"),
            ],
        )
    )
    grass_clover = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (3, 3, "e"), (4, 3, "E"), (4, 4, "e"), (10, 5, "G"),
                (11, 5, "e"), (11, 4, "e"), (12, 5, "e"), (6, 11, "E"),
                (7, 11, "e"), (6, 12, "e"), (13, 12, "G"), (2, 10, "G"),
            ],
        )
    )
    grass_flowers = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (3, 3, "Y"), (4, 3, "W"), (3, 4, "y"), (2, 3, "e"),
                (11, 5, "r"), (12, 5, "Y"), (11, 6, "e"), (6, 11, "W"),
                (7, 11, "Y"), (6, 12, "G"), (13, 12, "e"), (1, 13, "G"),
            ],
        )
    )
    mud_patch = paint16(
        [
            "xxxxxxxxxxxxxxxx",
            "xXXxXXXxXXxXXXxx",
            "xTTXXxxXTTXXxxXx",
            "xxxxXXxxxxxXXxxx",
            "xxXXTXXxXXxXXTxx",
            "xxXXXXXxxXXXXXXX",
            "xXXxxXXXXXxxXXXX",
            "xxxxXXTXXxxxXXTx",
            "xXXXxXXXXxXXXXX.",
            "xTTXXXxxXXTTXXxx",
            "xxxxXXxxxxxXXxxx",
            "xxXXTXXxXXXXTXXX",
            "xxXXXXXxxXXXXXXX",
            "xXXxxXXXXxXXXxxX",
            "xxxxXXTXXxxxXXTx",
            "xxxxxxxxxxxxxxxx",
        ],
        extra={".": (86, 46, 28, 255)},
    )
    cobble = paint16(
        [
            "_nnnn_NNNN_nmmn_",
            "_nNNm_nmmN_NmmN_",
            "_mNNm_mNNm_mmmm_",
            "________________",
            "_NN_mmmm_nNNNNn_",
            "_Nm_nNNN_nNmmmN_",
            "_mm_mNNm_mmmmmm_",
            "________________",
            "_nnnnmm_mmmm_nn_",
            "_nNNNmm_nNNm_Nm_",
            "_mmmmmm_mmmm_mm_",
            "________________",
            "_mmm_nnnnnn_mmN_",
            "_Nmm_nNNNNm_NNN_",
            "_mmm_mmmmmm_mmm_",
            "________________",
        ]
    )
    barrel_block = paint16(
        [
            "....########....",
            "..##tbbbbbbB##..",
            ".#tbBBBBBBBBbx#.",
            ".#ssssssssssss#.",
            "#dSSSSSSSSSSSSd#",
            "#tbbbbBBBBbbbbx#",
            "#tbbtBBBBBBbxBx#",
            "#tbbbbBBBBbbbbx#",
            "#tbbbbBBBBbbbbx#",
            "#ssssssssssssss#",
            "#dSSSSSSSSSSSSd#",
            "#bBBBBxxxxBBBBx#",
            ".#bBBBBxxBBBBx#.",
            ".##BBBBxxBBBB##.",
            "...##########...",
            "................",
        ]
    )
    pot_block = paint16(
        [
            "................",
            "....########....",
            "...#vvvvvVVV#...",
            "....#VV####V#...",
            "...##vvVVVV##...",
            "..#vv##vv##VV#..",
            ".#vvvVVVVVVVVV#.",
            ".#vvvVVVVVVVVV#.",
            ".#vVVVVVVVVVVV#.",
            "..#VVVVVVVVVV#..",
            "..#VVVVVVVVVV#..",
            "...#VVVVVVVV#...",
            "....#VVVVVV#....",
            "....########....",
            "................",
            "................",
        ]
    )
    water_barrel = paint16(
        [
            "....########....",
            "..##t#aaaa#B##..",
            ".#tb#kAAAAa#bx#.",
            ".#ss#aaaaaa#ss#.",
            "#dSS########SSd#",
            "#tbbbBBBBBBBBbx#",
            "#tbbbBBBBBBBBbx#",
            "#tbbbbBBBBbbbbx#",
            "#ssssssssssssss#",
            "#dSSSSSSSSSSSSd#",
            "#bBBBBxxxxBBBBx#",
            ".#bBBBBxxBBBBx#.",
            ".##BBBBxxBBBB##.",
            "...##########...",
            "................",
            "................",
        ]
    )
    # 105: Alley Sapper's iron bomb with lit fuse
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

    def town_tree(hi: str, mid: str, lo: str, dark: str) -> tuple[Image.Image, Image.Image]:
        top = paint16(
            [
                "....########....",
                "..##" + hi * 4 + mid * 4 + "##..",
                ".#" + hi * 4 + mid * 5 + lo * 3 + "#.",
                ".#" + hi * 2 + mid * 6 + lo * 4 + "#.",
                "#" + hi * 2 + mid * 6 + lo * 4 + dark * 2 + "#",
                "#" + mid * 7 + lo * 5 + dark * 2 + "#",
                "#" + mid * 5 + lo * 6 + dark * 3 + "#",
                "#" + mid * 4 + lo * 6 + dark * 4 + "#",
                "#" + lo * 9 + dark * 5 + "#",
                ".#" + lo * 6 + dark * 6 + "#.",
                ".#" + lo * 4 + dark * 8 + "#.",
                "..###" + dark * 6 + "###..",
                ".....######.....",
                ".....#bBBB#.....",
                ".....#bBBB#.....",
                ".....#xBBx#.....",
            ]
        )
        bot = paint16(
            [
                ".....#bBBB#.....",
                ".....#bBBB#.....",
                ".....#bBBB#.....",
                ".....#xBBx#.....",
                ".....#xBBx#.....",
                "....#bxBBxb#....",
                "...#xB####Bx#...",
                "...##########...",
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

    green_tree_top, green_tree_bot = town_tree("e", "g", "G", "f")
    autumn_tree_top, autumn_tree_bot = town_tree("y", "u", "o", "R")

    bush = paint16(
        [
            "................",
            "................",
            "....########....",
            "..##eeeegggg##..",
            ".#eegggrggGggG#.",
            ".#egGggggGrGGG#.",
            "#egGGgGggGGGGGG#",
            "#gGGgrGGgGGGrGG#",
            "#gGGGGGGGGGGGGG#",
            ".#GGGGffffGGGG#.",
            ".##GffffffffG##.",
            "...##########...",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    signpost = paint16(
        [
            "................",
            "..############..",
            ".#tttttttttttb#.",
            ".#tbbtbbbtbbtB#.",
            ".#tbbbbbbbbbBB#.",
            ".#BbbbbBBBBBBB#.",
            "..############..",
            "......#bB#......",
            "......#bB#......",
            "......#bB#......",
            "......#xB#......",
            ".....#gxBg#.....",
            "......####......",
            "................",
            "................",
            "................",
        ]
    )
    beehive = paint16(
        [
            "................",
            ".....######.....",
            "....#yyyyyy#....",
            "...#yyyyoooo#...",
            "...##########...",
            "..#yyyooooooo#..",
            "..############..",
            "..#yyoooo##OO#..",
            "..#oooooo##OO#..",
            "...##########...",
            "...#OOooooOO#...",
            "....########....",
            "....#B#..#B#....",
            "....###..###....",
            "................",
            "................",
        ]
    )
    log = paint16(
        [
            "................",
            "................",
            "................",
            "...##########...",
            "..#tB#bbbbbbB#..",
            ".#tbt#bbBBBBbx#.",
            ".#tbB#bgeGbbBx#.",
            ".#tbt#bBBBxxxx#.",
            "..#B##xxxxxxx#..",
            "...##########...",
            "................",
            "................",
            "................",
            "................",
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
        106: log,
    }
    return place_tiles(12, 11, mapping), mapping


# ---------------------------------------------------------------------------
# 3. Battlefield (battle/tilemap_packed.png — 18 cols x 11 rows)
#    Note: frames 0, 1, 2 are also reused as Farmlands pasture grass (untinted).
# ---------------------------------------------------------------------------
def build_battle_sheet() -> tuple[Image.Image, dict[int, Image.Image]]:
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
                (4, 3, "e"), (5, 3, "E"), (4, 4, "e"), (12, 7, "e"),
                (13, 7, "E"), (13, 8, "G"), (2, 12, "G"), (9, 13, "e"),
                (10, 13, "G"), (6, 1, "G"), (15, 11, "G"),
            ],
        )
    )
    meadow_2 = paint16(
        set_pixels(
            fill_solid("g"),
            [
                (3, 4, "Y"), (4, 4, "W"), (3, 5, "G"), (11, 9, "y"),
                (12, 9, "W"), (11, 10, "e"), (6, 2, "e"), (14, 3, "G"),
                (2, 13, "e"), (9, 14, "G"),
            ],
        )
    )
    # 25: Sandbag & Timber Barricade (block)
    barricade = paint16(
        [
            "................",
            "..#bb#....#bb#..",
            "..#tb######bt#..",
            ".#ttttooootttt#.",
            ".#ttoo####oott#.",
            "#ttoo#BBBB#ooot#",
            "#oooo######oooo#",
            "#ttttooottttooo#",
            "#tooOOOOooOOOOo#",
            "#ttoooottttoooo#",
            "#oooOOOOooOOOOo#",
            ".#OOOOOOOOOOOO#.",
            "..############..",
            "................",
            "................",
            "................",
        ]
    )
    # 23: Forged Steel Czech Hedgehog Tank Trap (block)
    tank_trap = paint16(
        [
            "..##........##..",
            ".#ws#......#sw#.",
            ".#sSd#....#dSs#.",
            "..#sSd#..#dSs#..",
            "...#sS####Ss#...",
            "....#wwssSS#....",
            "...##sSSSSs##...",
            "..#ws#dSSd#Sw#..",
            "..#sS##dd##Ss#..",
            "...##.#SS#.##...",
            ".....#sSSs#.....",
            "...##sSd#dS##...",
            "..#wSs#..#sSD#..",
            ".#sSD#....#DSs#.",
            ".#DD#......#DD#.",
            "..##........##..",
        ]
    )
    boulder = paint16(
        [
            "....########....",
            "..##wwssssss##..",
            ".#wwsssssSSsss#.",
            ".#wsssSSssssSS#.",
            "#ssSSSdddSSSSSd#",
            "#eessdddddddSSd#",
            "#GeesssdddddddD#",
            "#GGesssDDDDdddD#",
            "#ddGGDDDDDDDDdd#",
            ".#ddDDDDDDDDdd#.",
            "..##DDDDDDDD##..",
            "....########....",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    spruce = paint16(
        [
            ".......##.......",
            "......#gg#......",
            ".....#ggGG#.....",
            "....#GGffGG#....",
            "...#ggffffGG#...",
            "..#GGffffffGG#..",
            "..#Gfffffffff#..",
            "...##ffffff##...",
            "..#ggffffffGG#..",
            ".#GGFFFFFFFFGG#.",
            "..##FFFFFFFF##..",
            "......#Bx#......",
            "......#Bx#......",
            ".....#xBBx#.....",
            "......####......",
            "................",
        ]
    )
    tree_pair = paint16(
        [
            "...##...........",
            "..#gg#.....##...",
            ".#ggGG#...#gg#..",
            "#GGffGG#.#ggGG#.",
            ".#ffff#.#GGffGG#",
            "#GGffGG##fffff#.",
            "#ffffffG#GGffGG#",
            ".##ff##.#ffffff#",
            "..#Bx#...##ff##.",
            "..#Bx#....#Bx#..",
            "..###.....#Bx#..",
            "..........###...",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    war_flag = paint16(
        [
            "...#y#..........",
            "...#s#####......",
            "...#s#rrrr###...",
            "...#s#ryrrrRR#..",
            "...#s#ryyrrr#...",
            "...#s#rrrrRR##..",
            "...#s#RRRRR#....",
            "...#s#######....",
            "...#s#..........",
            "...#S#..........",
            "...#S#..........",
            "...#S#..........",
            "..#dSd#.........",
            "..#####.........",
            "................",
            "................",
        ]
    )
    bunker = paint16(
        [
            "................",
            "...##########...",
            "..#wwssssssSS#..",
            ".#wssssssssSSSd#",
            ".#s##########Sd#",
            "#sS#DDDDDDDD#Sd#",
            "#sS#D######D#Sd#",
            "#SS#DDDDDDDD#Sd#",
            "#SS##########Sd#",
            "#ddSSddddddSSdd#",
            "#ddDDDDDDDDDDdd#",
            "#dDDDDDDDDDDDDd#",
            ".##############.",
            "................",
            "................",
            "................",
        ]
    )
    # 152 & 153: Iron Tank (mortar_tank Roll & Fire w/ #84cc16 tactical stripe)
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
    # Tilled soil 4-tile strips: row A = 48..51, row B = 60..63
    soil_a_left = paint16(
        [
            "................",
            "..##############",
            ".#TTTTTTXXXXXXXX",
            "#TTTxxxxxxxxxxxx",
            "#TXXXXXXXXXXXXXX",
            "#TxxXXXXXXXXXXXX",
            "#TTTTTTTXXXXXXXX",
            "#TTTxxxxxxxxxxxx",
            "#XXXXXXXXXXXXXXX",
            "#TxxXXXXXXXXXXXX",
            "#TTTTTTTXXXXXXXX",
            "#TTTxxxxxxxxxxxx",
            "#XXXXXXXXXXXXXXX",
            ".#xxxxxxxxxxxxxx",
            "..##############",
            "................",
        ]
    )
    soil_a_mid = paint16(
        [
            "................",
            "################",
            "TTTTTTTTXXXXXXXX",
            "xxxxxxxxxxxxxxxx",
            "XXXXXXXXXXXXXXXX",
            "xxxxXXTXXXXXXXXX",
            "TTTTTTTTXXXXXXXX",
            "xxxxxxxxxxxxxxxx",
            "XXXXXXXXXXXXXXXX",
            "xxxxxxxxXXTXXXXX",
            "TTTTTTTTXXXXXXXX",
            "xxxxxxxxxxxxxxxx",
            "XXXXXXXXXXXXXXXX",
            "xxxxxxxxxxxxxxxx",
            "################",
            "................",
        ]
    )
    soil_a_right = paint16(
        [
            "................",
            "##############..",
            "TTTTTTTTTTTTT#..",
            "xxxxxxxxxxxxXX#.",
            "XXXXXXXXXXXXXX#.",
            "XXXXXXXXXXXXxx#.",
            "TTTTTTTTTTTTTX#.",
            "xxxxxxxxxxxxXX#.",
            "XXXXXXXXXXXXXX#.",
            "XXXXXXXXXXXXxx#.",
            "TTTTTTTTTTTTTX#.",
            "xxxxxxxxxxxxXX#.",
            "XXXXXXXXXXXXXX#.",
            "xxxxxxxxxxxxx#..",
            "##############..",
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

    # 96 & 97: Golden Hay Bales (blocks)
    hay_a = paint16(
        [
            "....########....",
            "..##yyyyyyyy##..",
            ".#yyyyyoooyyyyo#",
            ".#yyrooyyyyrooo#",
            "#yoorooyyyroooo#",
            "#yyrooyyyyoooro#",
            "#oyrooyyyyyyroo#",
            "#yyroyoooyyoroo#",
            "#oooroooooorooo#",
            "#yyrooyyyyroooo#",
            ".#yrooooooooor#.",
            ".##OOOOOOOOOO##.",
            "...##########...",
            "................",
            "................",
            "................",
        ]
    )
    hay_b = paint16(
        [
            "..############..",
            ".#yyyyyooyyyyyo#",
            ".#yrooyyyyroooo#",
            "#yyroyooooooroo#",
            "#oooyyyyyyyoooo#",
            "################",
            "#yyyyyooooyyyyy#",
            "#yrooyyyyyyrooo#",
            "#oooyyyroooooOo#",
            "#yyrooooooorOOo#",
            "#OOroooooooOOOo#",
            ".#OOOOOOOOOOOO#.",
            "..############..",
            "................",
            "................",
            "................",
        ]
    )

    # 3 & 15: Pasture Pine
    pine_top = paint16(
        [
            ".......##.......",
            "......#ee#......",
            ".....#eegg#.....",
            "....#ggGGgg#....",
            "...#eeffffGG#...",
            "...##ffffff##...",
            "..#eeggffggGG#..",
            ".#eeffffffffGG#.",
            ".##ffffffffff##.",
            "..#eeggffggGG#..",
            "#eeffffffffffGG#",
            "#GffffffffffffF#",
            ".###ffffffff###.",
            ".....#bBBB#.....",
            ".....#bBBB#.....",
            ".....#xBBx#.....",
        ]
    )
    pine_bot = paint16(
        [
            ".....#bBBB#.....",
            ".....#bBBB#.....",
            ".....#xBBx#.....",
            ".....#xBBx#.....",
            "....#bxBBxb#....",
            "...#gB####Bg#...",
            "....########....",
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
            "....########....",
            "..##eeeegggg##..",
            ".#eegpggggpggg#.",
            ".#egGgggggGGgg#.",
            "#egpGGgGggGgpGG#",
            "#gGGGGGgGGGGGgG#",
            "#GGffGGGGGGffGG#",
            ".#GffffffffffG#.",
            "..##ffffffff##..",
            "....########....",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    cider_barrel = paint16(
        [
            "................",
            "....########....",
            "..##tbbbbbbB##..",
            ".#tbBBBBBBBBbx#.",
            ".#ssssssssssss#.",
            ".#tbbb#rR#bbbx#.",
            ".#tbbbBBBBbbbx#.",
            ".#tbbbbBBBBbbx#.",
            ".#ssssssssssss#.",
            ".#bBBBBxxxxBBx#.",
            "..#BBBBxxBBBx#..",
            "...##########...",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    sunflower = paint16(
        [
            "....########....",
            "..##yyyyyyyy##..",
            ".#yyyo#BB#oyyy#.",
            ".#yyo#BBBB#oyy#.",
            ".#yyo#BxxB#oyy#.",
            "..##yo#BB#oy##..",
            "...#yyyyyyyy#...",
            "....########....",
            "......#gg#......",
            "....##eGg#......",
            "...#eeg#gG#.....",
            "....###gGe#.....",
            "......#gg##.....",
            "......#GG#......",
            "......####......",
            "................",
        ]
    )
    carrot = paint16(
        [
            ".....##..##.....",
            "....#ee##ee#....",
            ".....#egge#.....",
            "......#gg#......",
            ".....######.....",
            "....#uuuuuu#....",
            "....#uuRuuu#....",
            ".....#uuuu#.....",
            ".....#uRuu#.....",
            "......#uu#......",
            "......#uu#......",
            ".......##.......",
            "................",
            "................",
            "................",
            "................",
        ]
    )
    corn = paint16(
        [
            "......####......",
            ".....#YYYY#.....",
            "....#YyYyYy#....",
            "....#yYyYyY#....",
            "....#YyYyYy#....",
            "...##yYyYyY##...",
            "..#ee#YYYY#eg#..",
            "..#egG####GgG#..",
            "...#egGggGGg#...",
            "....#GGffGG#....",
            ".....#fGGf#.....",
            "......#GG#......",
            "......####......",
            "................",
            "................",
            "................",
        ]
    )
    tomato = paint16(
        [
            ".......##.......",
            "......#gg#......",
            ".....######.....",
            "...##rrRRRR##...",
            "..#rrWrrrrRRR#..",
            "..#rrrrrrRRRR#..",
            "..#rrrrrrrrRR#..",
            "...#rrrrRRRR#...",
            "....#RRRRRR#....",
            ".....######.....",
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
            "....########....",
            "..##eeEEEEee##..",
            ".#eEeggggggEeG#.",
            ".#egEeeeeeEegG#.",
            "#eggegggggggegG#",
            "#gGggGGGGGGggGG#",
            "#GGffGGGGGGffGG#",
            ".#ffffffffffff#.",
            "..##ffffffff##..",
            "....########....",
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
            ".....####.......",
            "....#rrrr#......",
            "...#WWWWWW#.....",
            "..#uWW#WWWs#....",
            "..##WWWWWWws#...",
            "....#WWwwWWws#..",
            "...#WWwsssWWww#.",
            "...#WWsssssWWW#.",
            "....#ssWWWWss#..",
            ".....########...",
            "......#u#.#u#...",
            ".....#uu#.#uu#..",
            "................",
            "................",
            "................",
        ]
    )
    sheep = paint16(
        [
            "................",
            "....########....",
            "..##WWWWWWWW##..",
            ".#WWwwWWWWwwWW#.",
            "#WW#dddddd#WWwW#",
            "#WW#dd#d#d#WWwW#",
            "#WW#dddddd#WWww#",
            ".#wW######WWww#.",
            ".#WWWWWWWWwwWW#.",
            "..#wwWWWWwwww#..",
            "...##########...",
            "....#dd##dd#....",
            "....###..###....",
            "................",
            "................",
            "................",
        ]
    )
    # 121 & 123: Stampede Bull (charge 0 & charge 1)
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


def make_preview(
    groups: list[tuple[str, list[tuple[str, Image.Image]]]]
) -> Image.Image:
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
                    ("49 pthA", ski_map[49]), ("52 pthB", ski_map[52]), ("81 rock", ski_map[81]),
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
    try:
        SCRATCH_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        preview.save(SCRATCH_PREVIEW)
        print(f"Wrote 3x preview sheet -> {SCRATCH_PREVIEW} {preview.size}")
    except OSError as err:
        print(f"Skipped preview: {err}")


if __name__ == "__main__":
    main()
