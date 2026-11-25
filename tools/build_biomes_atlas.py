#!/usr/bin/env python3
"""
Builds the 4 cohesive "Hearth & Slate" dark-fantasy biome tilesets for Dungeonle,
replacing the clashing bright Kenney outdoor packs while preserving exact tile-grid
dimensions so DungeonScene's spritesheet loader works seamlessly:

  - public/assets/ski/tilemap_packed.png    (192x176, 12x11 tiles) -> Frost Vault (snow)
  - public/assets/town/tilemap_packed.png   (192x176, 12x11 tiles) -> Cobble Keep (town) + frame 105 sapper_bomb
  - public/assets/battle/tilemap_packed.png (288x176, 18x11 tiles) -> Ash Rampart (battle)
  - public/assets/farm/tilemap_packed.png   (192x176, 12x11 tiles) -> Mossy Cellar (farm)

All biome tiles share:
  - Unified charcoal-slate ink outline: #14131a (zero pure #000000, zero pure #ffffff)
  - Calm muted floor luminance strictly within L = 14-23% so hero, enemies, loot & projectiles pop in 50ms
  - Crisp, unmistakable solid obstacle blocks strictly separate from tiny/flat walk-through edge decor
  - Exact 1:1 16x16 pixel grid

Outputs:
  - public/assets/{ski,town,battle,farm}/tilemap_packed.png
  - <scratch>/biomes_preview.png (3x side-by-side mock room QA sheet across all 5 biomes)
"""

from __future__ import annotations

import colorsys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "public" / "assets"
DUNGEON_ATLAS_PNG = ASSETS_DIR / "dungeon" / "dungeon_atlas.png"
SCRATCH_PREVIEW = Path(
    "/Users/Samer/.gemini/antigravity/brain/681e0dd1-392e-45a9-b08c-5ca9e857fe94/scratch/biomes_preview.png"
)


def hex_rgba(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


# Shared Hearth & Slate master accents
INK = hex_rgba("#14131a")
SLATE_0 = hex_rgba("#21232e")
SLATE_1 = hex_rgba("#2c303e")
SLATE_2 = hex_rgba("#43495e")
SLATE_3 = hex_rgba("#6a738c")
SLATE_4 = hex_rgba("#a9b6cc")

OAK_0 = hex_rgba("#4d2e24")
OAK_1 = hex_rgba("#8c5236")
OAK_2 = hex_rgba("#d49562")
GOLD_1 = hex_rgba("#e6a82e")
GOLD_2 = hex_rgba("#f7df86")

BONE = hex_rgba("#f2efe4")
SKY_1 = hex_rgba("#45a2e5")
SKY_2 = hex_rgba("#9edbf7")
CRIM_0 = hex_rgba("#7a222e")
CRIM_1 = hex_rgba("#e04f44")
EMBER = hex_rgba("#f0853a")
MOSS_0 = hex_rgba("#265c42")
MOSS_1 = hex_rgba("#4eab5b")
MOSS_2 = hex_rgba("#96db6e")


def paint(rows: list[str], pal: dict[str, tuple[int, int, int, int]]) -> Image.Image:
    assert len(rows) == 16, f"Expected 16 rows, got {len(rows)}"
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        assert len(row) == 16, f"Row {y} width {len(row)} != 16: {row}"
        for x, ch in enumerate(row):
            if ch != ".":
                px[x, y] = pal[ch]
    return img


def set_px(img: Image.Image, pts: list[tuple[int, int, str]], pal: dict[str, tuple[int, int, int, int]]) -> Image.Image:
    out = img.copy()
    px = out.load()
    for x, y, ch in pts:
        px[x, y] = pal[ch]
    return out


def pack_sheet(cols: int, rows: int, tiles: dict[int, Image.Image]) -> Image.Image:
    sheet = Image.new("RGBA", (cols * 16, rows * 16), (0, 0, 0, 0))
    for idx, im in tiles.items():
        c = idx % cols
        r = idx // cols
        assert 0 <= r < rows, f"Frame {idx} out of bounds for {cols}x{rows} sheet"
        sheet.alpha_composite(im, (c * 16, r * 16))
    return sheet


def flat_pixels(im: Image.Image) -> list[tuple[int, int, int, int]]:
    fn = getattr(im, "get_flattened_data", im.getdata)
    return list(fn())


def audit_sheet(
    name: str,
    sheet: Image.Image,
    expected_size: tuple[int, int],
    floor_tiles: list[Image.Image],
) -> None:
    assert sheet.size == expected_size, f"{name}: expected {expected_size}, got {sheet.size}"
    for r, g, b, a in flat_pixels(sheet):
        if a > 0:
            assert (r, g, b) != (0, 0, 0), f"{name}: pure #000000 found"
            assert (r, g, b) != (255, 255, 255), f"{name}: pure #ffffff found"
    for i, im in enumerate(floor_tiles):
        ls = []
        for r, g, b, a in flat_pixels(im):
            if a > 0:
                _, l, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
                ls.append(l * 100)
        lo, hi = min(ls), max(ls)
        assert 13.5 <= lo and hi <= 23.5, f"{name} floor[{i}] L range {lo:.1f}-{hi:.1f}% outside 13.5-23.5%"


# ===========================================================================
# 1. FROST VAULT (snow -> public/assets/ski/tilemap_packed.png, 12x11 = 192x176)
# ===========================================================================
def build_frost_vault() -> tuple[Image.Image, dict[int, Image.Image], list[int]]:
    pal = {
        "#": INK,
        # Floor ramp strictly L 15-22%
        "0": hex_rgba("#1d2633"),  # L=15.7% frost mortar/crevasse
        "1": hex_rgba("#232e3e"),  # L=19.0% dark glacial slate slab
        "2": hex_rgba("#293647"),  # L=22.0% frosted subtle bevel
        # Block ramp (ice-veined stone monolith)
        "b": hex_rgba("#263447"),  # block lo
        "B": hex_rgba("#415975"),  # block mid
        "I": hex_rgba("#7899ba"),  # block hi
        "z": SKY_2,                # #9edbf7 crystalline frost vein
        "a": SKY_1,                # #45a2e5 ice shade
        "w": BONE,                 # #f2efe4 crisp specular
        "s": SLATE_1,
        "S": SLATE_2,
    }
    tiles: dict[int, Image.Image] = {}

    # Floor tiles: 0..3 (regular slabs), 4..5 (sparse accents)
    f0 = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    tiles[0] = f0
    # Hairline diagonal ice seam
    tiles[1] = set_px(f0, [(4, 3, "0"), (5, 4, "0"), (6, 5, "0"), (5, 3, "2"), (6, 4, "2")], pal)
    # Subtle frosted corner sheen
    tiles[2] = set_px(f0, [(2, 2, "2"), (3, 2, "2"), (2, 3, "2"), (11, 12, "0"), (12, 12, "0")], pal)
    # Split twin glacial flagstones
    tiles[3] = paint(
        [
            "1222222012222210",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "0000000000000000",
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    # Accent 4: subtle frost-crystal rune etching (still strictly L 15-22%)
    tiles[4] = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111211111110",
            "2111112021111110",
            "2111121012111110",
            "2111211011211110",
            "2112111011121110",
            "2120000200002110",
            "2112111011121110",
            "2111211011211110",
            "2111121012111110",
            "2111112021111110",
            "2111111211111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    # Accent 5: sunken frosted vault seam
    tiles[5] = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2110000000001110",
            "2110222222201110",
            "2110211111201110",
            "2110210001201110",
            "2110210201201110",
            "2110210001201110",
            "2110211111201110",
            "2110222222201110",
            "2110000000001110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )

    # Solid obstacle blocks (81, 82) — unmistakable sculptural glacial monoliths!
    # 81: Ice-Capped Glacial Stone Monolith (frosted top bevel + faceted ice-veined stone core)
    tiles[81] = paint(
        [
            "################",
            "#zzIIIIIIIIIzzI#",
            "#zIIBBBBBBBBzII#",
            "#IIBBIIIIIIBBBI#",
            "#IBBIzIIIIBBBBB#",
            "#IBB#IIBBBBb#BB#",
            "#IBB#IBBBBBb#bB#",
            "#IBB#BBaBBBB#bB#",
            "#IBb#BaaBBbb#bb#",
            "#Ibb#BBaBbbb#bb#",
            "#bbb#########bb#",
            "#bBBBBBBBBBBBbb#",
            "#bbbbbbbbbbbbbb#",
            "#00bbbbbbbbbb00#",
            "#00000000000000#",
            "################",
        ],
        pal,
    )
    # 82: Chiseled Frost Vault Pillar Block (symmetrical faceted icy stone)
    tiles[82] = paint(
        [
            "################",
            "#IIIIIIIIIIIIII#",
            "#IzBBBBBBBBBBzI#",
            "#IBB########BBI#",
            "#IB#IIzzIIII#Bb#",
            "#IB#IBzIBBBB#Bb#",
            "#IB#IBBBaaBB#bb#",
            "#IB#BBBBaBBB#bb#",
            "#Ib#BBBbbbBB#bb#",
            "#Ib#bbbbbbbb#bb#",
            "#bb##########bb#",
            "#BBBBBBBBBBBBbb#",
            "#bbbbbbbbbbbbbb#",
            "#00bbbbbbbbbb00#",
            "#00000000000000#",
            "################",
        ],
        pal,
    )

    # Sparse walk-through edge decor (30, 31, 32) — strictly flat/tiny floor scatter!
    # 30: Flat Rime Frost Patch (quiet irregular floor frost glaze, zero specular hotspot)
    tiles[30] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "....002220......",
            "...022BBB220....",
            "..02BBBBBBB20...",
            "..022BBBBB220...",
            "...0022B2220....",
            ".....000000.....",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
        ],
        pal,
    )
    # 31: Tiny Floor Ice Shards (small crystal chips tucked near wall)
    tiles[31] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "......##........",
            ".....#zI#.......",
            "....#zIB#.##....",
            "....#IBB##IB#...",
            "....#bbb##bb#...",
            ".....#######....",
            "................",
            "................",
            "................",
            "................",
        ],
        pal,
    )
    # 32: Small Frosted Slate Pebbles
    tiles[32] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....###.........",
            "...#IBb#...##...",
            "...#bbb#..#Bb#..",
            "....###....##...",
            ".......##.......",
            "......#Bb#......",
            ".......##.......",
            "................",
            "................",
        ],
        pal,
    )

    floor_ids = [0, 1, 2, 3, 4, 5]
    sheet = pack_sheet(12, 11, tiles)
    audit_sheet("Frost Vault (ski)", sheet, (192, 176), [tiles[i] for i in floor_ids])
    return sheet, tiles, floor_ids


