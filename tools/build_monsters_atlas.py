#!/usr/bin/env python3
"""
Builds the animated 15-monster bestiary atlas for Dungeonle using pure Pillow.

Every monster is drawn with explicitly hand-placed pixels on a cohesive 27-color
dark-fantasy palette (#161224 deep indigo-plum chromatic outline, hue-shifted
ramps, zero pure #000000 shadows, zero grounded drop shadows) at true 1:1
Tiny Dungeon / Dungeonle native scale:
  - 8 standard monsters: 16x16 (slime, mage, shade, sapper, archer, imp, mimic, myconid)
  - 1 heavy brute:       20x20 (brute)
  - 3 heavy biome foes:  22x22 (yeti, tank, bull)
  - 1 colossal golem:    24x24 (golem)
  - 1 elite warden:      28x26 (22x22 knight inside safe walk/swing canvas)
  - 1 floor boss:        32x32 (boss - Crimson Lich King)

Outputs:
  - public/assets/dungeon/monsters_atlas.png
  - public/assets/dungeon/monsters_atlas.json (180 frames: 15 x {idle,run,attack}_0..3)
  - .../scratch/monsters_atlas_preview.png (3x zoomed QA inspection grid)
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DUNGEON_DIR = ROOT / "public" / "assets" / "dungeon"
OUT_PNG = DUNGEON_DIR / "monsters_atlas.png"
OUT_JSON = DUNGEON_DIR / "monsters_atlas.json"

SCRATCH_PREVIEW = Path(
    "/Users/Samer/.gemini/antigravity/brain/681e0dd1-392e-45a9-b08c-5ca9e857fe94/scratch/monsters_atlas_preview.png"
)


def _hex(h: str) -> tuple[int, int, int, int]:
    s = h.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


PAL: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "#": _hex("#161224"),  # deep indigo-plum outline
    "s": _hex("#2c3552"),  # dark slate / steel / basalt shadow
    "S": _hex("#566a89"),  # mid steel / stone
    "l": _hex("#93adc2"),  # light steel / ice shadow / fur mid
    "i": _hex("#cde9f6"),  # bright steel specular / frost fur
    "w": _hex("#f4f6ea"),  # warm bone white / highlight
    "b": _hex("#cfb694"),  # warm ivory horn / skull / stalk
    "u": _hex("#4a272a"),  # dark umber / leather shadow
    "m": _hex("#894c37"),  # oak / brown bull / chest
    "k": _hex("#c47e52"),  # light oak / leather highlight
    "r": _hex("#661b34"),  # deep crimson / wine shadow
    "R": _hex("#b32d3c"),  # crimson midtone
    "f": _hex("#ea5338"),  # scarlet / ember highlight
    "o": _hex("#b85d22"),  # bronze / amber / lava mid
    "g": _hex("#f3a629"),  # warm gold / magma glow
    "y": _hex("#fef074"),  # bright gold / eye / molten core
    "e": _hex("#1a5248"),  # deep blue-green shadow
    "E": _hex("#2f9452"),  # emerald midtone
    "a": _hex("#6cd94e"),  # acid green / goblin / emerald glow
    "L": _hex("#9cf05a"),  # bright lime gel highlight
    "c": _hex("#1d7a8c"),  # deep cyan / teal cap mid
    "C": _hex("#46e8f2"),  # glowing cyan / bioluminescence
    "d": _hex("#2c2266"),  # deep indigo cloth / gill shadow
    "D": _hex("#414896"),  # cobalt cloth mid
    "p": _hex("#7a3b8c"),  # mystic plum / imp / tongue shadow
    "P": _hex("#c86bd6"),  # bright orchid orb / tongue
    "q": _hex("#ff99b8"),  # bright pink glint
}


def make_canvas(w: int, h: int) -> Image.Image:
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def paint_grid(
    img: Image.Image,
    rows: list[str],
    ox: int = 0,
    oy: int = 0,
    w_check: int | None = None,
    remap: dict[str, str] | None = None,
) -> Image.Image:
    """Paint explicit character grid rows onto `img` with optional offset/remap."""
    if w_check is not None:
        assert all(len(r) == w_check for r in rows), (
            f"Expected width {w_check}, got {[len(r) for r in rows]}"
        )
    w, h = img.size
    px = img.load()
    for y, row in enumerate(rows):
        ty = oy + y
        if not (0 <= ty < h):
            continue
        for x, raw_ch in enumerate(row):
            tx = ox + x
            if not (0 <= tx < w):
                continue
            ch = remap.get(raw_ch, raw_ch) if remap else raw_ch
            rgba = PAL[ch]
            if rgba[3] > 0:
                px[tx, ty] = rgba
    return img


def from_grid(
    rows: list[str],
    w: int | None = None,
    h: int | None = None,
    ox: int = 0,
    oy: int = 0,
    remap: dict[str, str] | None = None,
) -> Image.Image:
    gw = w if w is not None else len(rows[0])
    gh = h if h is not None else len(rows)
    return paint_grid(make_canvas(gw, gh), rows, ox=ox, oy=oy, w_check=len(rows[0]), remap=remap)


def shift_img(img: Image.Image, dx: int = 0, dy: int = 0) -> Image.Image:
    out = make_canvas(*img.size)
    out.alpha_composite(img, (dx, dy))
    return out


def recolor_img(img: Image.Image, mapping: dict[str, str]) -> Image.Image:
    out = img.copy()
    px = out.load()
    lut = {PAL[k]: PAL[v] for k, v in mapping.items()}
    w, h = out.size
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c in lut:
                px[x, y] = lut[c]
    return out


def set_px(img: Image.Image, pts: list[tuple[int, int, str]]) -> Image.Image:
    w, h = img.size
    px = img.load()
    for x, y, ch in pts:
        if 0 <= x < w and 0 <= y < h:
            px[x, y] = PAL[ch]
    return img


def layer_stack(w: int, h: int, layers: list[Image.Image]) -> Image.Image:
    out = make_canvas(w, h)
    for lay in layers:
        out.alpha_composite(lay)
    return out


# ===========================================================================
# 1. EMERALD SLIME (16x16)
# ===========================================================================

SLIME_FRAMES_16 = [
    # 0: Squashed wide-low
    [
        "................",
        "................",
        "................",
        "................",
        "....########....",
        "..##LLLLaaaa##..",
        ".#LLwLaaaaaaaE#.",
        ".#LaaaaaaaaaaE#.",
        "#Laa##aaaa##aaE#",
        "#aaa#y#aa#y#aaE#",
        "#Eaa#w#aa#w#aEE#",
        "#EEaaaaaaaaaaEE#",
        ".#eEEEEaaEEeEE#.",
        "..#eeeeEEeeee#..",
        "...##########...",
        "................",
    ],
    # 1: Neutral dome
    [
        "................",
        "................",
        ".....######.....",
        "...##LLaaaa##...",
        "..#LLwLaaaaaa#..",
        "..#LaaaaaaaaaE#.",
        ".#LaaaaaaaaaaEE#",
        ".#aa##aaaa##aaE#",
        ".#aa#y#aa#y#aEE#",
        ".#Ea#w#aa#w#aEE#",
        ".#EEaaaaaaaaEE#.",
        ".#eEEEEEEEEEee#.",
        "..#eeeeeeeeee#..",
        "...##########...",
        "................",
        "................",
    ],
    # 2: Stretched high hop
    [
        ".....######.....",
        "....#LLaaaa#....",
        "...#LwLaaaaa#...",
        "...#LaaaaaaaE#..",
        "...#aa##a##aE#..",
        "...#aa#y##y#E#..",
        "...#Ea#w##w#E#..",
        "...#EEaaaaaEE#..",
        "...#eEEEEEEEe#..",
        "....#eeeeeeE#...",
        "....#eeeeee#....",
        ".....######.....",
        "................",
        "................",
        "................",
        "................",
    ],
    # 3: Landing settle
    [
        "................",
        "................",
        "................",
        "....########....",
        "...#LLaaaaaa#...",
        "..#LwLaaaaaaa#..",
        "..#LaaaaaaaaE#..",
        ".#aa##aaaa##aa#.",
        ".#aa#y#aa#y#aE#.",
        ".#Ea#w#aa#w#aE#.",
        ".#EEaaaaaaaaEE#.",
        ".#eeEEEEEEEeee#.",
        "..#eeeeeeeeee#..",
        "...##########...",
        "................",
        "................",
    ],
]


def anim_slime() -> dict[str, list[Image.Image]]:
    s0, s1, s2, s3 = [from_grid(g) for g in SLIME_FRAMES_16]
    # Idle: subtle breath bounce without full leap
    idle = [s1, s3, s0, s3]
    # Run: full lively hop cycle
    run = [s0, s1, s2, s3]
    # Attack: crouch charge (glowing eyes/gel) -> rapid forward pounce -> slam -> recover
    a0 = recolor_img(s0, {"y": "w", "a": "L"})
    a1 = shift_img(recolor_img(s2, {"E": "a", "y": "w"}), dx=1, dy=-1)
    a2 = set_px(recolor_img(s0, {"y": "g", "L": "w"}), [(1, 10, "L"), (14, 10, "L")])
    a3 = s3
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, a3]}


# ===========================================================================
# 2. CULTIST MAGE (16x16)
# ===========================================================================

MAGE_GRID_16 = [
    ".....####...###.",
    "....#dDDp#.#wPP#",
    "...#dDDDp#.#PPp#",
    "..#ddDDD##.#ggo#",
    "..#d#####d#.#k#.",
    "..#d#qP#P##.#m#.",
    "..#d#####d#.#k#.",
    "...#dDDpD###bm#.",
    "..#dDDDDD#DDDk#.",
    ".#dDDgggggD##m#.",
    ".#dD#gDDdD#.#k#.",
    "..##dDDdDD#.#m#.",
    "..#dDDdDDD#.#k#.",
    "..#dppddpd#.#m#.",
    "..##um##mu#..#..",
    "....##..##......",
]


def anim_mage() -> dict[str, list[Image.Image]]:
    base = from_grid(MAGE_GRID_16)
    # Pulse orb highlight between q/w/P cleanly on frame 1 & 2
    pulse = set_px(base.copy(), [(12, 1, "q"), (14, 1, "w"), (13, 2, "q")])
    bob_up = shift_img(base, dy=-1)
    idle = [base, pulse, shift_img(pulse, dy=-1), bob_up]

    # Run: alternating shuffling robe hem & feet
    r0 = set_px(base.copy(), [(3, 14, "u"), (4, 15, "#"), (5, 15, "#"), (8, 14, "."), (9, 14, ".")])
    r1 = shift_img(base, dy=-1)
    r2 = set_px(base.copy(), [(4, 15, "."), (5, 15, "."), (10, 14, "u"), (9, 15, "#"), (10, 15, "#")])
    r3 = shift_img(pulse, dy=-1)
    run = [r0, r1, r2, r3]

    # Attack: staff thrust up/forward with bright arcane violet-white sparkles
    atk_lift = base.copy()
    # Raise orb 1px higher and add magic sparkles around tip (cols 10..15, rows 0..4)
    a0 = set_px(shift_img(recolor_img(base, {"P": "q", "q": "w"}), dy=0), [(11, 0, "P"), (15, 0, "w")])
    a1 = set_px(
        shift_img(recolor_img(base, {"P": "q"}), dy=-1),
        [(10, 1, "w"), (11, 0, "P"), (15, 3, "w"), (15, 1, "q"), (12, 0, "q")],
    )
    a2 = set_px(
        recolor_img(base, {"p": "P", "P": "w"}),
        [(10, 2, "P"), (11, 0, "w"), (15, 0, "q"), (15, 3, "P")],
    )
    a3 = pulse
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, a3]}


# ===========================================================================
# 3. HORNED BRUTE (20x20)
# ===========================================================================

BRUTE_GRID_20 = [
    "...#............#...",
    "..#w#..........#b#..",
    "..#bw#..####..#wb#..",
    "...#bw##RffR##wb#...",
    "....###RffffR###....",
    "..###.#R#yy#R#.###..",
    ".#ilS##Rw##wR##lSs#.",
    "#sSSS#####R###sSSSs#",
    "#sSSs#RffRfRR#sSSSs#",
    ".####RfRRRRRRf####..",
    ".#ff##RRRRRRR##Rf#..",
    "#fRR#ummgmmmgu#RRr#.",
    "#Rrr##mmgmmmgu#rrs#.",
    "#sSs#.########.#sS#.",
    ".###..#RR##RR#..##..",
    "......#Rr##Rr#......",
    ".....#sS#..#Ss#.....",
    "....#sSS#..#SSs#....",
    "....#####..#####....",
    "....................",
]


def anim_brute() -> dict[str, list[Image.Image]]:
    base = from_grid(BRUTE_GRID_20)
    down1 = shift_img(base, dy=1)
    # Idle: heavy breathing shoulder drop + glaring eye glint
    glint = set_px(base.copy(), [(9, 5, "w"), (11, 5, "w")])
    idle = [base, down1, shift_img(glint, dy=1), glint]

    # Run: stomping war boots alternating left/right
    l_step = set_px(
        base.copy(),
        [(4, 18, "."), (4, 17, "#"), (3, 18, "#"), (3, 19, "#"), (4, 19, "S"), (5, 19, "S"), (13, 17, "s"), (13, 18, "#")],
    )
    r_step = set_px(
        base.copy(),
        [(15, 19, "#"), (14, 19, "S"), (13, 19, "s"), (5, 17, "s"), (5, 18, "#"), (6, 18, "#")],
    )
    run = [l_step, shift_img(base, dy=-1), r_step, shift_img(base, dy=-1)]

    # Attack: crouched horn windup -> raised arms forward punch -> slam spark -> recover
    a0 = shift_img(glint, dy=1)
    a1 = set_px(
        shift_img(recolor_img(base, {"y": "w"}), dy=-1),
        [(0, 9, "#"), (0, 10, "f"), (1, 10, "f"), (18, 9, "#"), (19, 10, "R")],
    )
    a2 = set_px(
        down1.copy(),
        [(0, 13, "y"), (1, 12, "w"), (18, 12, "y"), (19, 13, "f")],
    )
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# 4. ARMORED WARDEN (28x26 safe canvas housing 22x22 knight)
# ===========================================================================

WARDEN_TORSO_22 = [
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......###...###.......",
    ".....#iSS###SSs#......",
    "....#sSSSSSSSSSs#.....",
    "....#sSlSSSSSSss#.....",
    ".....###sSSSSs###.....",
    ".......#sSSSSs#.......",
    ".......#slllSs#.......",
    ".......#oggggo#.......",
    "......#sSSggSSs#......",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
]

WARDEN_HEAD_22 = [
    "...##............##...",
    "..#w#............#l#..",
    "..#lw#..######..#Sl#..",
    "...#lS##slllSs##Ss#...",
    "....###sSSSSSSs###....",
    "......#sggggggs#......",
    "......#s#y##y#s#......",
    "......#ss#ss#ss#......",
    ".......########.......",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
]

WARDEN_SHIELD_22 = [
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "..............#######.",
    ".............#ggggggo#",
    ".............#gSSSSSo#",
    ".............#gSlggSo#",
    ".............#gSgylSo#",
    ".............#gSggggo#",
    ".............#gSSggSo#",
    ".............#gSSggSo#",
    "..............#gSSgo#.",
    "...............#ggo#..",
    "................#o#...",
    ".................#....",
    "......................",
]

WARDEN_LEGS_22 = {
    "idle": [
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......#sSs..#sSs......",
        "......#sSs..#sSs......",
        "......#sSS..#SSs......",
        ".....#sSSs..#sSSs.....",
        ".....#lSS#..#SSl#.....",
        ".....#####..#####.....",
        "......................",
    ],
    "contact_a": [
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......#sSs...#sSs.....",
        ".....#lSS#...#sSs#....",
        ".....#iSS#....#SSs#...",
        ".....#lSS#....#####...",
        ".....#####............",
        "......................",
        "......................",
    ],
    "passing": [
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        ".......#sSs.#sSs......",
        ".......#sSs.#sSs......",
        ".......#lSS.#SSs......",
        ".......####.####......",
        "......................",
        "......................",
        "......................",
    ],
    "contact_b": [
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        ".......#sSs.#sSs......",
        "......#sSs#.#sSS#.....",
        ".....#sSS#...#SSi#....",
        ".....####....#SSl#....",
        ".............#####....",
        "......................",
        "......................",
    ],
}


def build_warden_frame(
    leg_pose: str = "idle",
    torso_dy: int = 0,
    head_dy: int = 0,
    shield_dx: int = 0,
    shield_dy: int = 0,
    weapon_mode: str = "idle",
) -> Image.Image:
    w, h, ox, oy = 28, 26, 3, 2
    legs = from_grid(WARDEN_LEGS_22[leg_pose], w=w, h=h, ox=ox, oy=oy)
    weapon = make_canvas(w, h)
    if weapon_mode == "idle":
        paint_grid(weapon, [".#w#..", "#iSi#.", ".#s##.", "..#k#.", "..#m#.", "..#u#."], ox=ox, oy=oy + 5 + torso_dy)
        paint_grid(weapon, ["#sSs#", "#lSS#"], ox=ox + 1, oy=oy + 11 + torso_dy)
    elif weapon_mode == "windup":
        paint_grid(weapon, ["#w#...", "#iSi#.", ".#s##.", "..#k#.", "...#m#"], ox=ox - 2, oy=oy + 2 + torso_dy)
        paint_grid(weapon, ["#sSs#", "#lSS#"], ox=ox + 1, oy=oy + 8 + torso_dy)
    elif weapon_mode == "strike":
        paint_grid(weapon, ["..#u#.", "..#m#.", ".#k#..", "#iSi#.", ".#w#.."], ox=ox + 1, oy=oy + 12)
        paint_grid(weapon, ["#sSs#", "#lSS#"], ox=ox + 2, oy=oy + 11)
        paint_grid(weapon, [".w....", "iw....", "Ciw...", ".CCiw.", "...CCw"], ox=ox - 2, oy=oy + 6)
    elif weapon_mode == "impact":
        paint_grid(weapon, ["..#u#.", ".#k#..", "#iSi#.", "#wSw#.", ".#s#.."], ox=ox - 1, oy=oy + 15)
        paint_grid(weapon, ["#sSs#"], ox=ox + 1, oy=oy + 13)
        paint_grid(weapon, ["y.w", ".y."], ox=ox - 2, oy=oy + 17)
    elif weapon_mode == "recover":
        paint_grid(weapon, [".#w#..", "#iSi#.", ".#s##.", "..#k#.", "..#m#."], ox=ox, oy=oy + 7 + torso_dy)
        paint_grid(weapon, ["#sSs#", "#lSS#"], ox=ox + 1, oy=oy + 12 + torso_dy)

    torso = from_grid(WARDEN_TORSO_22, w=w, h=h, ox=ox, oy=oy + torso_dy)
    head = from_grid(WARDEN_HEAD_22, w=w, h=h, ox=ox, oy=oy + head_dy)
    shield = from_grid(WARDEN_SHIELD_22, w=w, h=h, ox=ox + shield_dx, oy=oy + shield_dy)
    return layer_stack(w, h, [legs, weapon, torso, head, shield])


def anim_warden() -> dict[str, list[Image.Image]]:
    idle = [
        build_warden_frame("idle", 0, 0, 0, 0, "idle"),
        build_warden_frame("idle", 1, 0, 0, 1, "idle"),
        build_warden_frame("idle", 1, 1, 0, 1, "idle"),
        build_warden_frame("idle", 0, 1, 0, 0, "idle"),
    ]
    run = [
        build_warden_frame("contact_a", 0, 0, 0, 0, "idle"),
        build_warden_frame("passing", -1, 0, 0, -1, "idle"),
        build_warden_frame("contact_b", 0, -1, 0, 0, "idle"),
        build_warden_frame("passing", -1, 0, 0, -1, "idle"),
    ]
    attack = [
        build_warden_frame("idle", -1, 0, 0, 0, "windup"),
        build_warden_frame("contact_a", 0, 0, -1, 1, "strike"),
        build_warden_frame("contact_a", 1, 1, -1, 1, "impact"),
        build_warden_frame("passing", 0, 0, 0, 0, "recover"),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 5. CRYPT SHADE (16x16)
# ===========================================================================

SHADE_GRID_16 = [
    ".....#####......",
    "....#dDpDD#.....",
    "...#dDDDDd#.....",
    "..#d######d#....",
    "..#d#wC#wC##....",
    "..#d######d#....",
    "..#dDDDDDDd#....",
    ".#dd#DDDD#dd#...",
    "#Ccd#DDDD#dcC#..",
    ".###dDDdDd###...",
    "...#dDDdDd#.....",
    "...#d#DdD#d#....",
    "....##dDd##.....",
    "...#CcdDd#......",
    "..#Ccdd###......",
    "...####.........",
]


def anim_shade() -> dict[str, list[Image.Image]]:
    base = from_grid(SHADE_GRID_16)
    tail_r = set_px(
        shift_img(base, dy=-1),
        [(2, 13, "."), (3, 13, "."), (4, 14, "#"), (5, 13, "C"), (6, 13, "c"), (7, 13, "d"), (8, 12, "d")],
    )
    idle = [base, shift_img(base, dy=-1), tail_r, set_px(base.copy(), [(5, 4, "C"), (9, 4, "C")])]

    glide = shift_img(recolor_img(tail_r, {"c": "C"}), dx=1, dy=-1)
    run = [base, glide, shift_img(base, dy=-1), recolor_img(base, {"c": "C"})]

    # Attack: glowing violet-cyan eyes + flaring outstretched spectral claws
    a0 = recolor_img(base, {"D": "p", "w": "C"})
    a1 = set_px(
        shift_img(recolor_img(base, {"D": "P", "d": "p", "c": "w"}), dy=-1),
        [(0, 6, "w"), (0, 7, "C"), (14, 6, "w"), (15, 7, "C")],
    )
    a2 = set_px(recolor_img(base, {"c": "w", "w": "y"}), [(1, 8, "C"), (13, 8, "C")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# 6. FROST YETI (22x22)
# ===========================================================================

YETI_GRID_22 = [
    "...#.............#....",
    "..#wC#...####...#Ci#..",
    "..#Cc##.#wiiw#.##Cc#..",
    "...#c#l#iiwwii#l#c#...",
    "....###SlSSSSlS###....",
    "......#SC#ll#CS#......",
    "...###iSS####SSi###...",
    "..#wwiiSS#ww#SSiiil#..",
    ".#wiiiiiiiiiilliiill#.",
    "#iww#wiiiiiiil#ill#ll#",
    "#wwi#iiiiiiill#lll#lS#",
    "#iil#iiwlliiil#lll#SS#",
    "#lSl#llwllliil#sSS#sS#",
    "#CCc##lliiill##cSs#...",
    "#wCC##lllllll##Ci#....",
    ".####.#lillll#.##.....",
    "......#li##ll#........",
    "......#li##ll#........",
    ".....#SSl##lSS#.......",
    "....#CllS##SllC#......",
    "....#####..#####......",
    "......................",
]


def anim_yeti() -> dict[str, list[Image.Image]]:
    base = from_grid(YETI_GRID_22)
    idle = [
        base,
        shift_img(base, dy=1),
        set_px(shift_img(base, dy=1), [(8, 5, "w"), (13, 5, "w")]),
        base,
    ]
    # Run: stomping snow feet + swinging icy fists
    r0 = shift_img(recolor_img(base, {"C": "w"}), dy=-1)
    r1 = set_px(base.copy(), [(4, 19, "i"), (4, 20, "#"), (16, 18, "#"), (17, 19, ".")])
    r2 = set_px(base.copy(), [(17, 19, "i"), (17, 20, "#"), (5, 18, "#"), (4, 19, ".")])
    run = [r1, r0, r2, shift_img(base, dy=-1)]

    # Attack: roaring chest up -> ice fist slam with cyan/white frost sparkles
    a0 = shift_img(recolor_img(base, {"c": "C"}), dy=-1)
    a1 = set_px(
        shift_img(recolor_img(base, {"C": "w", "c": "C"}), dy=1),
        [(0, 15, "C"), (1, 16, "w"), (2, 16, "C"), (18, 15, "C"), (19, 16, "w")],
    )
    a2 = set_px(recolor_img(base, {"c": "C"}), [(2, 17, "w"), (17, 17, "C")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# 7. ALLEY SAPPER (16x16)
# ===========================================================================

SAPPER_GRID_16 = [
    "....#####....#y#",
    "...#ukmmk#..#yfy",
    "..#ukmmmm#.#k#.#",
    ".##mm####m##Sl#.",
    "#aEa#LLLLa##SSs#",
    ".##a#yLa#y##sSs#",
    "...##aLLaa###s#.",
    "...#a#w#w##E#...",
    "...#umkmmm#.....",
    "..#a#mmgmm#.....",
    "..#E#mmmmm#.....",
    "...##umumu#.....",
    "...#um#.#mu#....",
    "...#sS#.#Ss#....",
    "...###...###....",
    "................",
]


def anim_sapper() -> dict[str, list[Image.Image]]:
    base = from_grid(SAPPER_GRID_16)
    s_spark1 = set_px(base.copy(), [(14, 0, "f"), (15, 0, "w"), (13, 1, "y"), (14, 1, "w"), (15, 1, "g")])
    s_spark2 = set_px(shift_img(base, dy=1), [(14, 1, "w"), (15, 0, "f"), (13, 2, "f"), (15, 2, "y")])
    idle = [base, s_spark1, s_spark2, base]

    r0 = shift_img(s_spark1, dy=-1)
    r1 = set_px(base.copy(), [(4, 14, "#"), (4, 15, "#"), (5, 15, "S"), (10, 13, "#")])
    r2 = set_px(s_spark1.copy(), [(10, 14, "#"), (10, 15, "#"), (11, 15, "S"), (4, 13, "#")])
    run = [r1, r0, r2, shift_img(base, dy=-1)]

    # Attack: hoisting bomb up higher with roaring flame spark
    a0 = shift_img(s_spark1, dy=1)
    a1 = set_px(
        shift_img(recolor_img(base, {"y": "w", "f": "y"}), dy=-1),
        [(13, 0, "w"), (14, 0, "f"), (15, 0, "w"), (12, 1, "y")],
    )
    a2 = set_px(base.copy(), [(12, 2, "y"), (14, 0, "w"), (15, 2, "f")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, s_spark1]}


# ===========================================================================
# 8. MORTAR TANK (22x22)
# ===========================================================================

TANK_GRID_22 = [
    "................###...",
    "...............#gyg#..",
    "..............#g#g#g#.",
    ".............#ilSSgo#.",
    "............#ilSSSSg#.",
    ".......####ilSSss##...",
    ".....##gggglSSs#......",
    "....#gggggg###S#......",
    "...#oggggggg#s#.......",
    "...##########s#.......",
    "..#lllllllllSSs#......",
    ".#oggoSSffSSSSSs#.....",
    ".#gmmgSSffSSSSSs#.....",
    ".#oooosssssssssss#....",
    ".#################....",
    "#ssSSssSSssSSssSSs#...",
    "#s#gg#s#gg#s#gg#ss#...",
    "#ssgosssgosssgosss#...",
    ".#################....",
    "......................",
    "......................",
    "......................",
]


def anim_tank() -> dict[str, list[Image.Image]]:
    base = from_grid(TANK_GRID_22)
    # Tread cycling + glowing red sensor
    t_b = set_px(
        recolor_img(base, {"f": "y"}),
        [(2, 15, "S"), (3, 15, "s"), (7, 15, "S"), (8, 15, "s"), (12, 15, "S"), (13, 15, "s"), (17, 15, "S")],
    )
    hum = set_px(shift_img(base, dy=-1), [(8, 10, "y"), (9, 10, "y")])
    idle = [base, t_b, set_px(base.copy(), [(8, 11, "y"), (9, 11, "y")]), base]
    run = [base, shift_img(t_b, dy=-1), t_b, hum]

    # Attack: barrel recoil down-left + blazing orange/gold/white mortar blast!
    recoil = shift_img(base, dx=-1, dy=1)
    blast1 = set_px(
        recoil.copy(),
        [(16, 0, "g"), (17, 0, "y"), (18, 0, "w"), (18, 1, "w"), (19, 1, "y"), (19, 2, "f"), (20, 2, "g"), (17, 2, "w")],
    )
    blast2 = set_px(
        base.copy(),
        [(17, 0, "f"), (19, 0, "y"), (20, 1, "w"), (20, 2, "f"), (18, 1, "g"), (19, 2, "y")],
    )
    return {"idle": idle, "run": run, "attack": [recolor_img(base, {"f": "y"}), blast1, blast2, base]}


# ===========================================================================
# 9. STAMPEDE BULL (22x22)
# ===========================================================================

BULL_GRID_22 = [
    "....#...........#.....",
    "...#w#.........#b#....",
    "...#bw#..###..#wb#....",
    ".###.#b##kmmk##b#.....",
    "#bm#..#bmmmmmmb#......",
    ".###mmmmmmmmmmm#......",
    "...#mkkkkmmkmmmmmu#...",
    "..#mmkmmmmm#mmmmmm#...",
    ".#ummmmmm##m#f#m#f#...",
    ".#ummsumm#sSSssSSs#w..",
    ".#ummsumm#s#sss#s#iw..",
    "..#umummu##gggggs#....",
    "..#um##mmu#g####g#....",
    "..#um##mm#.#ggg#......",
    "..#um#.#u##..#........",
    "..#sS#.#Ss#...........",
    "..####.####...........",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
]


def anim_bull() -> dict[str, list[Image.Image]]:
    base = from_grid(BULL_GRID_22)
    steam2 = set_px(shift_img(base, dy=1), [(19, 9, "w"), (20, 9, "i"), (21, 8, "w")])
    idle = [base, shift_img(base, dy=1), steam2, base]

    # Run: dynamic galloping stride & snort steam
    g1 = set_px(shift_img(base, dy=-1), [(1, 14, "#"), (1, 15, "S"), (2, 15, "s"), (8, 14, "u")])
    g2 = set_px(base.copy(), [(9, 15, "m"), (9, 16, "#"), (10, 16, "S"), (11, 16, "#")])
    run = [g1, shift_img(base, dy=-1), g2, steam2]

    # Attack: furious glowing eyes + lowered charging bull lunge forward-right + big steam flare
    a0 = recolor_img(shift_img(base, dx=-1, dy=1), {"f": "y"})
    a1 = set_px(
        shift_img(recolor_img(base, {"f": "y"}), dx=1, dy=0),
        [(20, 8, "w"), (21, 8, "i"), (21, 9, "w"), (21, 11, "i")],
    )
    a2 = set_px(shift_img(base, dx=1, dy=1), [(20, 10, "i"), (21, 9, "w")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# 10. CRIMSON LICH KING BOSS (32x32)
# ===========================================================================

BOSS_CAPE_32 = [
    [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        ".......####.....................",
        "......#rRRR#....................",
        ".....#rfRRR#....................",
        "....#rffRRRR#...................",
        "...#rfRRRRRRr#..................",
        "..#rffRRRRRRrr#.................",
        "..#rfRRRRRRRrrr#................",
        ".#rffRRRRRRRrrr#................",
        ".#rfRRRRRRRRrrr#................",
        ".#rRRRRRRRRRrrr#................",
        "..#rRRRRRRRrrrr#................",
        "..#rRRRrrRRrrr#.................",
        "..#rr#rR#rrrr#..................",
        "...#...#..###...................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
    ],
    [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        ".......####.....................",
        "......#rRRR#....................",
        ".....#rfRRR#....................",
        "....#rffRRRR#...................",
        "...#rfRRRRRRr#..................",
        "..#rffRRRRRRrr#.................",
        ".#rffRRRRRRRrrr#................",
        "#rffRRRRRRRRrrr#................",
        "#rfRRRRRRRRRrrr#................",
        ".#rRRRRRRRRRrrr#................",
        ".#rrRRRRRRRrrrr#................",
        "..#rRRRrrRRrrr#.................",
        "...#rr#rR#rrr#..................",
        "....#..#..##....................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
    ],
    [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        ".......####.....................",
        "......#rRRR#....................",
        ".....#rfRRR#....................",
        "....#rffRRRR#...................",
        "...#rfRRRRRRr#..................",
        "..#rffRRRRRRrr#.................",
        ".#rfRRRRRRRRrrr#................",
        ".#rfRRRRRRRRrrr#................",
        "#rfRRRRRRRRRrrr#................",
        "#rRRRRRRRRRRrrr#................",
        ".#rRRRRRRRRrrrr#................",
        "..#rrRRrrRRrrr#.................",
        "..#r##rR##rrrr#.................",
        "......##...##...................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
    ],
    [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        ".......####.....................",
        "......#rRRR#....................",
        ".....#rfRRR#....................",
        "....#rffRRRR#...................",
        "...#rfRRRRRRr#..................",
        "..#rffRRRRRRrr#.................",
        "..#rfRRRRRRRrrr#................",
        ".#rffRRRRRRRrrr#................",
        ".#rfRRRRRRRRrrr#................",
        "..#rfRRRRRRRrrr#................",
        "..#rRRRRRRRrrrr#................",
        "..#rRRRrrRRrrr#.................",
        "...#rr#rR#rrr#..................",
        "....#..#..##....................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
    ],
]

BOSS_LEGS_32 = {
    "idle": [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "..........####....####..........",
        ".........#sSSs#..#sSSs#.........",
        ".........#sSSs#..#sSSs#.........",
        ".........#slSs#..#sSls#.........",
        ".........#sSSs#..#sSSs#.........",
        "........#sSSSs#..#sSSSs#........",
        "........#######..#######........",
        "................................",
        "................................",
        "................................",
        "................................",
    ],
    "step_l": [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        ".........#####....####..........",
        "........#sSSs#....#sSSs#........",
        "........#slSs#....#sSSs#........",
        "........#sSSs#.....#####........",
        ".......#sSSSs#..................",
        ".......#######..................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
    ],
    "step_r": [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "..........####....#####.........",
        ".........#sSSs#...#sSSs#........",
        ".........#sSSs#...#sSls#........",
        "..........#####...#sSSs#........",
        "..................#sSSSs#.......",
        "..................#######.......",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
    ],
}

BOSS_TORSO_32 = [
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    ".....#..................#.......",
    "....#l#................#S#......",
    "....#sg###..######..###gs#......",
    "...#sSSss#.#RffffR#.#ssSSs#.....",
    "...#sSSss#.#RffRRf#.#ssSSs#.....",
    "....######.#RfRRRf#.######......",
    ".........#RffRRRRRr#............",
    ".........#RffRRrRRr#............",
    ".........#RffRRrRRr#............",
    ".........#ogggggggo#............",
    ".........#ogggygggo#............",
    "..........#rRRRRRr#.............",
    "..........#rrRRRrr#.............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
]

BOSS_HEAD_32 = [
    "................................",
    "........#......#.#.#...#........",
    ".......#i#....#y#y#y#.#l#.......",
    "......#sl#....#ggggg#.#Ss#......",
    "......#ss###..#ggggg###ss#......",
    ".......#s###RffffffR###s#.......",
    ".........##RfffRRfffR##.........",
    "..........#Rf#y#R#y#R#..........",
    "..........#RRffffffRR#..........",
    "..........#r#w#w#w#Rr#..........",
    "...........##########...........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
]

BOSS_SWORD_32 = [
    [
        ".........................#......",
        "........................#y#.....",
        ".......................#fyf#....",
        ".......................#gwg#....",
        "......................#fgwgf#...",
        ".......................#gwg#....",
        ".......................#gwg#....",
        "......................#fgwg#....",
        ".......................#gwgf#...",
        ".......................#gwg#....",
        "......................#fgwg#....",
        "......................#gwgf#....",
        ".......................#gyg#....",
        ".....................#R#gyg#....",
        "....................#Rf#ggg#....",
        "...................#Rffggggg#...",
        "...................#RR#ggggg#...",
        "....................##..#o#.....",
        "........................#g#.....",
        ".......................#ygy#....",
        "........................###.....",
    ],
    [
        ".........................#......",
        "........................#f#.....",
        ".......................#gyg#....",
        "......................#fgwgf#...",
        ".......................#gwg#....",
        ".......................#gwgf#...",
        "......................#fgwg#....",
        ".......................#gwg#....",
        ".......................#gygf#...",
        "......................#fgwg#....",
        ".......................#gwgf#...",
        ".......................#gwg#....",
        "......................#fgyg#....",
        ".....................#R#gyg#....",
        "....................#Rf#ggg#....",
        "...................#Rffggggg#...",
        "...................#RR#ggggg#...",
        "....................##..#o#.....",
        "........................#g#.....",
        ".......................#ygy#....",
        "........................###.....",
    ],
    [
        "........................#.......",
        ".......................#y#......",
        ".......................#gwg#....",
        ".......................#gwgf#...",
        "......................#fgwg#....",
        ".......................#gwg#....",
        ".......................#gwgf#...",
        "......................#fgwg#....",
        ".......................#gwg#....",
        ".......................#gygf#...",
        "......................#fgwg#....",
        ".......................#gyg#....",
        "......................#fgygf#...",
        ".....................#R#gyg#....",
        "....................#Rf#ggg#....",
        "...................#Rffggggg#...",
        "...................#RR#ggggg#...",
        "....................##..#o#.....",
        "........................#g#.....",
        ".......................#ygy#....",
        "........................###.....",
    ],
    [
        ".........................#......",
        "........................#g#.....",
        ".......................#fyf#....",
        ".......................#gwg#....",
        ".......................#gwgf#...",
        "......................#fgwg#....",
        ".......................#gwg#....",
        ".......................#gygf#...",
        "......................#fgwg#....",
        ".......................#gwg#....",
        ".......................#gwgf#...",
        "......................#fgwg#....",
        ".......................#gyg#....",
        ".....................#R#gyg#....",
        "....................#Rf#ggg#....",
        "...................#Rffggggg#...",
        "...................#RR#ggggg#...",
        "....................##..#o#.....",
        "........................#g#.....",
        ".......................#ygy#....",
        "........................###.....",
    ],
]


def build_boss_frame(cape_idx: int, leg_pose: str, torso_dy: int, head_dy: int, sword_idx: int) -> Image.Image:
    cape = from_grid(BOSS_CAPE_32[cape_idx], w=32, h=32, oy=torso_dy)
    legs = from_grid(BOSS_LEGS_32[leg_pose], w=32, h=32)
    torso = from_grid(BOSS_TORSO_32, w=32, h=32, oy=torso_dy)
    head = from_grid(BOSS_HEAD_32, w=32, h=32, oy=head_dy)
    sword = from_grid(BOSS_SWORD_32[sword_idx], w=32, h=32, oy=2 + torso_dy)
    return layer_stack(32, 32, [cape, legs, torso, head, sword])


def anim_boss() -> dict[str, list[Image.Image]]:
    idle = [
        build_boss_frame(0, "idle", 0, 0, 0),
        build_boss_frame(1, "idle", 1, 0, 1),
        build_boss_frame(2, "idle", 1, 1, 2),
        build_boss_frame(3, "idle", 0, 1, 3),
    ]
    run = [
        build_boss_frame(1, "step_l", -1, 0, 1),
        build_boss_frame(2, "idle", 0, -1, 2),
        build_boss_frame(3, "step_r", -1, 0, 3),
        build_boss_frame(0, "idle", 0, 0, 0),
    ]
    # Attack: greatsword lifted up-right -> sweeping blazing golden-white diagonal cleave! -> recover
    a0 = shift_img(build_boss_frame(1, "idle", -1, -1, 2), dy=0)
    # Draw wide fiery slash wave across right/bottom-front on frames 1 & 2
    a1_base = build_boss_frame(2, "step_l", 0, 0, 0)
    a1 = set_px(
        recolor_img(a1_base, {"R": "f", "f": "g"}),
        [
            (27, 8, "w"), (28, 9, "y"), (29, 10, "w"), (30, 12, "y"), (30, 14, "f"),
            (29, 16, "y"), (28, 18, "w"), (27, 20, "y"), (25, 22, "f"), (23, 24, "y"),
        ],
    )
    a2 = set_px(
        build_boss_frame(3, "step_r", 1, 1, 3),
        [(23, 25, "y"), (25, 26, "f"), (27, 24, "w"), (28, 22, "y"), (29, 20, "f")],
    )
    a3 = build_boss_frame(0, "idle", 0, 0, 1)
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, a3]}


# ===========================================================================
# 11. BONE ARCHER (16x16)
# ===========================================================================

ARCHER_GRID_16 = [
    ".##.#####.......",
    "#aa##ukmku#.....",
    ".#m##bwbbw###...",
    "..#m#b#a#a#k#...",
    "...##wbbb##.k#..",
    "...##bwbb#..l#k#",
    "...#u#wbw###l#m#",
    "..#u#w#w#b##aaL#",
    "..#b#bbbb##Laaw#",
    "...##b###b##k#a#",
    "....#bwb#...l#m#",
    "....#b#b#...k#..",
    "....#b#b#..#m#..",
    "...#u#.#u####...",
    "...###.###......",
    "................",
]


def anim_archer() -> dict[str, list[Image.Image]]:
    base = from_grid(ARCHER_GRID_16)
    glow = recolor_img(base, {"a": "L", "L": "w"})
    idle = [base, glow, shift_img(base, dy=1), base]

    r1 = set_px(base.copy(), [(3, 14, "#"), (3, 15, "#"), (4, 15, "u"), (8, 13, "#"), (8, 14, ".")])
    r2 = set_px(base.copy(), [(8, 14, "#"), (8, 15, "#"), (7, 15, "u"), (4, 13, "#"), (4, 14, ".")])
    run = [r1, shift_img(base, dy=-1), r2, shift_img(glow, dy=-1)]

    # Attack: bowstring pulled tense back -> bright emerald arrow flash release! -> reload
    a0 = set_px(recolor_img(base, {"a": "L"}), [(11, 5, "l"), (11, 6, "l"), (11, 9, "l"), (11, 10, "l"), (12, 5, "."), (12, 10, ".")])
    a1 = set_px(recolor_img(base, {"a": "w", "L": "w"}), [(15, 7, "w"), (15, 8, "w"), (14, 6, "L"), (14, 9, "L")])
    a2 = set_px(base.copy(), [(12, 7, "l"), (13, 7, "l"), (14, 7, "w"), (15, 7, "L"), (14, 8, "w")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# 12. PLAGUE IMP (16x16)
# ===========================================================================

IMP_GRID_16 = [
    "....#......#....",
    ".#..#w....#l..#.",
    "#p#.#p#..#p#.#r#",
    "#Pp##PP##Pp##rp#",
    "#rP#PqPPPppP#pr#",
    "#rp#P#aPP#aP#pr#",
    ".#r#pP####wP#r#.",
    "..##r#pppp##r#..",
    "...#rpPPPPpr#...",
    "..#P#prppprp#...",
    "..##.#r#r#.#P#..",
    ".#p#.#r#r#..#...",
    "#PqP##r.#r#.....",
    ".##..#p#.#p#....",
    ".....##...##....",
    "................",
]


def anim_imp() -> dict[str, list[Image.Image]]:
    base = from_grid(IMP_GRID_16)
    # Wing flap down (lower wings slightly) & hover up
    flap_up = set_px(
        shift_img(base, dy=-1),
        [(0, 1, "#"), (1, 1, "P"), (14, 1, "p"), (15, 1, "#")],
    )
    tail_flick = set_px(base.copy(), [(1, 10, "#"), (1, 11, "P"), (2, 11, "q"), (0, 12, ".")])
    idle = [base, flap_up, shift_img(tail_flick, dy=-1), tail_flick]
    run = [shift_img(base, dy=-1), flap_up, shift_img(base, dx=1, dy=-1), tail_flick]

    # Attack: glaring neon eyes + flared bat wings & forward lunging claw/bite
    a0 = recolor_img(base, {"a": "y", "P": "q"})
    a1 = set_px(
        shift_img(recolor_img(base, {"a": "w", "w": "y"}), dy=-1),
        [(0, 4, "q"), (15, 4, "q"), (2, 8, "P"), (13, 8, "q")],
    )
    a2 = set_px(recolor_img(base, {"p": "P"}), [(3, 9, "q"), (12, 9, "q")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# 13. CURSED MIMIC (16x16)
# ===========================================================================

MIMIC_GRID_16 = [
    "..###########...",
    ".#gkkkmmkmmmg#..",
    ".#gkmmmmmmkmg#..",
    ".#g#########g#..",
    ".#g#rf###fr##g#.",
    ".#w#w##w##w##r#.",
    ".###########P#..",
    ".#r##w###w#Ppq#.",
    ".#gmm#pPqp##mg#.",
    ".#gmm#pPqP#mmg#.",
    ".#gmm#g#Ppq#mg#.",
    ".#ummum##Ppqm#..",
    ".#gmmmum##Ppq#..",
    ".###########p#..",
    "............##..",
    "................",
]


def anim_mimic() -> dict[str, list[Image.Image]]:
    base = from_grid(MIMIC_GRID_16)
    # Lid chomp + tongue wiggle
    tongue_w = set_px(base.copy(), [(13, 13, "P"), (14, 12, "q"), (14, 14, "P")])
    chomp = set_px(
        base.copy(),
        [(2, 4, "k"), (3, 4, "m"), (4, 4, "m"), (11, 4, "m"), (2, 5, "#"), (11, 5, "#"), (4, 6, "w"), (8, 6, "w")],
    )
    idle = [base, tongue_w, shift_img(base, dy=1), chomp]
    run = [chomp, shift_img(base, dy=-1), shift_img(tongue_w, dy=-1), shift_img(base, dy=1)]

    # Attack: jaw snapped wide + blazing red eyes + lunging long violet tongue
    a0 = chomp
    a1 = set_px(
        shift_img(recolor_img(base, {"P": "q", "r": "f"}), dy=-1),
        [(13, 13, "q"), (14, 13, "w"), (14, 14, "q"), (15, 14, "P"), (14, 15, "p")],
    )
    a2 = set_px(recolor_img(base, {"p": "P"}), [(14, 14, "w"), (15, 13, "q")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# 14. MAGMA GOLEM (24x24)
# ===========================================================================

GOLEM_GRID_24 = [
    "........########........",
    ".......#lSllSSSS#.......",
    "......#sSS#y##y#s#......",
    "..#####sSs#fffffs#####..",
    ".#llSss#s########s#sSS#.",
    "#illSssSSfSSssSSfssSSSs#",
    "#SSSss#sSSgSSSSgss#sSSs#",
    "#SSsSs#ss#ffgfg#ss#ssSs#",
    "#ss#Ss#ss#s#y#s#ss#sSss#",
    "#sfgfs#ss##gfg##ss#sf#s#",
    "#sggfs#ss#sf#fs#ss#sffs#",
    "#ss#ss#ss#sf#fs#ss#ss#s#",
    ".#####.#ss#####ss#.####.",
    ".......#ss#...#ss#......",
    "......#ssS#...#Sss#.....",
    "......#sfs#...#sfs#.....",
    "......#slS#...#Sls#.....",
    ".....#ssSS#...#SSss#....",
    ".....######...######....",
    "........................",
    "........................",
    "........................",
    "........................",
    "........................",
]


def anim_golem() -> dict[str, list[Image.Image]]:
    base = from_grid(GOLEM_GRID_24)
    lava_bright = recolor_img(base, {"f": "g", "g": "y", "y": "w"})
    idle = [base, lava_bright, shift_img(lava_bright, dy=1), shift_img(base, dy=1)]

    # Run: earth-shaker stomp alternating legs
    l_stomp = set_px(shift_img(base, dy=-1), [(5, 18, "#"), (6, 18, "S"), (7, 18, "S"), (15, 17, "#"), (16, 18, ".")])
    r_stomp = set_px(shift_img(base, dy=-1), [(15, 18, "#"), (16, 18, "S"), (17, 18, "S"), (7, 17, "#"), (6, 18, ".")])
    run = [l_stomp, base, r_stomp, lava_bright]

    # Attack: blazing molten core + slamming fists with flying magma embers
    a0 = shift_img(lava_bright, dy=-1)
    a1 = set_px(
        shift_img(recolor_img(base, {"f": "y", "g": "w"}), dy=2),
        [(1, 13, "y"), (2, 14, "f"), (20, 14, "f"), (22, 13, "y"), (11, 13, "y"), (12, 13, "w")],
    )
    a2 = set_px(shift_img(lava_bright, dy=1), [(3, 14, "f"), (19, 14, "f")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# 15. SPORE MYCONID (16x16)
# ===========================================================================

MYCONID_GRID_16 = [
    "....########....",
    "..##cCCCcPpc##..",
    ".#cCCcPPpcCCCc#.",
    "#dCCcPpPpcCCppd#",
    "#dcCCCCCCcCCpPd#",
    "#dddCCCCCCcdddd#",
    ".#dddpddddpddd#.",
    "..#dd#wC##wC#d#.",
    "..####d####d###.",
    "....#wwwwwbb#...",
    "...#b#wwwww#b#..",
    "...##.bwwwb.##..",
    ".....#bw#wb#....",
    ".....#bw#wb#....",
    "....#m#..#m#....",
    "....###..###....",
]


def anim_myconid() -> dict[str, list[Image.Image]]:
    base = from_grid(MYCONID_GRID_16)
    bio = recolor_img(base, {"p": "P", "P": "q", "c": "C"})
    idle = [base, bio, shift_img(base, dy=-1), base]

    # Run: cute waddling mushroom stomp
    w_l = set_px(base.copy(), [(4, 15, "m"), (10, 14, "#"), (11, 14, ".")])
    w_r = set_px(base.copy(), [(11, 15, "m"), (4, 14, "#"), (5, 14, ".")])
    run = [w_l, shift_img(bio, dy=-1), w_r, shift_img(base, dy=-1)]

    # Attack: crouched mushroom cap -> bright spore pop puff above cap!
    a0 = shift_img(base, dy=1)
    a1 = set_px(
        shift_img(recolor_img(base, {"C": "w", "P": "q"}), dy=-1),
        [(2, 0, "C"), (4, 0, "P"), (7, 0, "w"), (11, 0, "C"), (13, 0, "q")],
    )
    a2 = set_px(bio.copy(), [(1, 1, "C"), (14, 1, "P"), (6, 0, "C")])
    return {"idle": idle, "run": run, "attack": [a0, a1, a2, base]}


# ===========================================================================
# PACKING & EXPORT
# ===========================================================================

BUILDERS = [
    ("slime", anim_slime),
    ("mage", anim_mage),
    ("brute", anim_brute),
    ("warden", anim_warden),
    ("shade", anim_shade),
    ("yeti", anim_yeti),
    ("sapper", anim_sapper),
    ("tank", anim_tank),
    ("bull", anim_bull),
    ("boss", anim_boss),
    ("archer", anim_archer),
    ("imp", anim_imp),
    ("mimic", anim_mimic),
    ("golem", anim_golem),
    ("myconid", anim_myconid),
]


def pack_atlas(frames: list[tuple[str, Image.Image]], atlas_w: int = 512, pad: int = 2) -> tuple[Image.Image, dict]:
    x = pad
    y = pad
    row_h = 0
    placed: list[tuple[str, int, int, Image.Image]] = []

    for name, img in frames:
        fw, fh = img.size
        if x + fw + pad > atlas_w:
            x = pad
            y += row_h + pad
            row_h = 0
        placed.append((name, x, y, img))
        x += fw + pad
        row_h = max(row_h, fh)

    total_h = max(64, y + row_h + pad)
    atlas_img = make_canvas(atlas_w, total_h)
    frames_meta: dict[str, dict] = {}

    for name, px_x, px_y, img in placed:
        atlas_img.alpha_composite(img, (px_x, px_y))
        fw, fh = img.size
        frames_meta[name] = {
            "frame": {"x": px_x, "y": px_y, "w": fw, "h": fh},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": fw, "h": fh},
            "sourceSize": {"w": fw, "h": fh},
        }

    atlas_json = {
        "frames": frames_meta,
        "meta": {
            "app": "dungeonle-monsters-builder",
            "version": "1.0",
            "image": "monsters_atlas.png",
            "format": "RGBA8888",
            "size": {"w": atlas_w, "h": total_h},
            "scale": "1",
        },
    }
    return atlas_img, atlas_json


def make_qa_preview(all_anims: list[tuple[str, dict[str, list[Image.Image]]]]) -> Image.Image:
    """Render a 3x zoomed QA preview showing idle_0, run_1, attack_1, attack_2 for all 15 monsters."""
    scale = 3
    cols_show = [("idle", 0), ("run", 1), ("attack", 1), ("attack", 2)]
    cell_w = 34 * scale
    cell_h = 34 * scale
    label_w = 110
    pad = 8
    header = 34
    pw = label_w + len(cols_show) * (cell_w + pad) + pad
    ph = header + len(all_anims) * (cell_h + 6) + pad
    prev = Image.new("RGB", (pw, ph), (26, 22, 36))
    d = ImageDraw.Draw(prev)
    font = ImageFont.load_default()

    d.text((pad, 8), "Dungeonle 15 Animated Monsters QA (1:1 Native 16x16-32x32 @3x)", fill=(248, 224, 140), font=font)
    for ci, (anim_name, fi) in enumerate(cols_show):
        d.text((label_w + ci * (cell_w + pad), 20), f"{anim_name}_{fi}", fill=(140, 232, 180), font=font)

    for ri, (skin, anims) in enumerate(all_anims):
        ry = header + ri * (cell_h + 6)
        sample = anims["idle"][0]
        d.text((pad, ry + cell_h // 2 - 6), f"{ri + 1:02d}. {skin} ({sample.width}x{sample.height})", fill=(230, 224, 244), font=font)
        for ci, (anim_name, fi) in enumerate(cols_show):
            cx = label_w + ci * (cell_w + pad)
            d.rectangle([cx, ry, cx + cell_w - 1, ry + cell_h - 1], fill=(34, 29, 48), outline=(58, 50, 78))
            im = anims[anim_name][fi]
            im_z = im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)
            cell = Image.new("RGBA", (cell_w, cell_h), (34, 29, 48, 255))
            cell.alpha_composite(im_z, ((cell_w - im_z.width) // 2, cell_h - im_z.height - 3))
            prev.paste(cell.convert("RGB"), (cx, ry))
    return prev


def main() -> None:
    packed_list: list[tuple[str, Image.Image]] = []
    qa_list: list[tuple[str, dict[str, list[Image.Image]]]] = []

    for skin, builder in BUILDERS:
        anims = builder()
        qa_list.append((skin, anims))
        sizes = set()
        for anim_name in ("idle", "run", "attack"):
            frames = anims[anim_name]
            assert len(frames) == 4, f"{skin}_{anim_name} must have 4 frames"
            for idx, im in enumerate(frames):
                sizes.add(im.size)
                # Ensure zero semi-transparent pixels anywhere in sprites
                for a in im.getchannel("A").tobytes():
                    assert a in (0, 255), f"Semi-alpha pixel found in {skin}_{anim_name}_{idx}"
                packed_list.append((f"{skin}_{anim_name}_{idx}", im))
        assert len(sizes) == 1, f"{skin} frames must share identical dimensions, got {sizes}"

    atlas_img, atlas_json = pack_atlas(packed_list)
    DUNGEON_DIR.mkdir(parents=True, exist_ok=True)
    atlas_img.save(OUT_PNG)
    OUT_JSON.write_text(json.dumps(atlas_json, indent=2) + "\n")
    print(f"Wrote {OUT_PNG} {atlas_img.size} and {OUT_JSON} ({len(packed_list)} frames)")

    try:
        SCRATCH_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        qa_img = make_qa_preview(qa_list)
        qa_img.save(SCRATCH_PREVIEW)
        print(f"Wrote QA preview -> {SCRATCH_PREVIEW} {qa_img.size}")
    except OSError as err:
        print(f"Skipped QA preview: {err}")


if __name__ == "__main__":
    main()