# ===========================================================================
# 2. COBBLE KEEP (town -> public/assets/town/tilemap_packed.png, 12x11 = 192x176)
#    Includes frame 105 = Sapper's Lit Iron Bomb (DungeonScene.ts:1786)
#    and frame 106 in solid blocks (dungeonle.test.ts:1164)
# ===========================================================================
def build_cobble_keep() -> tuple[Image.Image, dict[int, Image.Image], list[int]]:
    pal = {
        "#": INK,
        # Warm muted cobblestone floor strictly L 15-22%
        "0": hex_rgba("#2b2622"),  # L=15.1% warm dark mortar
        "1": hex_rgba("#342e29"),  # L=18.2% muted cobblestone mid
        "2": hex_rgba("#3e3731"),  # L=21.8% worn cobble top
        # Warm keep masonry & banded oak block ramps
        "k": hex_rgba("#3a322c"),  # stone lo
        "K": hex_rgba("#52463d"),  # stone mid
        "L": hex_rgba("#6e5e52"),  # stone hi
        "u": hex_rgba("#3b2c23"),  # dark barricade timber
        "b": hex_rgba("#5e4332"),  # mid barricade timber
        "t": hex_rgba("#8c6549"),  # lit barricade oak
        # Shared metal/hearth accents
        "s": SLATE_0,
        "S": SLATE_1,
        "m": SLATE_2,
        "M": SLATE_3,
        "4": SLATE_4,
        "g": GOLD_1,
        "y": GOLD_2,
        "w": BONE,
        "r": CRIM_1,
        "o": EMBER,
        "T": OAK_2,
    }
    tiles: dict[int, Image.Image] = {}

    # Floor cobblestones: 109..112 (interlocking warm muted cobbles, calm contrast) + 113 accent drain
    tiles[109] = paint(
        [
            "0222220022222220",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "1111111011111110",
            "0000000000000000",
            "2220022222220022",
            "1110211111110211",
            "1110211111110211",
            "1110211111110211",
            "0000000000000000",
            "0222222002222220",
            "2111111102111110",
            "2111111102111110",
            "1111111101111110",
            "0000000000000000",
        ],
        pal,
    )
    tiles[110] = set_px(tiles[109], [(3, 2, "2"), (4, 2, "2"), (11, 8, "0"), (12, 8, "0")], pal)
    tiles[111] = set_px(tiles[109], [(10, 3, "2"), (5, 13, "0"), (6, 13, "0"), (12, 13, "2")], pal)
    tiles[112] = set_px(tiles[109], [(2, 8, "2"), (8, 8, "2"), (13, 2, "0"), (4, 12, "2")], pal)
    # Accent 113: sunken iron keep floor drain (calm L 14-21%)
    tiles[113] = paint(
        [
            "0222220022222220",
            "2111111021111110",
            "2111111021111110",
            "2110000000001110",
            "1110202020201110",
            "0000202020200000",
            "2220202020200022",
            "1110202020200211",
            "1110202020200211",
            "1110202020200211",
            "0000000000000000",
            "0222222002222220",
            "2111111102111110",
            "2111111102111110",
            "1111111101111110",
            "0000000000000000",
        ],
        pal,
    )

    # Courtyard inlaid flagstone patches (0, 1, 2) — calm large pavers in same L 14-21% band
    p0 = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    tiles[0] = p0
    tiles[1] = set_px(p0, [(4, 5, "0"), (5, 5, "0"), (10, 9, "2"), (11, 9, "2")], pal)
    tiles[2] = set_px(p0, [(10, 4, "0"), (9, 4, "0"), (4, 11, "2"), (5, 11, "2")], pal)

    # CRITICAL ENGINE FRAME 105: Sapper's Lit Iron Bomb (DungeonScene.ts:1786)
    tiles[105] = paint(
        [
            ".........###....",
            "........#oyo#...",
            ".......#r#y#r#..",
            ".......##T###...",
            "......##T#......",
            ".....#ggg#......",
            "....#MMmMS#.....",
            "...#M4wMmmS#....",
            "..#MM44MmmmS#...",
            "..#MMmMmmmmS#...",
            "..#MmmmmmmSS#...",
            "..#mmmmmSSSS#...",
            "...#mmSSSSs#....",
            "....#SSSSs#.....",
            ".....#####......",
            "................",
        ],
        pal,
    )

    # Solid obstacle blocks: 106 (REQUIRED by dungeonle.test.ts:1164!) and 107
    # 106: Iron-Banded Oak Timber Barricade (chunky stacked keep timbers + heavy riveted iron straps)
    tiles[106] = paint(
        [
            "################",
            "#tt#MttttttM#tt#",
            "#tb#mbbbbbbm#tb#",
            "#bb#mbbbbbbm#bb#",
            "#uu#muuuuuug#uu#",
            "####m######m####",
            "#tt#MttttttM#tt#",
            "#tb#mbbbbbbm#tb#",
            "#bb#mbbbbbbm#bb#",
            "#uu#muuuuuug#uu#",
            "####m######m####",
            "#tt#MttttttM#tt#",
            "#bb#mbbbbbbm#bb#",
            "#uu#muuuuuug#uu#",
            "#uu#SuuuuuuS#uu#",
            "################",
        ],
        pal,
    )
    # 107: Keep Reinforced Masonry Buttress
    tiles[107] = paint(
        [
            "################",
            "#LLLLLLLLLLLLLL#",
            "#LgKKKKKKKKKKgL#",
            "#LKKKKKKKKKKKKk#",
            "#Kkk########kkK#",
            "#Kk#LLKKKKKK#kK#",
            "#Kk#KttbbuuK#kK#",
            "#Kk#KtbggbuK#kk#",
            "#Kk#KbbuubuK#kk#",
            "#kk#KKkkkkKK#kk#",
            "#kk##########kk#",
            "#KKKKKKKKKKKKkk#",
            "#kkkkkkkkkkkkkk#",
            "#00kkkkkkkkkk00#",
            "#00000000000000#",
            "################",
        ],
        pal,
    )

    # Sparse walk-through edge decor (83, 84, 85) — strictly flat/tiny floor details!
    # 83: Small Stone Rubble & Cobble Chips
    tiles[83] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....###.........",
            "...#LKk#...##...",
            "...#kkk#..#Kk#..",
            "....###....##...",
            "........###.....",
            ".......#Kk#.....",
            "........##......",
            "................",
            "................",
            "................",
        ],
        pal,
    )
    # 84: Flat Worn Stone Cracks & Dust Drift
    tiles[84] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "......000.......",
            "....0011100.....",
            "...01222110.....",
            "...012K21100....",
            "....01111110....",
            ".....000110.....",
            "........00......",
            "................",
            "................",
            "................",
            "................",
            "................",
        ],
        pal,
    )
    # 85: Tiny Hearth Candle Stub (tiny warm accent tucked in corner)
    tiles[85] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            ".......#........",
            "......#y#.......",
            "......#g#.......",
            ".....#wwT#......",
            ".....#wTT#......",
            ".....#Tbb#......",
            "....#mmmmm#.....",
            ".....#####......",
            "................",
            "................",
        ],
        pal,
    )

    floor_ids = [0, 1, 2, 109, 110, 111, 112, 113]
    sheet = pack_sheet(12, 11, tiles)
    audit_sheet("Cobble Keep (town)", sheet, (192, 176), [tiles[i] for i in floor_ids])
    return sheet, tiles, floor_ids


# ===========================================================================
# 3. ASH RAMPART (battle -> public/assets/battle/tilemap_packed.png, 18x11 = 288x176)
# ===========================================================================
def build_ash_rampart() -> tuple[Image.Image, dict[int, Image.Image], list[int]]:
    pal = {
        "#": INK,
        # Scorched soot basalt slabs strictly L 14-22%
        "0": hex_rgba("#292224"),  # L=14.9% soot seam
        "1": hex_rgba("#32292b"),  # L=17.5% scorched basalt slab
        "2": hex_rgba("#3d3234"),  # L=21.8% ash-dusted bevel
        # Iron-bound bastion block ramp
        "a": hex_rgba("#332828"),  # basalt block lo
        "A": hex_rgba("#4d3c3a"),  # basalt block mid
        "H": hex_rgba("#705955"),  # basalt block hi
        "s": SLATE_1,
        "m": SLATE_2,
        "M": SLATE_3,
        "4": SLATE_4,
        "R": CRIM_0,
        "o": EMBER,
        "g": GOLD_1,
    }
    tiles: dict[int, Image.Image] = {}

    # Floor basalt slabs: 0..3 + sparse accents 4..5 + settled ash patch tiles 6..7
    f0 = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    tiles[0] = f0
    tiles[1] = set_px(f0, [(3, 4, "0"), (4, 4, "0"), (5, 5, "0"), (11, 10, "2"), (12, 10, "2")], pal)
    tiles[2] = set_px(f0, [(10, 3, "0"), (11, 4, "0"), (4, 11, "2"), (5, 11, "2")], pal)
    # Split rampart flagstones
    tiles[3] = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "0000000000000000",
            "1222220122222210",
            "2111110211111110",
            "2111110211111110",
            "2111110211111110",
            "2111110211111110",
            "2111110211111110",
            "1111110111111110",
            "0111110011111100",
        ],
        pal,
    )
    # Accent 4: scorched hairline fissure with quiet ash rim (calm L 15-22%)
    tiles[4] = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111110111111110",
            "2111120111111110",
            "2111110211111110",
            "2111101111111110",
            "2111201100111110",
            "2111100021111110",
            "2111111011111110",
            "2111112011111110",
            "2111111001111110",
            "2111111102111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    # Accent 5: flush dark iron rampart floor plate (calm L 15-22%)
    tiles[5] = paint(
        [
            "1222222222222210",
            "2100000000000110",
            "2102111111120110",
            "2101111111110110",
            "2101121112110110",
            "2101111111110110",
            "2101111111110110",
            "2101111111110110",
            "2101111111110110",
            "2101111111110110",
            "2101121112110110",
            "2101111111110110",
            "2102111111120110",
            "2100000000000110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    # Floor patches 6, 7: settled ash-dusted basalt flagstones (strictly L 15-22%)
    tiles[6] = set_px(f0, [(2, 2, "2"), (3, 2, "2"), (4, 3, "2"), (9, 8, "2"), (10, 9, "2"), (11, 9, "2")], pal)
    tiles[7] = set_px(f0, [(6, 4, "0"), (7, 4, "0"), (3, 10, "2"), (4, 10, "2"), (5, 11, "2"), (12, 5, "2")], pal)

    # Solid obstacle blocks (25, 23) — heavy iron-bound fortress bulwarks!
    # 25: Iron-Bound Bastion Block
    tiles[25] = paint(
        [
            "################",
            "#MMHHHHHHHHHHMM#",
            "#M4HAAAAAAAAH4m#",
            "#mmHAAAAAAAAHmm#",
            "####A######A####",
            "#HHA#HHHHHH#AAa#",
            "#HAA#HAAAAa#AAa#",
            "#AAA#AAooAa#AAa#",
            "#AAA#AARRAa#aaa#",
            "#AAa#AAaaAa#aaa#",
            "#aaa#aaaaaa#aaa#",
            "####a######a####",
            "#mmAAAAAAAAAAmm#",
            "#mMaaaaaaaaaaMm#",
            "#mm0000000000mm#",
            "################",
        ],
        pal,
    )
    # 23: Iron-Plated Rampart Battlement Block (forged iron shield-wall over scorched basalt)
    tiles[23] = paint(
        [
            "################",
            "#HHHHHHHHHHHHHH#",
            "#HAAAAAAAAAAAAa#",
            "#MMMMMMMMMMMMmm#",
            "#M4mmMmmmmM4mmS#".replace("S", "s"),
            "#mmmmmmmmmmmmss#",
            "################",
            "#HAA#HAAAAa#AAa#",
            "#AAA#AAAAAA#AAa#",
            "#AAa#AAaaAa#aaa#",
            "################",
            "#MMMMMMMMMMMMmm#",
            "#M4mmMmmmmM4mms#",
            "#mmmmmmmmmmmmss#",
            "#00aaaaaaaaaa00#",
            "################",
        ],
        pal,
    )

    # Sparse walk-through edge decor (94, 95, 96) — strictly flat/tiny floor scatter!
    # 94: Flat Settled Ash Drift (matte dark soot pile, no shiny highlight)
    tiles[94] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            ".....0000.......",
            "...00222200.....",
            "..022AAAA220....",
            "..02AAAAAA20....",
            "..0022AAA220....",
            "....0000000.....",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
        ],
        pal,
    )
    # 95: Scorched Basalt Rubble Chips
    tiles[95] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "...###..........",
            "..#HAa#....##...",
            "..#aaa#...#Aa#..",
            "...###.....##...",
            ".......##.......",
            "......#Aa#......",
            ".......##.......",
            "................",
            "................",
        ],
        pal,
    )
    # 96: Tiny Fallen Iron Rivet / Scrap Shard
    tiles[96] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            ".....####.......",
            "....#M4mm#......",
            "....#mmss#......",
            ".....####..##...",
            "..........#ms#..",
            "...........##...",
            "................",
            "................",
            "................",
            "................",
        ],
        pal,
    )

    floor_ids = [0, 1, 2, 3, 4, 5, 6, 7]
    sheet = pack_sheet(18, 11, tiles)
    audit_sheet("Ash Rampart (battle)", sheet, (288, 176), [tiles[i] for i in floor_ids])
    return sheet, tiles, floor_ids


# ===========================================================================
# 4. MOSSY CELLAR (farm -> public/assets/farm/tilemap_packed.png, 12x11 = 192x176)
#    Includes 4-tile patch strips 48..51 and 60..63 (DungeonScene.ts:813-825)
#    and frames 96, 97 in solid blocks (dungeonle.test.ts:1168)
# ===========================================================================
def build_mossy_cellar() -> tuple[Image.Image, dict[int, Image.Image], list[int]]:
    pal = {
        "#": INK,
        # Damp cellar flagstones strictly L 14-22%
        "0": hex_rgba("#202b26"),  # L=14.7% damp dark mortar
        "1": hex_rgba("#26322d"),  # L=17.3% cellar flagstone mid
        "2": hex_rgba("#2f3e37"),  # L=21.4% damp stone bevel
        "v": hex_rgba("#243f31"),  # L=19.4% subtle dark cellar seam moss
        # Vine-wrapped cellar stone block ramp
        "c": hex_rgba("#2d382c"),  # block lo
        "C": hex_rgba("#465743"),  # block mid
        "L": hex_rgba("#687d62"),  # block hi
        "F": MOSS_0,               # #265c42 deep pine-moss
        "e": MOSS_1,               # #4eab5b vine leaf mid
        "l": MOSS_2,               # #96db6e tiny moss highlight
        # Cask oak + iron + cave mushroom
        "u": OAK_0,
        "b": OAK_1,
        "t": OAK_2,
        "s": SLATE_1,
        "m": SLATE_2,
        "M": SLATE_3,
        "w": BONE,
    }
    tiles: dict[int, Image.Image] = {}

    # Floor tiles: 0..3 + sparse accents 4..5
    f0 = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    tiles[0] = f0
    tiles[1] = set_px(f0, [(1, 14, "v"), (2, 14, "v"), (14, 2, "v"), (11, 10, "0")], pal)
    tiles[2] = set_px(f0, [(3, 3, "0"), (4, 3, "0"), (13, 13, "v"), (13, 14, "v"), (12, 14, "v")], pal)
    tiles[3] = set_px(f0, [(8, 7, "0"), (9, 7, "2"), (1, 1, "v"), (2, 1, "v"), (1, 2, "v")], pal)
    # Accent 4: subtle moss-seamed cracked cellar stone (strictly L 14-22%)
    tiles[4] = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "211v111111111110",
            "21vv001111111110",
            "211110v111111110",
            "2111110011111110",
            "21111110vv111110",
            "2111111100111110",
            "2111111110v11110",
            "2111111111011110",
            "211111111vv11110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )
    # Accent 5: recessed cellar stone drain (strictly L 14-22%)
    tiles[5] = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2110000000001110",
            "2110202020201110",
            "2110202020201110",
            "2110202020201110",
            "2110202020201110",
            "2110202020201110",
            "2110202020201110",
            "2110000000001110",
            "211v1111111v1110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0111111111111100",
        ],
        pal,
    )

    # 4-tile horizontal cellar runner strips (DungeonScene.ts:813-825 uses 48..51 and 60..63!)
    # Strip A (48..51): subtle mossy stone channel strip (left cap, mid A, mid B, right cap)
    tiles[48] = paint(
        [
            "1222222222222222",
            "2111111111111111",
            "2110000000000000",
            "210vvvvvvvvvvvvv",
            "210v111111111111",
            "210v111111111111",
            "210v112111111111",
            "210v111111111111",
            "210v111111111111",
            "210v111111211111",
            "210v111111111111",
            "210v111111111111",
            "210vvvvvvvvvvvvv",
            "2110000000000000",
            "1111111111111111",
            "0111111111111110",
        ],
        pal,
    )
    tiles[49] = paint(
        [
            "2222222222222222",
            "1111111111111111",
            "0000000000000000",
            "vvv1vvvvvvv1vvvv",
            "1111111011111111",
            "1111111011111111",
            "1112111011111111",
            "1111111011111111",
            "1111111011112111",
            "1111111011111111",
            "1111111011111111",
            "1111111011111111",
            "vvvv1vvvvvvv1vvv",
            "0000000000000000",
            "1111111111111111",
            "0111111111111110",
        ],
        pal,
    )
    tiles[50] = set_px(tiles[49], [(4, 6, "0"), (5, 6, "0"), (11, 9, "v"), (12, 9, "v")], pal)
    tiles[51] = tiles[48].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    # Strip B (60..63): sunken damp stone trench strip
    tiles[60] = paint(
        [
            "1222222222222222",
            "2111111111111111",
            "2111111111111111",
            "2110000000000000",
            "2100111111111111",
            "2101100000000000",
            "21010v1111111111",
            "2101011111111111",
            "2101011111111111",
            "21010v1111111111",
            "2101100000000000",
            "2100111111111111",
            "2110000000000000",
            "2111111111111111",
            "1111111111111111",
            "0111111111111110",
        ],
        pal,
    )
    tiles[61] = paint(
        [
            "2222222222222222",
            "1111111111111111",
            "1111111111111111",
            "0000000000000000",
            "1111111111111111",
            "0000000000000000",
            "11v111101111v111",
            "1111111011111111",
            "1111111011111111",
            "111v111011v11111",
            "0000000000000000",
            "1111111111111111",
            "0000000000000000",
            "1111111111111111",
            "1111111111111111",
            "0111111111111110",
        ],
        pal,
    )
    tiles[62] = set_px(tiles[61], [(3, 7, "v"), (4, 7, "v"), (12, 8, "v")], pal)
    tiles[63] = tiles[60].transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    # Solid obstacle blocks: 96, 97 (BOTH REQUIRED by dungeonle.test.ts:1168!) + 85
    # 96: Vine-Wrapped Cellar Monolith (organic draped moss canopy & cascading ivy clusters)
    tiles[96] = paint(
        [
            "################",
            "#eeelFFLLLLFFeL#",
            "#FFeeFFCCCCFeFL#",
            "#FFFeFCCCCCCFFc#",
            "#LCFF#CCCCCC#Cc#",
            "#LCF##CLCCcC#Cc#",
            "#LCC#CCLLCCc#cc#",
            "#LCC#CCCCCCc#cc#",
            "#LCc#CCccccC#cc#",
            "#Fcc#ccccccF#cc#",
            "#FF##########Fc#",
            "#FCCCCCCCCCCFFc#",
            "#FFccccccccFFcc#",
            "#0FcccccccccFF0#",
            "#00000000000000#",
            "################",
        ],
        pal,
    )
    # 97: Mossy Cellar Buttress Block
    tiles[97] = paint(
        [
            "################",
            "#FFeeLLLLLLFFLL#",
            "#FeleCCCCCCFeFL#",
            "#CFFCCCCCCCCFFC#",
            "#CC#CCCCCCCC#Cc#",
            "#CC#CCLLLLCC#Cc#",
            "#CC#CLCCCCcC#cc#",
            "#CC#CLCCCCcC#cc#",
            "#Cc#CCccccCC#cc#",
            "#cc#cccccccc#cc#",
            "#cc##########cc#",
            "#CCCCCCCCCCCCcc#",
            "#cccccccccccFFc#",
            "#00cccccccccFF0#",
            "#00000000000000#",
            "################",
        ],
        pal,
    )
    # 85: Iron-Hooped Cellar Cask (solid provision barrel with mossy base)
    tiles[85] = paint(
        [
            "................",
            "...##########...",
            "..#ttbbbbbbuu#..",
            ".#MMMMMMMMMMMM#.",
            ".#mmttttbbbbmm#.",
            ".#ttbbbbbbbbuu#.",
            ".#tbubbbubbbuu#.",
            ".#MMMMMMMMMMMM#.",
            ".#mmbbbbbbbbmm#.",
            ".#tbbubbbubbuu#.",
            ".#bbbbbbbbbbuu#.",
            ".#FFmmmmmmmmFF#.",
            "..#FFuuuuuuFF#..",
            "...##########...",
            "................",
            "................",
        ],
        pal,
    )

    # Sparse walk-through edge decor (39, 40, 41) — strictly flat/tiny floor scatter!
    # 39: Flat Damp Moss Tuft
    tiles[39] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            ".....0000.......",
            "...00FFFF00.....",
            "..0FFFeeFFF0....",
            "..0FFeFeFFF0....",
            "...00FFFFF0.....",
            ".....00000......",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
        ],
        pal,
    )
    # 40: Tiny Lichen-Dusted Cellar Pebbles
    tiles[40] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....###.........",
            "...#FCc#...##...",
            "...#ccc#..#Fc#..",
            "....###....##...",
            "........##......",
            ".......#Cc#.....",
            "........##......",
            "................",
            "................",
        ],
        pal,
    )
    # 41: Tiny Pale Cave Mushroom Cluster (cleanly centered inside 16x16)
    tiles[41] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....####........",
            "...#wwtt#.......",
            "...##tt####.....",
            "....#bt##wt#....",
            "...#FbbF#bt#....",
            "....#######.....",
            "................",
            "................",
            "................",
            "................",
        ],
        pal,
    )

    floor_ids = [0, 1, 2, 3, 4, 5, 48, 49, 50, 51, 60, 61, 62, 63]
    sheet = pack_sheet(12, 11, tiles)
    audit_sheet("Mossy Cellar (farm)", sheet, (192, 176), [tiles[i] for i in floor_ids])
    return sheet, tiles, floor_ids


# ===========================================================================
# 5. CINDER VAULT (ember -> public/assets/ember/tilemap_packed.png, 12x11 = 192x176)
# ===========================================================================
def build_cinder_vault() -> tuple[Image.Image, dict[int, Image.Image], list[int]]:
    pal = {
        "#": INK,
        # Calm charcoal-basalt slabs L = 14.9-21.0%
        "0": hex_rgba("#292225"),
        "1": hex_rgba("#32292d"),
        "2": hex_rgba("#3b3035"),
        "e": EMBER,
        "r": CRIM_1,
        "R": CRIM_0,
        "b": hex_rgba("#2d2226"),
        "B": hex_rgba("#4d353b"),
        "I": hex_rgba("#7a555d"),
        "g": GOLD_1,
        "y": GOLD_2,
        "s": SLATE_1,
        "S": SLATE_2,
    }
    tiles: dict[int, Image.Image] = {}

    f0 = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0000000000000000",
        ],
        pal,
    )
    tiles[0] = f0
    tiles[1] = set_px(f0, [(4, 5, "2"), (5, 5, "2"), (11, 10, "0"), (12, 10, "0")], pal)
    tiles[2] = set_px(f0, [(8, 0, "0"), (8, 1, "0"), (8, 2, "0"), (8, 3, "0"), (2, 11, "2")], pal)
    tiles[3] = set_px(f0, [(0, 8, "0"), (1, 8, "0"), (2, 8, "0"), (12, 4, "2"), (13, 4, "2")], pal)
    tiles[4] = set_px(f0, [(6, 6, "0"), (7, 6, "2"), (7, 7, "0"), (8, 7, "0"), (8, 8, "2")], pal)
    tiles[5] = set_px(f0, [(10, 4, "2"), (11, 4, "0"), (4, 10, "0"), (5, 11, "2")], pal)
    tiles[6] = paint(
        [
            "1222222012222210",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "0000000000000000",
            "1222222012222210",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "2111111021111110",
            "1111111011111110",
            "0000000000000000",
        ],
        pal,
    )
    tiles[7] = set_px(tiles[6], [(4, 3, "0"), (5, 4, "0"), (11, 11, "2"), (12, 11, "0")], pal)

    # Solid cinder blocks (81, 82)
    tiles[81] = paint(
        [
            "................",
            ".##############.",
            ".#IIIIIIIIIIII#.",
            ".#IBBBBBBBBBB #.".replace(" ", "B"),
            ".#IBBbbbbbbBBI#.",
            ".#IBbrrrrrbbBI#.",
            ".#IBbreeeebbbI#.",
            ".#IBbrryyrbbbI#.",
            ".#IBbbreeebbBI#.",
            ".#IBbbbRRbbbBI#.",
            ".#IBbbbbbbbbBI#.",
            ".#IBBBBBBBBBBI#.",
            ".#bbbbbbbbbbbb#.",
            ".#bbbbbbbbbbbb#.",
            ".##############.",
            "................",
        ],
        pal,
    )
    tiles[82] = paint(
        [
            "................",
            ".##############.",
            ".#SSIIIIIIIIIS#.",
            ".#SBBBBBBBBBBs#.",
            ".#SBbbbbbbbbBs#.",
            ".#SbbRRRRRRbbs#.",
            ".#SbReeeeeeRbs#.",
            ".#SbReeggeeRbs#.",
            ".#SbbRRRRRRbbs#.",
            ".#Sbbbbbbbbbbs#.",
            ".#SBBBBBBBBBBs#.",
            ".#SssssssssssS#.",
            ".#bbbbbbbbbbbb#.",
            ".#bbbbbbbbbbbb#.",
            ".##############.",
            "................",
        ],
        pal,
    )

    # Sparse low-profile floor decor (30, 31, 32)
    tiles[30] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            ".....11111......",
            "....12222210....",
            "....01211100....",
            ".....000000.....",
            "................",
            "................",
        ],
        pal,
    )
    tiles[31] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....###.........",
            "...#B2b#..##....",
            "...#bbb#.#2b#...",
            "....###...##....",
            "................",
            "................",
        ],
        pal,
    )
    tiles[32] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "......##........",
            ".....#Rr#..##...",
            ".....#eR#.#R2#..",
            "......##...##...",
            "................",
            "................",
        ],
        pal,
    )

    floor_ids = [0, 1, 2, 3, 4, 5, 6, 7]
    sheet = pack_sheet(12, 11, tiles)
    audit_sheet("Cinder Vault (ember)", sheet, (192, 176), [tiles[i] for i in floor_ids])
    return sheet, tiles, floor_ids


# ===========================================================================
# 6. SUNKEN MIRE (mire -> public/assets/mire/tilemap_packed.png, 12x11 = 192x176)
# ===========================================================================
def build_sunken_mire() -> tuple[Image.Image, dict[int, Image.Image], list[int]]:
    pal = {
        "#": INK,
        # Calm deep teal-bog slate slabs L = 14.3-21.2%
        "0": hex_rgba("#1d2c2b"),
        "1": hex_rgba("#243634"),
        "2": hex_rgba("#2b413e"),
        "m": MOSS_0,
        "M": MOSS_1,
        "g": MOSS_2,
        "b": hex_rgba("#223836"),
        "B": hex_rgba("#355956"),
        "I": hex_rgba("#5b8a85"),
        "w": BONE,
    }
    tiles: dict[int, Image.Image] = {}

    f0 = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0000000000000000",
        ],
        pal,
    )
    tiles[0] = f0
    tiles[1] = set_px(f0, [(3, 4, "2"), (4, 4, "2"), (11, 11, "0"), (12, 11, "0")], pal)
    tiles[2] = set_px(f0, [(7, 1, "0"), (7, 2, "0"), (7, 3, "0"), (3, 10, "2"), (4, 10, "2")], pal)
    tiles[3] = set_px(f0, [(1, 8, "0"), (2, 8, "0"), (10, 4, "2"), (11, 4, "2")], pal)
    tiles[4] = set_px(f0, [(6, 6, "0"), (7, 6, "2"), (8, 7, "0"), (9, 7, "0")], pal)
    tiles[5] = set_px(f0, [(11, 3, "0"), (11, 4, "2"), (4, 11, "2"), (5, 11, "0")], pal)

    # Sunken runner strip tiles (48..51, 60..63)
    for pid, top_fill, bot_fill in [
        (48, "2", "1"),
        (49, "2", "1"),
        (50, "2", "1"),
        (51, "2", "1"),
        (60, "1", "0"),
        (61, "1", "0"),
        (62, "1", "0"),
        (63, "1", "0"),
    ]:
        tiles[pid] = paint(
            [
                "0000000000000000",
                top_fill * 16,
                "1111111111111110",
                "1111112111111110",
                "1111111111111110",
                "1111111112111110",
                "1111111111111110",
                "1111111111111110",
                "1111111111111110",
                "1111111111111110",
                "1111111111111110",
                "1111111111111110",
                "1111111111111110",
                bot_fill * 15 + "0",
                "0000000000000000",
                "0000000000000000",
            ],
            pal,
        )

    # Solid mire blocks (96, 97)
    tiles[96] = paint(
        [
            "................",
            ".##############.",
            ".#IIIIIIIIIIII#.",
            ".#IMggMBBBBBBI#.",
            ".#IMmMBbbbbbbI#.",
            ".#IBmBBBBBBBBb#.",
            ".#IBbbbbbbbbbb#.",
            ".#IBbbbmMBbbbb#.",
            ".#IBbbbmMMbbbb#.",
            ".#IBbbbbbbmbbb#.",
            ".#IBBBBBBBBmBb#.",
            ".#Ibbbbbbbbbbb#.",
            ".#bbbbbbbbbbbb#.",
            ".#bbbbbbbbbbbb#.",
            ".##############.",
            "................",
        ],
        pal,
    )
    tiles[97] = paint(
        [
            "................",
            "..############..",
            "..#IIIIIIIIII#..",
            "..#IBBMggMBBI#..",
            "..#IBbmMMmbBI#..",
            "..#IBbmmmmbBI#..",
            "..#IBbbbbbbBI#..",
            "..#IBbbBBbbBI#..",
            "..#IBbbbbbbBI#..",
            "..#IBbbbbbbBI#..",
            "..#IBBBBBBBBI#..",
            "..#bbbbbbbbbb#..",
            ".#BBBBBBBBBBBB#.",
            ".#bbbbbbbbbbbb#.",
            ".##############.",
            "................",
        ],
        pal,
    )

    # Sparse floor decor (39, 40, 41)
    tiles[39] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....mmMm........",
            "...mMMMm2.......",
            "...1mm210.......",
            "....0000........",
            "................",
            "................",
        ],
        pal,
    )
    tiles[40] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....###.........",
            "...#I2b#..##....",
            "...#bbb#.#2b#...",
            "....###...##....",
            "................",
            "................",
        ],
        pal,
    )
    tiles[41] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            ".....##.........",
            "....#wg#..##....",
            "....#bM#.#wg#...",
            ".....##...##....",
            "................",
            "................",
            "................",
        ],
        pal,
    )

    floor_ids = [0, 1, 2, 3, 4, 5, 48, 49, 50, 51, 60, 61, 62, 63]
    sheet = pack_sheet(12, 11, tiles)
    audit_sheet("Sunken Mire (mire)", sheet, (192, 176), [tiles[i] for i in floor_ids])
    return sheet, tiles, floor_ids


# ===========================================================================
# 7. DUNE CATACOMB (sand -> public/assets/sand/tilemap_packed.png, 12x11 = 192x176)
# ===========================================================================
def build_dune_catacomb() -> tuple[Image.Image, dict[int, Image.Image], list[int]]:
    pal = {
        "#": INK,
        # Calm muted umber-sandstone slabs L = 15.1-21.8%
        "0": hex_rgba("#2b241d"),
        "1": hex_rgba("#352c24"),
        "2": hex_rgba("#40352b"),
        "b": hex_rgba("#362b21"),
        "B": hex_rgba("#5c4936"),
        "I": hex_rgba("#8a7055"),
        "g": GOLD_1,
        "y": GOLD_2,
        "w": BONE,
        "s": SLATE_1,
    }
    tiles: dict[int, Image.Image] = {}

    f0 = paint(
        [
            "1222222222222210",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "2111111111111110",
            "1111111111111110",
            "0000000000000000",
        ],
        pal,
    )
    tiles[109] = f0
    tiles[110] = set_px(f0, [(4, 5, "2"), (5, 5, "2"), (11, 10, "0"), (12, 10, "0")], pal)
    tiles[111] = set_px(f0, [(8, 0, "0"), (8, 1, "0"), (8, 2, "0"), (3, 11, "2")], pal)
    tiles[112] = set_px(f0, [(0, 8, "0"), (1, 8, "0"), (11, 4, "2"), (12, 4, "2")], pal)
    tiles[113] = set_px(f0, [(6, 6, "0"), (7, 6, "2"), (8, 7, "0"), (8, 8, "2")], pal)

    # Inlaid tomb border patches (0, 1, 2)
    tiles[0] = paint(
        [
            "0000000000000000",
            "0222222222222200",
            "0211111111111200",
            "0211111111111200",
            "0211112222111200",
            "0211112112111200",
            "0211112112111200",
            "0211112222111200",
            "0211111111111200",
            "0211111111111200",
            "0211111111111200",
            "0211111111111200",
            "0211111111111200",
            "0222222222222200",
            "0000000000000000",
            "0000000000000000",
        ],
        pal,
    )
    tiles[1] = set_px(tiles[0], [(3, 3, "0"), (10, 11, "0")], pal)
    tiles[2] = set_px(tiles[0], [(6, 5, "2"), (9, 6, "2")], pal)

    # Solid tomb blocks (106, 107)
    tiles[106] = paint(
        [
            "................",
            ".##############.",
            ".#IIIIIIIIIIII#.",
            ".#IBBBBBBBBBBI#.",
            ".#IBbbbbbbbbBI#.",
            ".#IBbIIIIIIbBI#.",
            ".#IBbIbbbbIbBI#.",
            ".#IBbIbggbIbBI#.",
            ".#IBbIbggbIbBI#.",
            ".#IBbIbbbbIbBI#.",
            ".#IBbIIIIIIbBI#.",
            ".#IBbbbbbbbbBI#.",
            ".#bbbbbbbbbbbb#.",
            ".#bbbbbbbbbbbb#.",
            ".##############.",
            "................",
        ],
        pal,
    )
    tiles[107] = paint(
        [
            "................",
            "..############..",
            "..#IIIIIIIIII#..",
            "..#IBBgyygBBI#..",
            "..#IBbggggbBI#..",
            "..#IBbbbbbbBI#..",
            "..#IBbBIIBbbI#..",
            "..#IBbbbbbbBI#..",
            "..#IBbBIIBbbI#..",
            "..#IBbbbbbbBI#..",
            "..#IBBBBBBBBI#..",
            "..#bbbbbbbbbb#..",
            ".#BBBBBBBBBBBB#.",
            ".#bbbbbbbbbbbb#.",
            ".##############.",
            "................",
        ],
        pal,
    )

    # Sparse floor decor (83, 84, 85)
    tiles[83] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            ".....11111......",
            "....12222210....",
            "....01211100....",
            ".....000000.....",
            "................",
            "................",
        ],
        pal,
    )
    tiles[84] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....###.........",
            "...#I2b#..##....",
            "...#bbb#.#2b#...",
            "....###...##....",
            "................",
            "................",
        ],
        pal,
    )
    tiles[85] = paint(
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            ".....###........",
            "....#B2b#.##....",
            "....#bbg##2b#...",
            ".....###..##....",
            "................",
            "................",
            "................",
        ],
        pal,
    )

    floor_ids = [109, 110, 111, 112, 113, 0, 1, 2]
    sheet = pack_sheet(12, 11, tiles)
    audit_sheet("Dune Catacomb (sand)", sheet, (192, 176), [tiles[i] for i in floor_ids])
    return sheet, tiles, floor_ids


# ===========================================================================
# Visual QA Preview: renders ALL 8 biomes side-by-side WITH exact wallTint,
# solid blocks, sparse decor, hero, binary spikes OFF/ON, and sapper bomb!
# ===========================================================================
def tint_multiply(im: Image.Image, hex_tint: int) -> Image.Image:
    tr = (hex_tint >> 16) & 0xFF
    tg = (hex_tint >> 8) & 0xFF
    tb = hex_tint & 0xFF
    if (tr, tg, tb) == (255, 255, 255):
        return im.copy()
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a > 0:
                px[x, y] = ((r * tr) // 255, (g * tg) // 255, (b * tb) // 255, a)
    return out


def make_biomes_preview(
    frost_tiles: dict[int, Image.Image],
    town_tiles: dict[int, Image.Image],
    battle_tiles: dict[int, Image.Image],
    farm_tiles: dict[int, Image.Image],
    ember_tiles: dict[int, Image.Image],
    mire_tiles: dict[int, Image.Image],
    sand_tiles: dict[int, Image.Image],
) -> Image.Image:
    import json

    atlas = Image.open(DUNGEON_ATLAS_PNG).convert("RGBA")
    meta = json.loads((ASSETS_DIR / "dungeon" / "dungeon_atlas.json").read_text())["frames"]

    def crop(name: str) -> Image.Image:
        f = meta[name]["frame"]
        return atlas.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))

    wall_nw = crop("tile_001")
    wall_n = crop("tile_014")
    wall_grate = crop("tile_028")
    wall_banner = crop("tile_029")
    wall_w = crop("tile_057")
    door_l = crop("tile_022")
    door_r = crop("tile_023")
    hero = crop("hero_idle_0")
    spikes_off = crop("spikes_0")
    spikes_on = crop("spikes_2")
    crate = crop("tile_063")
    chest = crop("tile_091")
    orb_e = crop("orb_enemy_0")
    orb_f = crop("orb_friendly_0")
    torch = crop("torch_0")

    dungeon_floors = [crop(f"tile_{i:03d}") for i in (48, 49, 50, 51, 42)]
    dungeon_blocks = [crop("tile_064")]

    # Matches biomes.ts wallTint and ambientBg values!
    specs = [
        ("Stone Crypt", 0x14131A, 0xFFFFFF, True, dungeon_floors, dungeon_blocks, [], None),
        ("Frost Vault", 0x121720, 0xCCE4FF, False, [frost_tiles[i] for i in (0, 1, 2, 3, 4)], [frost_tiles[81], frost_tiles[82]], [frost_tiles[30], frost_tiles[31], frost_tiles[32]], None),
        ("Cobble Keep", 0x171412, 0xFFD29C, True, [town_tiles[i] for i in (109, 110, 111, 112, 113)], [town_tiles[106], town_tiles[107]], [town_tiles[83], town_tiles[84], town_tiles[85]], town_tiles[105]),
        ("Ash Rampart", 0x171315, 0xF0B8A4, True, [battle_tiles[i] for i in (0, 1, 2, 3, 4)], [battle_tiles[25], battle_tiles[23]], [battle_tiles[94], battle_tiles[95], battle_tiles[96]], None),
        ("Mossy Cellar", 0x121715, 0xB8EAB4, False, [farm_tiles[i] for i in (0, 1, 2, 3, 4)], [farm_tiles[96], farm_tiles[97], farm_tiles[85]], [farm_tiles[39], farm_tiles[40], farm_tiles[41]], [farm_tiles[48], farm_tiles[49], farm_tiles[50], farm_tiles[51]]),
        ("Cinder Vault", 0x171213, 0xF4B698, True, [ember_tiles[i] for i in (0, 1, 2, 3, 4)], [ember_tiles[81], ember_tiles[82]], [ember_tiles[30], ember_tiles[31], ember_tiles[32]], None),
        ("Sunken Mire", 0x101718, 0x9ED9C8, False, [mire_tiles[i] for i in (0, 1, 2, 3, 4)], [mire_tiles[96], mire_tiles[97]], [mire_tiles[39], mire_tiles[40], mire_tiles[41]], [mire_tiles[48], mire_tiles[49], mire_tiles[50], mire_tiles[51]]),
        ("Dune Catacomb", 0x181511, 0xEBD0A2, True, [sand_tiles[i] for i in (109, 110, 111, 112, 113)], [sand_tiles[106], sand_tiles[107]], [sand_tiles[83], sand_tiles[84], sand_tiles[85]], None),
    ]

    room_w, room_h = 6 * 16, 5 * 16  # 96x80 each
    pad = 12
    cols_n = 4
    rows_n = 2
    cell_h = room_h + 40
    total_w = pad + cols_n * (room_w + pad)
    total_h = pad + rows_n * (cell_h + pad)
    canvas = Image.new("RGBA", (total_w, total_h), INK)

    for idx, (_name, amb_bg, w_tint, has_torch, floors, blocks, decors, extra) in enumerate(specs):
        ox = pad + (idx % cols_n) * (room_w + pad)
        oy = pad + (idx // cols_n) * (cell_h + pad)
        # Ambient backdrop strip under each biome card
        bg_c = ((amb_bg >> 16) & 0xFF, (amb_bg >> 8) & 0xFF, amb_bg & 0xFF, 255)
        card_bg = Image.new("RGBA", (room_w + 4, room_h + 38), bg_c)
        canvas.alpha_composite(card_bg, (ox - 2, oy - 2))

        for r in range(5):
            for c in range(6):
                tx, ty = ox + c * 16, oy + r * 16
                if r == 0:
                    wt = (
                        wall_nw if c == 0
                        else wall_banner if c == 1
                        else door_l if c == 3
                        else door_r if c == 4
                        else wall_grate if c == 5
                        else wall_n
                    )
                    if wt not in (door_l, door_r):
                        wt = tint_multiply(wt, w_tint)
                    canvas.alpha_composite(wt, (tx, ty))
                elif c == 0:
                    canvas.alpha_composite(tint_multiply(wall_w, w_tint), (tx, ty))
                else:
                    fl = floors[4] if (r == 2 and c == 3) else floors[(r * 3 + c) % 4]
                    canvas.alpha_composite(fl, (tx, ty))

        # Patch strip demonstration on row 4!
        if isinstance(extra, list):
            for si, st in enumerate(extra):
                canvas.alpha_composite(st, (ox + (1 + si) * 16, oy + 4 * 16))

        if has_torch:
            canvas.alpha_composite(torch, (ox + 2 * 16, oy))

        # Solid blocks (row 1 col 1, row 1 col 4)
        canvas.alpha_composite(blocks[0], (ox + 1 * 16, oy + 1 * 16))
        if len(blocks) > 1:
            canvas.alpha_composite(blocks[1], (ox + 4 * 16, oy + 1 * 16))
        else:
            canvas.alpha_composite(crate, (ox + 4 * 16, oy + 1 * 16))

        # Sparse walk-through edge decor (row 1 col 5, row 4 col 5)
        if decors:
            canvas.alpha_composite(decors[0], (ox + 5 * 16, oy + 1 * 16))
            if len(decors) > 1:
                canvas.alpha_composite(decors[1], (ox + 5 * 16, oy + 4 * 16))

        # Spikes OFF & ON + Hero + Chest + Orbs to verify 50ms figure-ground pop on EVERY biome!
        canvas.alpha_composite(spikes_off, (ox + 1 * 16, oy + 3 * 16))
        canvas.alpha_composite(spikes_on, (ox + 2 * 16, oy + 3 * 16))
        canvas.alpha_composite(hero, (ox + 3 * 16 - 2, oy + 2 * 16 - 2))
        canvas.alpha_composite(chest, (ox + 2 * 16, oy + 1 * 16))
        canvas.alpha_composite(orb_e, (ox + 4 * 16, oy + 2 * 16))
        canvas.alpha_composite(orb_f, (ox + 4 * 16, oy + 3 * 16))

        # Bottom swatch rows: Row 1 = solid blocks + sapper bomb, Row 2 = walk-through edge decor
        sy1 = oy + room_h + 2
        sx1 = ox
        for b_im in blocks:
            canvas.alpha_composite(b_im, (sx1, sy1))
            sx1 += 18
        if isinstance(extra, Image.Image):
            canvas.alpha_composite(extra, (sx1 + 4, sy1))
        sy2 = oy + room_h + 20
        sx2 = ox
        for d_im in decors:
            canvas.alpha_composite(d_im, (sx2, sy2))
            sx2 += 18

    return canvas.resize((total_w * 3, total_h * 3), Image.Resampling.NEAREST)


def main() -> None:
    frost_sheet, frost_tiles, _ = build_frost_vault()
    town_sheet, town_tiles, _ = build_cobble_keep()
    battle_sheet, battle_tiles, _ = build_ash_rampart()
    farm_sheet, farm_tiles, _ = build_mossy_cellar()
    ember_sheet, ember_tiles, _ = build_cinder_vault()
    mire_sheet, mire_tiles, _ = build_sunken_mire()
    sand_sheet, sand_tiles, _ = build_dune_catacomb()

    out_map = [
        ("ski", frost_sheet),
        ("town", town_sheet),
        ("battle", battle_sheet),
        ("farm", farm_sheet),
        ("ember", ember_sheet),
        ("mire", mire_sheet),
        ("sand", sand_sheet),
    ]
    for key, sheet in out_map:
        out_dir = ASSETS_DIR / key
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / "tilemap_packed.png"
        sheet.save(out_path)
        print(f"Wrote {out_path} {sheet.size} [audit PASS]")

    try:
        SCRATCH_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        preview = make_biomes_preview(
            frost_tiles,
            town_tiles,
            battle_tiles,
            farm_tiles,
            ember_tiles,
            mire_tiles,
            sand_tiles,
        )
        preview.save(SCRATCH_PREVIEW)
        print(f"Wrote 3x 8-biome preview -> {SCRATCH_PREVIEW} {preview.size}")
    except OSError as err:
        print(f"Skipped preview: {err}")


if __name__ == "__main__":
    main()
