#!/usr/bin/env python3
"""
Builds the animated 15-monster bestiary + projectiles atlas for Dungeonle using pure Pillow.

Every sprite is drawn with explicitly hand-placed pixels on the canonical 22-color
"Hearth & Slate" dark-fantasy palette (#14131a unified charcoal-slate ink, hue-shifted
ramps, zero pure #000000 shadows, zero grounded drop shadows) at true 1:1 native scale:
  - 8 standard monsters: 16x16 (slime, mage, shade, sapper, archer, imp, mimic, myconid)
  - 1 heavy brute:       20x20 (brute)
  - 3 heavy biome foes:  22x22 (yeti, tank, bull)
  - 1 colossal golem:    24x24 (golem)
  - 1 elite warden:      28x26 (22x22 knight inside safe walk/swing canvas)
  - 1 floor boss:        32x32 (boss - Crimson Lich King)
  - Chest + wake seq:    16x16 (chest_closed, mimic_wake_0..3)
  - Projectiles/FX:      arrow_0..1 (12x5), ember_dart_0..1 (10x6), spore_puff_0..1 (12x12)

Outputs:
  - public/assets/dungeon/monsters_atlas.png
  - public/assets/dungeon/monsters_atlas.json (191 frames)
  - scratch/monsters_atlas_preview.png (3x zoomed full-frame QA inspection grid)
"""
from __future__ import annotations

from collections import deque
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DUNGEON_DIR = ROOT / "public" / "assets" / "dungeon"
OUT_PNG = DUNGEON_DIR / "monsters_atlas.png"
OUT_JSON = DUNGEON_DIR / "monsters_atlas.json"

SCRATCH_PREVIEW = Path(
    "/Users/Samer/.gemini/antigravity/brain/5761ca84-14f6-427e-8716-3f004207e0cc/scratch/monsters_atlas_preview.png"
)


def _hex(h: str) -> tuple[int, int, int, int]:
    s = h.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


# Canonical 22-color Hearth & Slate Master Sprite Palette (zero pure #000000)
PAL: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "#": _hex("#14131a"),  # INK      - unified outline, deep shadow
    "0": _hex("#21232e"),  # SLATE_0  - dark iron, deep recesses
    "1": _hex("#2c303e"),  # SLATE_1  - dark armor/stone
    "2": _hex("#43495e"),  # SLATE_2  - iron shadow, stone mid
    "3": _hex("#6a738c"),  # SLATE_3  - mid steel, tank/warden plate
    "4": _hex("#a9b6cc"),  # SLATE_4  - bright steel, frost fur mid, light armor
    "u": _hex("#4d2e24"),  # OAK_0    - dark umber, leather, boots, chest shadow
    "b": _hex("#8c5236"),  # OAK_1    - oak chest, bull coat, leather
    "t": _hex("#d49562"),  # OAK_2    - warm bone shadow, light oak, horn mid
    "g": _hex("#e6a82e"),  # GOLD_1   - forged gold, clasps, trim
    "y": _hex("#f7df86"),  # GOLD_2   - gold glint, warm eyes, flame core
    "w": _hex("#f2efe4"),  # BONE     - warm ivory highlight, skull/fangs, speculars
    "a": _hex("#45a2e5"),  # SKY_1    - frost shade
    "z": _hex("#9edbf7"),  # SKY_2    - frost-ice glint, pale aqua spore mist
    "R": _hex("#7a222e"),  # CRIM_0   - deep crimson shadow, boss cape
    "r": _hex("#e04f44"),  # CRIM_1   - danger red: boss/brute, fletching, eyes
    "o": _hex("#f0853a"),  # EMBER    - hearth fire, magma, imp dart, bomber fuse
    "F": _hex("#265c42"),  # MOSS_0   - deep pine-moss shadow, slime/myconid base
    "e": _hex("#4eab5b"),  # MOSS_1   - slime, myconid, goblin mid
    "l": _hex("#96db6e"),  # MOSS_2   - slime gel glint, spore/goblin highlight
    "V": _hex("#4b356e"),  # PLUM_0   - dusk indigo robe, mage/shade/imp body
    "p": _hex("#a770d6"),  # PLUM_1   - amethyst hex magic, imp/mimic tongue, shade core
}

ALLOWED_OPAQUE_RGBA = frozenset(v for k, v in PAL.items() if k != ".")
INK_RGBA = PAL["#"]


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


def layer_stack(w: int, h: int, layers: list[Image.Image]) -> Image.Image:
    out = make_canvas(w, h)
    for lay in layers:
        out.alpha_composite(lay)
    return out


# ===========================================================================
# AUTOMATED SEAM, COMPONENT, PALETTE & GROUNDING LINT SUITE
# ===========================================================================

def _opaque_mask(img: Image.Image) -> list[list[bool]]:
    w, h = img.size
    px = img.load()
    return [[px[x, y][3] > 0 for x in range(w)] for y in range(h)]


def _components(mask: list[list[bool]], conn: int = 4) -> list[list[tuple[int, int]]]:
    h, w = len(mask), len(mask[0])
    vis = [[False] * w for _ in range(h)]
    dirs = ((-1, 0), (1, 0), (0, -1), (0, 1)) if conn == 4 else (
        (-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)
    )
    out: list[list[tuple[int, int]]] = []
    for y in range(h):
        for x in range(w):
            if mask[y][x] and not vis[y][x]:
                q = deque([(x, y)])
                vis[y][x] = True
                pts: list[tuple[int, int]] = []
                while q:
                    cx, cy = q.popleft()
                    pts.append((cx, cy))
                    for dx, dy in dirs:
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and not vis[ny][nx] and mask[ny][nx]:
                            vis[ny][nx] = True
                            q.append((nx, ny))
                out.append(pts)
    out.sort(key=len, reverse=True)
    return out


def lint_layer_seam(
    name: str,
    torso_img: Image.Image,
    child_img: Image.Image,
    child_label: str = "legs",
    min_overlap_px: int = 2,
) -> None:
    """Assert every 4-connected part of child_img (e.g. each leg/arm) overlaps torso_img directly."""
    tm, cm = _opaque_mask(torso_img), _opaque_mask(child_img)
    parts = _components(cm, conn=4)
    assert parts, f"{name}: {child_label} layer is unexpectedly empty"
    for idx, pts in enumerate(parts):
        overlap = sum(1 for x, y in pts if tm[y][x])
        assert overlap >= min_overlap_px, (
            f"{name}: {child_label}[{idx}] ({len(pts)}px) overlap={overlap} < {min_overlap_px}"
        )


def lint_frame(
    name: str,
    img: Image.Image,
    outline_rgba: tuple[int, int, int, int] = INK_RGBA,
    *,
    allow_edge_fill: bool = False,
) -> None:
    """Assert 4-CC == 1, 8-CC == 1, zero horizontal air gaps, binary alpha, palette lock, no clipped fills."""
    w, h = img.size
    px = img.load()
    for y in range(h):
        for x in range(w):
            rgba = px[x, y]
            assert rgba[3] in (0, 255), f"{name}: semi-alpha px {rgba} at ({x},{y})"
            if rgba[3] == 255:
                assert rgba in ALLOWED_OPAQUE_RGBA, f"{name}: off-palette color {rgba} at ({x},{y})"

    mask = _opaque_mask(img)
    c8 = _components(mask, conn=8)
    c4 = _components(mask, conn=4)
    assert len(c8) == 1, f"{name}: 8-CC split sizes={[len(c) for c in c8]}"
    assert len(c4) == 1, f"{name}: 4-CC split (diag-only/stray) sizes={[len(c) for c in c4]}"
    ys = [y for y in range(h) if any(mask[y])]
    for y in range(ys[0], ys[-1]):
        v_ov = sum(1 for x in range(w) if mask[y][x] and mask[y + 1][x])
        assert v_ov >= 1, f"{name}: horizontal air-gap between rows y={y} and y={y+1}"

    if not allow_edge_fill:
        clipped = []
        if any(px[x, 0][3] > 0 and px[x, 0] != outline_rgba for x in range(w)):
            clipped.append("TOP")
        if any(px[x, h - 1][3] > 0 and px[x, h - 1] != outline_rgba for x in range(w)):
            clipped.append("BOT")
        if any(px[0, y][3] > 0 and px[0, y] != outline_rgba for y in range(h)):
            clipped.append("LEFT")
        if any(px[w - 1, y][3] > 0 and px[w - 1, y] != outline_rgba for y in range(h)):
            clipped.append("RIGHT")
        assert not clipped, f"{name}: non-outline fill clipped at edge(s) {clipped}"


def lint_grounding(
    skin: str,
    anim_name: str,
    frames: list[Image.Image],
    *,
    max_bot_drift: int = 1,
    floating_skins: frozenset[str] = frozenset({"slime", "imp", "shade", "mimic"}),
) -> None:
    if skin in floating_skins:
        return
    bots = [max(y for y in range(im.height) if any(_opaque_mask(im)[y])) for im in frames]
    limit = 0 if anim_name == "idle" else max_bot_drift
    assert max(bots) - min(bots) <= limit, (
        f"{skin}_{anim_name}: foot baseline drift bot_y={bots} (delta={max(bots)-min(bots)} > {limit})"
    )


# ===========================================================================
# 1. EMERALD SLIME (16x16) - unified whole-frame grids
# ===========================================================================

SLIME_SQUASH_16 = [
    "................",
    "................",
    "................",
    "................",
    "....########....",
    "..##lllleeel##..",
    ".#llwleeeeeeeF#.",
    ".#leeeeeeeeeeF#.",
    "#lee##eeee##eeF#",
    "#eee#y#ee#y#eeF#",
    "#Fee#w#ee#w#eFF#",
    "#FFeeeeeeeeeeFF#",
    ".#FeFFFeeFFeFF#.",
    "..#FFFFeeFFFF#..",
    "...##########...",
    "................",
]

SLIME_NEUTRAL_16 = [
    "................",
    "................",
    ".....######.....",
    "...##lleeee##...",
    "..#llwleeeeee#..",
    "..#leeeeeeeeeF#.",
    ".#leeeeeeeeeeFF#",
    ".#ee##eeee##eeF#",
    ".#ee#y#ee#y#eFF#",
    ".#Fe#w#ee#w#eFF#",
    ".#FFeeeeeeeeFF#.",
    ".#FeFFFFFFFFeF#.",
    "..#FFFFFFFFFF#..",
    "...##########...",
    "................",
    "................",
]

SLIME_HOP_16 = [
    ".....######.....",
    "....#lleeee#....",
    "...#lwleeeee#...",
    "...#leeeeeeeF#..",
    "...#ee##e##eF#..",
    "...#ee#y##y#F#..",
    "...#Fe#w##w#F#..",
    "...#FFeeeeeFF#..",
    "...#FeFFFFFFe#..",
    "....#FFFFFFe#...",
    "....#FFFFFF#....",
    ".....######.....",
    "................",
    "................",
    "................",
    "................",
]

SLIME_SETTLE_16 = [
    "................",
    "................",
    "................",
    "....########....",
    "...#lleeeeee#...",
    "..#lwleeeeeee#..",
    "..#leeeeeeeeF#..",
    ".#ee##eeee##ee#.",
    ".#ee#y#ee#y#eF#.",
    ".#Fe#w#ee#w#eF#.",
    ".#FFeeeeeeeeFF#.",
    ".#FFeFFFFFFeFF#.",
    "..#FFFFFFFFFF#..",
    "...##########...",
    "................",
    "................",
]

SLIME_COIL_16 = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "...##########...",
    ".##lllwllllll##.",
    "#llwllllllllleF#",
    "#lll##llll##llF#",
    "#ell#w#ll#w#eeF#",
    "#Fee#y#ee#y#eFF#",
    "#FFeeeeeeeeeeFF#",
    ".#FFeFFFFFFeFF#.",
    "..############..",
    "................",
    "................",
]

SLIME_LUNGE_16 = [
    "................",
    ".......#####....",
    ".....##lllel##..",
    "....#llwleeeel#.",
    "...#leee##ee###.",
    "..#lee#w#e#w#l#.",
    "..#Fee#y#e#y#w#.",
    "..#FFeeeeeeeee#.",
    "...#FFeeeeeeeF#.",
    "....#FFFFFFFF#..",
    ".....########...",
    "................",
    "................",
    "................",
    "................",
    "................",
]

SLIME_SPLAT_16 = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "....########....",
    ".##.#llwlll#....",
    "#lw##lleeeel##..",
    "#eellleeeeeelw#.",
    "#eee##eeee##el#.",
    "#Fee#g#ee#g#eeF#",
    "#FFe#w#ee#w#eFF#",
    "#FFeeeeeeeeeeFF#",
    ".#FFeFFFFFFeFF#.",
    "..############..",
    "................",
]


def anim_slime() -> dict[str, list[Image.Image]]:
    s0 = from_grid(SLIME_SQUASH_16)
    s1 = from_grid(SLIME_NEUTRAL_16)
    s2 = from_grid(SLIME_HOP_16)
    s3 = from_grid(SLIME_SETTLE_16)
    a0 = from_grid(SLIME_COIL_16)
    a1 = from_grid(SLIME_LUNGE_16)
    a2 = from_grid(SLIME_SPLAT_16)
    return {
        "idle": [s1, s3, s0, s3],
        "run": [s0, s1, s2, s3],
        "attack": [a0, a1, a2, s3],
    }


# ===========================================================================
# 2. CULTIST MAGE (16x16) - overlap-anchored layers (1px top headroom, 2-3px hem cushion)
# ===========================================================================

MAGE_TORSO_16 = [
    "................",
    ".....####.......",
    "....#1VVp#......",
    "...#1VVVp#......",
    "..#11VVV##......",
    "..#1#####1#.....",
    "..#1#wp#p##.....",
    "..#1#####1#.....",
    "...#1VVpV###....",
    "..#1VVVVV#VV#...",
    ".#1VVgggggV##...",
    ".#1V#gVV1V#.....",
    "..##1VV1VV#.....",
    "..#1VV1VVV#.....",
    "................",
    "................",
]

# Legs/hem extend up to y=11 (3 rows behind torso y=1..13) -> >=10px overlap even at torso_dy=-1!
MAGE_FEET_16 = {
    "idle": [
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
        "................",
        "..#1VV1VVV#.....",
        "..#1VV1VVV#.....",
        "..#1pp11p1#.....",
        "..##ub##bu#.....",
        "....##..##......",
    ],
    "step_l": [
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
        "................",
        "..#1VV1VVV#.....",
        "..#1VV1VVV#.....",
        "..#1pp11p##.....",
        ".#ub##bu#.......",
        ".###..##........",
    ],
    "step_r": [
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
        "................",
        "..#1VV1VVV#.....",
        "..#1VV1VVV#.....",
        "..##pp11p1#.....",
        "...#ub##bu#.....",
        ".....#..###.....",
    ],
    "tuck": [
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
        "................",
        "..#1VV1VVV#.....",
        "..#1VV1VVV#.....",
        "..#1pp11p1#.....",
        "...#ub#bu#......",
        "...##..##.......",
    ],
}

# Staff always overlaps mage hand/sleeve at x=10..12, y=8..10
MAGE_STAFF_16 = {
    "rest": [
        "................",
        "............###.",
        "...........#wpp#",
        "...........#ppV#",
        "...........#ggb#",
        "............#t#.",
        "............#b#.",
        "............#t#.",
        "...........#tb#.",
        "...........VVt#.",
        "............#b#.",
        "............#t#.",
        "............#b#.",
        "............#t#.",
        "............#b#.",
        ".............#..",
    ],
    "high_glow": [
        "............###.",
        "...........#ywy#",
        "...........#wpp#",
        "...........#ygg#",
        "............#t#.",
        "............#b#.",
        "............#t#.",
        "...........#tb#.",
        "...........VVt#.",
        "............#b#.",
        "............#t#.",
        "............#b#.",
        "............#t#.",
        ".............#..",
        "................",
        "................",
    ],
    "windup_back": [
        "........###.....",
        ".......#wpp#....",
        ".......#ppy#....",
        "........#gg#....",
        ".........#t#....",
        "..........#b#...",
        "..........#t#...",
        "...........#b#..",
        "..........#VV#..",
        "...........#b#..",
        "............#...",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "thrust_nova": [
        "...........####.",
        "..........#ywy#.",
        "..........#wpp#.",
        "..........#ygg#.",
        "...........#t#..",
        "...........#b#..",
        "..........#t#...",
        "..........#b#...",
        "..........VV#...",
        "...........#b#..",
        "............#...",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "cast_fwd": [
        "................",
        "................",
        "................",
        "...........###..",
        "..........#ywy#.",
        ".........#ywppw#",
        "......####wpypw#",
        ".....#tbt#yggyw#",
        "......###.#ppw#.",
        "...........###..",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
}


def build_mage_frame(
    tag: str, leg_pose: str, staff_pose: str, torso_dy: int = 0, pulse: bool = False
) -> Image.Image:
    legs = from_grid(MAGE_FEET_16[leg_pose])
    torso = from_grid(MAGE_TORSO_16, oy=torso_dy)
    if pulse:
        torso = recolor_img(torso, {"p": "y", "g": "y"})
    staff = from_grid(MAGE_STAFF_16[staff_pose])
    lint_layer_seam(tag, torso, legs, "legs", min_overlap_px=6)
    lint_layer_seam(tag, torso, staff, "staff", min_overlap_px=2)
    return layer_stack(16, 16, [legs, torso, staff])


def anim_mage() -> dict[str, list[Image.Image]]:
    idle = [
        build_mage_frame("mage_idle_0", "idle", "rest", 0, False),
        build_mage_frame("mage_idle_1", "idle", "high_glow", 0, True),
        build_mage_frame("mage_idle_2", "idle", "high_glow", 1, False),
        build_mage_frame("mage_idle_3", "idle", "rest", 1, False),
    ]
    run = [
        build_mage_frame("mage_run_0", "step_l", "rest", 0, False),
        build_mage_frame("mage_run_1", "tuck", "high_glow", -1, True),
        build_mage_frame("mage_run_2", "step_r", "rest", 0, False),
        build_mage_frame("mage_run_3", "tuck", "windup_back", -1, False),
    ]
    attack = [
        build_mage_frame("mage_attack_0", "idle", "windup_back", 0, False),
        build_mage_frame("mage_attack_1", "tuck", "thrust_nova", -1, True),
        build_mage_frame("mage_attack_2", "step_r", "cast_fwd", 0, True),
        build_mage_frame("mage_attack_3", "idle", "rest", 0, False),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 3. HORNED BRUTE (20x20) - socket-overlapped legs + shoulder-connected arms
# ===========================================================================

BRUTE_TORSO_20 = [
    "....................",
    "...#............#...",
    "..#w#..........#t#..",
    "..#tw#..####..#wt#..",
    "...#tw##roor##wt#...",
    "....###rooooor##....",
    "......#r#yy#r#......",
    "......#rw##wr#......",
    ".....##rr##rr##.....",
    ".....#roororrr#.....",
    ".....#orrrrrro#.....",
    ".....#rrrrrrrr#.....",
    ".....#ubbgbbgu#.....",
    ".....#ubbgbbgu#.....",
    "......#rrRRrr#......",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
]

# Thighs rise up to y=12 (3 rows inside torso y=1..14) -> >=6px overlap per leg at dy=-1
BRUTE_LEGS_20 = {
    "idle": [
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "......#rr##rr#......",
        "......#rr##rr#......",
        "......#rR##rR#......",
        "......#rR##rR#......",
        ".....#23#..#32#.....",
        "....#233#..#332#....",
        "....#433#..#334#....",
        "....#####..#####....",
    ],
    "step_l": [
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "......#rr##rr#......",
        "......#rr##rr#......",
        ".....#rR#..#rR#.....",
        "....#2rR#..#rR2#....",
        "...#233#....#32#....",
        "...#433#....#33#....",
        "...#433#....####....",
        "...#####............",
    ],
    "passing": [
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "......#rr##rr#......",
        "......#rr##rr#......",
        "......#rR##rR#......",
        "......#rR##rR#......",
        "......#23##32#......",
        "......#43##34#......",
        "......###..###......",
        "....................",
    ],
    "step_r": [
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "......#rr##rr#......",
        "......#rr##rr#......",
        ".....#rR#..#rR#.....",
        "....#2rR#..#rR2#....",
        "....#23#....#332#...",
        "....#33#....#334#...",
        "....####....#334#...",
        "............#####...",
    ],
}

# Every arm connects directly into shoulders x=5..6 / x=13..14, y=8..11
BRUTE_ARMS_20 = {
    "rest": [
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "..####........####..",
        ".#4333#......#3332#.",
        "#23333#......#33332#",
        "#23322#......#22332#",
        ".#####........#####.",
        ".#oor#........#roo#.",
        "#orrr#........#rrrR#",
        "#rRRr#........#RRr2#",
        "#2332#........#232#.",
        ".####..........###..",
        "....................",
        "....................",
        "....................",
        "....................",
    ],
    "swing_l": [
        "....................",
        "....................",
        "....................",
        "....................",
        ".####...............",
        "#4333#..............",
        "#2333#..............",
        ".####r#........####.",
        ".#oorr#.......#3332#",
        "#orrr#........#3332#",
        "#rRR#.........#rrrR#",
        ".###..........#RRr2#",
        "...............#232#",
        "................###.",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
    ],
    "swing_r": [
        "....................",
        "....................",
        "....................",
        "....................",
        "...............####.",
        "..............#3334#",
        "..............#3332#",
        ".####........#r####.",
        "#4333#.......#rroo#.",
        "#2333#........#rrrR#",
        ".####.........#2332#",
        ".#orr#.........####.",
        "#rRR2#..............",
        ".#232#..............",
        "..###...............",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
    ],
    "raise_both": [
        "....................",
        ".####..........####.",
        "#4332#........#2334#",
        "#2332#........#2332#",
        "#orr2#........#2rro#",
        ".#rRrr#......#rrRr#.",
        "..#rrr#......#rrr#..",
        "..#433#......#334#..",
        "..#233#......#332#..",
        "...####......####...",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
    ],
    "slam_both": [
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "..####........####..",
        ".#4333#......#3332#.",
        ".#233r#......#r332#.",
        ".#orrr#......#rrro#.",
        "#orrr#........#rrro#",
        "#2332#........#2332#",
        "#4332#........#2334#",
        "#2332#........#2332#",
        ".#yy#..........#yy#.",
        "#ywo#..........#owy#",
        ".###............###.",
        "....................",
        "....................",
    ],
}


def build_brute_frame(
    tag: str, leg_pose: str, arm_pose: str, torso_dy: int = 0, glare: bool = False
) -> Image.Image:
    legs = from_grid(BRUTE_LEGS_20[leg_pose])
    torso = from_grid(BRUTE_TORSO_20, oy=torso_dy)
    if glare:
        torso = recolor_img(torso, {"y": "w"})
    arms = from_grid(BRUTE_ARMS_20[arm_pose], oy=min(0, torso_dy))
    lint_layer_seam(tag, torso, legs, "legs", min_overlap_px=4)
    lint_layer_seam(tag, torso, arms, "arms", min_overlap_px=3)
    return layer_stack(20, 20, [legs, torso, arms])


def anim_brute() -> dict[str, list[Image.Image]]:
    idle = [
        build_brute_frame("brute_idle_0", "idle", "rest", 0, False),
        build_brute_frame("brute_idle_1", "idle", "rest", 1, True),
        build_brute_frame("brute_idle_2", "idle", "swing_l", 1, False),
        build_brute_frame("brute_idle_3", "idle", "rest", 0, False),
    ]
    run = [
        build_brute_frame("brute_run_0", "step_l", "swing_r", 0, False),
        build_brute_frame("brute_run_1", "passing", "rest", -1, False),
        build_brute_frame("brute_run_2", "step_r", "swing_l", 0, False),
        build_brute_frame("brute_run_3", "passing", "rest", -1, True),
    ]
    attack = [
        build_brute_frame("brute_attack_0", "idle", "rest", 1, True),
        build_brute_frame("brute_attack_1", "passing", "raise_both", -1, True),
        build_brute_frame("brute_attack_2", "idle", "slam_both", 1, True),
        build_brute_frame("brute_attack_3", "idle", "rest", 0, False),
    ]
    return {"idle": idle, "run": run, "attack": attack}


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
    ".....#433###332#......",
    "....#23333333332#.....",
    "....#23433333322#.....",
    ".....###233332###.....",
    ".......#233332#.......",
    ".......#244432#.......",
    ".......#oggggo#.......",
    "......#233gg332#......",
    "......#233gg332#......",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
]

WARDEN_HEAD_22 = [
    "...##............##...",
    "..#w#............#4#..",
    "..#4w#..######..#34#..",
    "...#43##244432##32#...",
    "....###23333332###....",
    "......#2gggggg2#......",
    "......#2#y##y#2#......",
    "......#22#22#22#......",
    ".......#233332#.......",
    "........######........",
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

# Shield ends at local y=19 so shield_dy <= +1 NEVER dips below foot baseline y=21
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
    ".............#g33333o#",
    ".............#g34gg3o#",
    ".............#g3gy43o#",
    ".............#g3ggggo#",
    ".............#g33gg3o#",
    "..............#g33go#.",
    "...............#ggo#..",
    "................#o#...",
    ".................#....",
    "......................",
    "......................",
]

# Thighs start at local y=14 (3 rows behind torso y=7..16) -> >=6px overlap per leg
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
        "......#232..#232......",
        "......#232..#232......",
        "......#232..#232......",
        "......#233..#332......",
        ".....#2332..#2332.....",
        ".....#433#..#334#.....",
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
        "......#232..#232......",
        "......#232...#232.....",
        ".....#433#...#232#....",
        ".....#w33#....#332#...",
        ".....#433#....#####...",
        ".....#433#............",
        ".....#####............",
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
        ".......#232.#232......",
        ".......#232.#232......",
        ".......#232.#232......",
        ".......#433.#332......",
        ".......#433.#332......",
        ".......####.####......",
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
        ".......#232.#232......",
        ".......#232.#232......",
        "......#232#.#233#.....",
        ".....#233#...#33w#....",
        ".....####....#334#....",
        ".............#334#....",
        ".............#####....",
        "......................",
    ],
}


def build_warden_frame(
    tag: str,
    leg_pose: str = "idle",
    torso_dy: int = 0,
    head_dy: int = 0,
    shield_dx: int = 0,
    shield_dy: int = 0,
    weapon_mode: str = "idle",
    glare: bool = False,
) -> Image.Image:
    w, h, ox, oy = 28, 26, 3, 2
    legs = from_grid(WARDEN_LEGS_22[leg_pose], w=w, h=h, ox=ox, oy=oy)
    weapon = make_canvas(w, h)
    # Every mace pose draws armored arm bridge + gauntlet + continuous shaft + mace head
    if weapon_mode == "idle":
        paint_grid(weapon, [".#w#..", "#434#.", ".#2##.", "..#t#.", "..#b#.", "..#u#."], ox=ox, oy=oy + 5 + torso_dy)
        paint_grid(weapon, ["#232##", "#4333#"], ox=ox + 1, oy=oy + 10 + torso_dy)
    elif weapon_mode == "march_fwd":
        paint_grid(weapon, [".#w#..", "#434#.", ".#2##.", "..#t#.", "..#b#."], ox=ox - 1, oy=oy + 6 + torso_dy)
        paint_grid(weapon, ["#232###", "#43332#"], ox=ox, oy=oy + 10 + torso_dy)
    elif weapon_mode == "windup":
        paint_grid(weapon, [".#w#..", "#434#.", ".#2##.", "..#t#.", "..#b#.", "..#u#."], ox=ox - 1, oy=oy + 2 + torso_dy)
        paint_grid(weapon, ["#232##", "#4333#", ".#233#"], ox=ox + 1, oy=oy + 8 + torso_dy)
    elif weapon_mode == "strike":
        # Continuous steel-gold swing smear + forearm + shaft + heavy mace head
        paint_grid(
            weapon,
            [
                "...###....",
                "..#w4#....",
                ".#yw4##...",
                "#yw4#233#.",
                "#4w#t233#.",
                ".#4#b##...",
                "..#434#...",
                "...#w#....",
            ],
            ox=ox - 2,
            oy=oy + 7 + torso_dy,
        )
    elif weapon_mode == "impact":
        # Gauntlet gripping shaft straight into slammed mace head + attached gold spark
        paint_grid(
            weapon,
            [
                "....#233#.",
                "...#2333#.",
                "...#u##...",
                "..#b#.....",
                ".#434#....",
                "#yw3w#....",
                ".#y2y#....",
                "..###.....",
            ],
            ox=ox - 2,
            oy=oy + 10 + torso_dy,
        )
    elif weapon_mode == "recover":
        paint_grid(weapon, [".#w#..", "#434#.", ".#2##.", "..#t#.", "..#b#."], ox=ox, oy=oy + 6 + torso_dy)
        paint_grid(weapon, ["#232##", "#4333#"], ox=ox + 1, oy=oy + 10 + torso_dy)

    torso = from_grid(WARDEN_TORSO_22, w=w, h=h, ox=ox, oy=oy + torso_dy)
    head = from_grid(WARDEN_HEAD_22, w=w, h=h, ox=ox, oy=oy + head_dy)
    if glare:
        head = recolor_img(head, {"y": "w"})
    shield = from_grid(WARDEN_SHIELD_22, w=w, h=h, ox=ox + shield_dx, oy=oy + shield_dy)

    lint_layer_seam(tag, torso, legs, "legs", min_overlap_px=4)
    lint_layer_seam(tag, torso, head, "head", min_overlap_px=6)
    lint_layer_seam(tag, torso, weapon, "weapon", min_overlap_px=3)
    lint_layer_seam(tag, torso, shield, "shield", min_overlap_px=3)
    return layer_stack(w, h, [legs, weapon, torso, head, shield])


def anim_warden() -> dict[str, list[Image.Image]]:
    idle = [
        build_warden_frame("warden_idle_0", "idle", 0, 0, 0, 0, "idle", False),
        build_warden_frame("warden_idle_1", "idle", 1, 0, 1, 1, "idle", True),
        build_warden_frame("warden_idle_2", "idle", 1, 1, 0, 1, "march_fwd", False),
        build_warden_frame("warden_idle_3", "idle", 0, 1, 0, 0, "idle", False),
    ]
    run = [
        build_warden_frame("warden_run_0", "contact_a", 0, 0, 1, 0, "march_fwd", False),
        build_warden_frame("warden_run_1", "passing", -1, 0, 0, -1, "idle", False),
        build_warden_frame("warden_run_2", "contact_b", 0, -1, -1, 0, "windup", True),
        build_warden_frame("warden_run_3", "passing", -1, 0, 0, -1, "idle", False),
    ]
    attack = [
        build_warden_frame("warden_attack_0", "idle", -1, 0, -1, -1, "windup", True),
        build_warden_frame("warden_attack_1", "contact_a", 0, 0, 1, 1, "strike", True),
        build_warden_frame("warden_attack_2", "contact_a", 1, 1, 1, 1, "impact", True),
        build_warden_frame("warden_attack_3", "passing", 0, 0, 0, 0, "recover", False),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 5. CRYPT SHADE (16x16) - dusk-plum spectral wraith, 3-row tail overlap
# ===========================================================================

SHADE_HOOD_16 = [
    "................",
    ".....#####......",
    "....#1VpVV#.....",
    "...#1VVVV1#.....",
    "..#1######1#....",
    "..#1#wp#wp##....",
    "..#1######1#....",
    "..#1VVVVVV1#....",
    "...#1VVVV1#.....",
    "....#VVVV#......",
    "....#1VV1#......",
    "................",
    "................",
    "................",
    "................",
    "................",
]

# Every tail starts up at y=7 (overlapping hood y=1..10 across 3-4 rows!)
SHADE_TAILS_16 = {
    "sweep_l": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....#VVVV#......",
        "....#1VV1#......",
        "....#1VVV#......",
        "...#1VV1V#......",
        "..#1VV1V1#......",
        ".#pV1V1##.......",
        "#pw1##..........",
        ".###............",
        "................",
    ],
    "curl_mid": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....#VVVV#......",
        "....#1VV1#......",
        "....#1VVV#......",
        "....#1VV1V#.....",
        "....#1#V1V#.....",
        ".....#1V1#......",
        ".....#pw11#.....",
        "......#pw1#.....",
        ".......###......",
    ],
    "sweep_r": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....#VVVV#......",
        "....#1VV1#......",
        ".....#VVV#......",
        ".....#1VV1#.....",
        "......#1VV1#....",
        ".......##1V1p#..",
        "........#11wp1#.",
        ".........#####..",
        "................",
    ],
    "dash_trail": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....#VVVV#......",
        "....#1VVV#......",
        "....#1VVV#......",
        "..##1VV1V#......",
        "#pV11V1##.......",
        ".#pw##..........",
        "..##............",
        "................",
        "................",
    ],
}

# Every claw overlaps cloak hood/torso by >=3px per arm
SHADE_CLAWS_16 = {
    "rest": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        ".#111#...#111#..",
        "#pw11#...#11wp#.",
        ".####.....####..",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "reach_fwd": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        ".........#111#..",
        ".#111#..#11wpw#.",
        "#pw11#...#####..",
        ".####....#11wp#.",
        "..........####..",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "wide_flare": [
        "................",
        "................",
        "................",
        ".###......###...",
        "#wp#......#pw#..",
        "#p11#....#11p#..",
        ".#111#..#111#...",
        "..###....###....",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "cross_slash": [
        "................",
        "................",
        "...........###..",
        "..........#wp#..",
        "........##pw##..",
        ".......#11pwp#..",
        ".......#11wpw#..",
        "........##pwp#..",
        ".........#1wp#..",
        "..........###...",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
}


def build_shade_frame(
    tag: str, tail_pose: str, claw_pose: str, hood_dy: int = 0, glare: bool = False
) -> Image.Image:
    tail = from_grid(SHADE_TAILS_16[tail_pose])
    hood = from_grid(SHADE_HOOD_16, oy=hood_dy)
    if glare:
        hood = recolor_img(hood, {"V": "p", "p": "w"})
    claws = from_grid(SHADE_CLAWS_16[claw_pose])
    lint_layer_seam(tag, hood, tail, "tail", min_overlap_px=8)
    lint_layer_seam(tag, hood, claws, "claws", min_overlap_px=3)
    return layer_stack(16, 16, [tail, hood, claws])


def anim_shade() -> dict[str, list[Image.Image]]:
    idle = [
        build_shade_frame("shade_idle_0", "sweep_l", "rest", 0, False),
        build_shade_frame("shade_idle_1", "curl_mid", "rest", -1, False),
        build_shade_frame("shade_idle_2", "sweep_r", "reach_fwd", -1, True),
        build_shade_frame("shade_idle_3", "curl_mid", "rest", 0, False),
    ]
    run = [
        build_shade_frame("shade_run_0", "dash_trail", "reach_fwd", 0, False),
        build_shade_frame("shade_run_1", "sweep_l", "reach_fwd", -1, True),
        build_shade_frame("shade_run_2", "dash_trail", "rest", 0, False),
        build_shade_frame("shade_run_3", "curl_mid", "reach_fwd", -1, False),
    ]
    attack = [
        build_shade_frame("shade_attack_0", "curl_mid", "wide_flare", -1, True),
        build_shade_frame("shade_attack_1", "sweep_l", "cross_slash", 0, True),
        build_shade_frame("shade_attack_2", "sweep_r", "reach_fwd", 1, True),
        build_shade_frame("shade_attack_3", "curl_mid", "rest", 0, False),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 6. FROST YETI (22x22) - shaggy fur, ice-tipped horns/claws, fierce crimson eyes
# ===========================================================================

YETI_TORSO_22 = [
    "......................",
    "...#.............#....",
    "..#wz#...####...#zw#..",
    "..#za##.#w44w#.##az#..",
    "...#a#4#44ww44#4#a#...",
    "....###34333343###....",
    "......#3r#44#r3#......",
    ".....##33####33##.....",
    "....#4433#ww#3344#....",
    "....#444444444444#....",
    "....#444444444433#....",
    "....#444444444433#....",
    "....#44w444444433#....",
    "....#44w444444322#....",
    ".....#44444444#.......",
    ".....#44444444#.......",
    "......#4w4444#........",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
]

# Thighs start at y=13 (4 rows inside torso y=1..16) -> >=9px overlap per leg
YETI_LEGS_22 = {
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
        "......#4w##44#........",
        "......#4w##44#........",
        "......#4w##44#........",
        "......#4w##44#........",
        "......#44##44#........",
        ".....#334##433#.......",
        "....#z443##344z#......",
        "....#####..#####......",
        "......................",
    ],
    "step_l": [
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
        "......#4w##44#........",
        "......#4w##44#........",
        "......#4w##44#........",
        ".....#4ww#.#44#.......",
        "....#334#...#33#......",
        "...#z443#...#33#......",
        "...#z443#...#####.....",
        "...######.............",
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
        "......#4w##44#........",
        "......#4w##44#........",
        "......#4w##44#........",
        ".......#4w#44#........",
        ".......#43#43#........",
        "......#z44#44z#.......",
        "......####.####.......",
        "......................",
        "......................",
    ],
    "step_r": [
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
        "......#4w##44#........",
        "......#4w##44#........",
        "......#4w##44#........",
        ".....#4w#..#444#......",
        ".....#33#...#433#.....",
        ".....#33#...#344z#....",
        ".....####...#344z#....",
        "............######....",
        "......................",
    ],
}

# Every arm connects directly into shoulders x=4..6 / x=15..17, y=8..12
YETI_ARMS_22 = {
    "rest": [
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "...###..........###...",
        "..#www#........#444#..",
        ".#w444#........#4444#.",
        "#4ww4#..........#4443#",
        "#ww44#..........#4443#",
        "#4443#..........#4443#",
        "#434#...........#2332#",
        "#zza#............#a32#",
        "#wzz#............#zw#.",
        ".####.............##..",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
    ],
    "swing_l": [
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "..###.................",
        ".#www#................",
        "#w444#...........###..",
        "#4444#..........#444#.",
        "#zza4#..........#4444#",
        "#wzz#...........#4443#",
        ".####...........#2332#",
        ".................#a32#",
        "..................#zw#",
        "...................##.",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
    ],
    "swing_r": [
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        ".................###..",
        "................#444#.",
        "..###...........#4443#",
        ".#www#..........#2332#",
        "#w444#..........#zz3#.",
        "#4443#..........#wz4#.",
        "#434#............###..",
        "#zza#.................",
        "#wzz#.................",
        ".####.................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
    ],
    "raise_both": [
        "......................",
        ".####............####.",
        "#wzz4#..........#4zzw#",
        "#4344#..........#4434#",
        "#w444#..........#444w#",
        ".#444#..........#444#.",
        "..#444#........#444#..",
        "..#w444#......#4444#..",
        "...#444#......#444#...",
        "....###........###....",
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
    ],
    "smash": [
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "...###..........###...",
        "..#www#........#444#..",
        ".#w444#........#4444#.",
        ".#4443#........#3444#.",
        ".#443#..........#344#.",
        "#4443#..........#3444#",
        "#4443#..........#3444#",
        "#zza3#..........#3azz#",
        "#wzz4#..........#4zzw#",
        "#zwzz#..........#zzwz#",
        ".####............####.",
        "......................",
        "......................",
        "......................",
        "......................",
    ],
}


def build_yeti_frame(
    tag: str, leg_pose: str, arm_pose: str, torso_dy: int = 0, breath: bool = False
) -> Image.Image:
    legs = from_grid(YETI_LEGS_22[leg_pose])
    torso = from_grid(YETI_TORSO_22, oy=torso_dy)
    if breath:
        torso = recolor_img(torso, {"r": "y", "a": "z"})
    arms = from_grid(YETI_ARMS_22[arm_pose], oy=min(0, torso_dy))
    lint_layer_seam(tag, torso, legs, "legs", min_overlap_px=6)
    lint_layer_seam(tag, torso, arms, "arms", min_overlap_px=4)
    return layer_stack(22, 22, [legs, torso, arms])


def anim_yeti() -> dict[str, list[Image.Image]]:
    idle = [
        build_yeti_frame("yeti_idle_0", "idle", "rest", 0, False),
        build_yeti_frame("yeti_idle_1", "idle", "rest", 1, True),
        build_yeti_frame("yeti_idle_2", "idle", "swing_l", 1, True),
        build_yeti_frame("yeti_idle_3", "idle", "rest", 0, False),
    ]
    run = [
        build_yeti_frame("yeti_run_0", "step_l", "swing_r", 0, False),
        build_yeti_frame("yeti_run_1", "passing", "rest", -1, False),
        build_yeti_frame("yeti_run_2", "step_r", "swing_l", 0, False),
        build_yeti_frame("yeti_run_3", "passing", "rest", -1, True),
    ]
    attack = [
        build_yeti_frame("yeti_attack_0", "passing", "raise_both", -1, True),
        build_yeti_frame("yeti_attack_1", "idle", "swing_r", 0, True),
        build_yeti_frame("yeti_attack_2", "idle", "smash", 1, True),
        build_yeti_frame("yeti_attack_3", "idle", "rest", 0, False),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 7. ALLEY SAPPER (16x16) - goblin bomber, 1px top headroom, 3px leg overlap
# ===========================================================================

SAPPER_BODY_16 = [
    "................",
    "....#####.......",
    "...#ubtbu#......",
    "..#ubbbbb#......",
    ".##bb####b#.....",
    "#eFe#lllle#.....",
    ".##e#yle#y#.....",
    "...##ellee#.....",
    "...#e#w#w#......",
    "...#ubtbbb#.....",
    "..#e#bbgbb#.....",
    "..#F#bbbbb#.....",
    "...##ububu#.....",
    "................",
    "................",
    "................",
]

# Thighs rise up to y=10 (3 rows behind vest y=1..12) -> >=4px overlap per leg
SAPPER_LEGS_16 = {
    "idle": [
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
        "...#ub#.#bu#....",
        "...#ub#.#bu#....",
        "...#ub#.#bu#....",
        "...#23#.#32#....",
        "...###...###....",
        "................",
    ],
    "scurry_l": [
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
        "...#ub#.#bu#....",
        "...#ub#.#bu#....",
        "..#ub#..#bu#....",
        ".#23#...###.....",
        ".###............",
        "................",
    ],
    "scurry_r": [
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
        "...#ub#.#bu#....",
        "...#ub#.#bu#....",
        "....#ub#.#bu#...",
        "....###...#32#..",
        "..........###...",
        "................",
    ],
    "squat": [
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
        "...#ub#.#bu#....",
        "...#ub#.#bu#....",
        "..#ub#...#bu#...",
        "..#23#...#32#...",
        "..###.....###...",
        "................",
    ],
}

# Every bomb pose connects via goblin arm/hand into torso, zero clipped edges or detached sparks
SAPPER_BOMB_16 = {
    "spark_a": [
        "................",
        "............###.",
        "...........#yoy#",
        "...........#t##.",
        "..........#342#.",
        "..........#332#.",
        "..........#232#.",
        "..........#e2#..",
        ".........#Fe#...",
        "..........##....",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "spark_b": [
        "................",
        "............###.",
        "...........#wro#",
        "...........#oyw#",
        "...........#t##.",
        "..........#342#.",
        "..........#332#.",
        "..........#232#.",
        "..........#e2#..",
        ".........#Fe#...",
        "..........##....",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "overhead": [
        "................",
        ".....####.......",
        "....#t#yo#......",
        "...#3433#.......",
        "...#2332#.......",
        "....#e2e#.......",
        "....#F#F#.......",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "windup_back": [
        "................",
        "................",
        "................",
        "................",
        "................",
        ".###............",
        "#yo#............",
        "#t34##..........",
        "#332e#..........",
        ".#22F#..........",
        "..###...........",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    "throw_blast": [
        "................",
        "............###.",
        "...........#ywo#",
        ".........##34yw#",
        "........#e33yw#.",
        "........#Fe#ro#.",
        ".........##.##..",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
}


def build_sapper_frame(tag: str, leg_pose: str, bomb_pose: str, body_dy: int = 0) -> Image.Image:
    legs = from_grid(SAPPER_LEGS_16[leg_pose])
    body = from_grid(SAPPER_BODY_16, oy=body_dy)
    bomb = from_grid(SAPPER_BOMB_16[bomb_pose], oy=min(0, body_dy))
    lint_layer_seam(tag, body, legs, "legs", min_overlap_px=4)
    lint_layer_seam(tag, body, bomb, "bomb", min_overlap_px=2)
    return layer_stack(16, 16, [legs, body, bomb])


def anim_sapper() -> dict[str, list[Image.Image]]:
    idle = [
        build_sapper_frame("sapper_idle_0", "idle", "spark_a", 0),
        build_sapper_frame("sapper_idle_1", "idle", "spark_b", 1),
        build_sapper_frame("sapper_idle_2", "idle", "spark_a", 1),
        build_sapper_frame("sapper_idle_3", "idle", "spark_b", 0),
    ]
    run = [
        build_sapper_frame("sapper_run_0", "scurry_l", "overhead", 0),
        build_sapper_frame("sapper_run_1", "squat", "spark_b", -1),
        build_sapper_frame("sapper_run_2", "scurry_r", "overhead", 0),
        build_sapper_frame("sapper_run_3", "idle", "spark_a", -1),
    ]
    attack = [
        build_sapper_frame("sapper_attack_0", "squat", "windup_back", 1),
        build_sapper_frame("sapper_attack_1", "scurry_l", "overhead", -1),
        build_sapper_frame("sapper_attack_2", "scurry_r", "throw_blast", 0),
        build_sapper_frame("sapper_attack_3", "idle", "spark_a", 0),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 8. MORTAR TANK (22x22) - shifted down 2px (bot_y=20), 2-row chassis overlap
# ===========================================================================

TANK_HULL_22 = [
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    ".......####...........",
    ".....##gggg#..........",
    "....#gggggg###........",
    "...#oggggggg#.........",
    "...##########.........",
    "..#444444444332#......",
    ".#oggo33rr333332#.....",
    ".#gbbg33rr333332#.....",
    ".#oooo22222222222#....",
    ".#222222222222222#....",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
]

# Treads chassis extends UP to y=14 behind hull -> >=20px solid overlap even at hull_dy=-1!
TANK_TREADS_22 = {
    "t0": [
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
        "..#2222222222222#.....",
        "..#22222222222222#....",
        ".#################....",
        "#22332233223322332#...",
        "#2#gg#2#gg#2#gg#22#...",
        "#22go222go222go222#...",
        ".#################....",
        "......................",
    ],
    "t1": [
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
        "..#2222222222222#.....",
        "..#22222222222222#....",
        ".#################....",
        "#33223322332233223#...",
        "#22#gg#2#gg#2#gg#2#...",
        "#go222go222go222go#...",
        ".#################....",
        "......................",
    ],
    "t2": [
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
        "..#2222222222222#.....",
        "..#22222222222222#....",
        ".#################....",
        "#23322332233223322#...",
        "#g#22#g#22#g#22#g##...",
        "#o222go222go222go2#...",
        ".#################....",
        "......................",
    ],
    "t3": [
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
        "..#2222222222222#.....",
        "..#22222222222222#....",
        ".#################....",
        "#32233223322332233#...",
        "#g2#22#g2#22#g2#22#...",
        "#22go222go222go222#...",
        ".#################....",
        "......................",
    ],
}

TANK_BARREL_22 = {
    "rest": [
        "......................",
        "......................",
        "................###...",
        "...............#gyg#..",
        "..............#g#g#g#.",
        ".............#w433go#.",
        "............#w43333g#.",
        "...........#43322##...",
        "...........#332#......",
        "...........#232#......",
        "............#22#......",
        "............#22#......",
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
    ],
    "elevate": [
        "......................",
        "..............###.....",
        ".............#wyw#....",
        "............#g#g#g#...",
        "............#433go#...",
        "...........#44333g#...",
        "..........#43322##....",
        "..........#332#.......",
        "...........#32#.......",
        "...........#22#.......",
        "...........#22#.......",
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
    ],
    "recoil_blast": [
        "................####..",
        "...............#ywy#..",
        "..............#wgywo#.",
        ".............#g#ywro#.",
        "............#w43gwry#.",
        "...........#w433o##...",
        "..........#43322#.....",
        "..........#3322#......",
        "..........#232#.......",
        "..........#222#.......",
        "..........#222#.......",
        "..........#####.......",
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
    ],
    "smoke": [
        "................####..",
        "...............#4w4#..",
        "..............#34w43#.",
        "..............#g#g#g#.",
        ".............#w433go#.",
        "............#w43333g#.",
        "...........#43322##...",
        "...........#332#......",
        "...........#232#......",
        "............#22#......",
        "............#22#......",
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
    ],
}


def build_tank_frame(
    tag: str, tread_pose: str, barrel_pose: str, hull_dy: int = 0, furnace_hot: bool = False
) -> Image.Image:
    treads = from_grid(TANK_TREADS_22[tread_pose])
    hull = from_grid(TANK_HULL_22, oy=hull_dy)
    if furnace_hot:
        hull = recolor_img(hull, {"r": "o", "g": "y"})
    barrel = from_grid(TANK_BARREL_22[barrel_pose], oy=hull_dy)
    lint_layer_seam(tag, hull, treads, "treads", min_overlap_px=12)
    lint_layer_seam(tag, hull, barrel, "barrel", min_overlap_px=4)
    return layer_stack(22, 22, [treads, hull, barrel])


def anim_tank() -> dict[str, list[Image.Image]]:
    idle = [
        build_tank_frame("tank_idle_0", "t0", "rest", 0, False),
        build_tank_frame("tank_idle_1", "t1", "rest", 1, True),
        build_tank_frame("tank_idle_2", "t2", "smoke", 1, True),
        build_tank_frame("tank_idle_3", "t3", "rest", 0, False),
    ]
    run = [
        build_tank_frame("tank_run_0", "t0", "rest", 0, False),
        build_tank_frame("tank_run_1", "t1", "rest", -1, True),
        build_tank_frame("tank_run_2", "t2", "smoke", 0, False),
        build_tank_frame("tank_run_3", "t3", "rest", -1, True),
    ]
    attack = [
        build_tank_frame("tank_attack_0", "t0", "elevate", 0, True),
        build_tank_frame("tank_attack_1", "t1", "recoil_blast", 1, True),
        build_tank_frame("tank_attack_2", "t2", "smoke", 0, True),
        build_tank_frame("tank_attack_3", "t3", "rest", 0, False),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 9. STAMPEDE BULL (22x22) - Grounded heavy charging bull with front + hind legs
# ===========================================================================

BULL_BODY_22 = [
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    ".......#######........",
    ".....##ttttbbb##......",
    "...##bbttttbbbb##.....",
    "..#bbbbbttbbbbbb#.....",
    ".##ubbbbbbbbbbbb#.....",
    "#u#ubbbbbbbbbbbb#.....",
    "#b#ubbbbbbbbbbbu#.....",
    ".##uubbbbbbbbbuu#.....",
    "..#uuubbbbbbbuuu#.....",
    "...#uuuuuuuuuuu#......",
    "....###########.......",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
]

# Hind legs (x=3..7) and Front legs (x=10..14) start UP at y=12 (4 rows inside body y=5..15!)
BULL_LEGS_22 = {
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
        "...#ubbb#.#bbbu#......",
        "...#ubb#...#bbu#......",
        "...#ub#....#bbu#......",
        "...#ub#....#bu#.......",
        "...#ub#....#bu#.......",
        "...#23#....#32#.......",
        "...#23#....#32#.......",
        "...####....####.......",
        "......................",
        "......................",
    ],
    "paw_back": [
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
        "...#ubbb#.#bbbu#......",
        "...#ubb#...#bbu#......",
        "...#ub#...#bbu#.......",
        "...#ub#..#bu#.........",
        "...#ub#..#32#.........",
        "...#23#..####.........",
        "...#23#...............",
        "...####...............",
        "......................",
        "......................",
    ],
    "gallop_open": [
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
        "...#ubbb#.#bbbu#......",
        "..#ubb#....#bbu#......",
        ".#ub#.......#bbu#.....",
        ".#ub#........#bu#.....",
        "#23#..........#32#....",
        "#23#..........#32#....",
        "####..........####....",
        "......................",
        "......................",
        "......................",
    ],
    "gallop_tuck": [
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
        "...#ubbb#.#bbbu#......",
        "....#ubb#.#bbu#.......",
        "....#ub#...#bu#.......",
        ".....#ub#.#bu#........",
        ".....#23#.#32#........",
        ".....#23#.#32#........",
        ".....####.####........",
        "......................",
        "......................",
        "......................",
    ],
}

# Head attaches cleanly to front shoulder x=10..15, y=6..14
BULL_HEAD_22 = {
    "rest": [
        "......................",
        "......................",
        "...........#.....#....",
        "..........#w#...#w#...",
        "..........#tw###wt#...",
        "...........#tbbbt#....",
        "..........#bbbbbbb#...",
        "..........#bbtbbbb#...",
        "..........#bb#r#bb#...",
        "..........#b#23332#...",
        "..........#u#2#3#2#...",
        "...........##ggggg#...",
        "............#g###g#...",
        ".............#ggg#....",
        "..............###.....",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
    ],
    "snort_big": [
        "......................",
        "......................",
        "...........#.....#....",
        "..........#w#...#w#...",
        "..........#tw###wt#...",
        "...........#tbbbt#....",
        "..........#bbbbbbb#...",
        "..........#bbtbbbb#...",
        "..........#bb#y#bb#...",
        "..........#b#23332##..",
        "..........#u#2#3#2w4#.",
        "...........##ggggg#w#.",
        "............#g###g###.",
        ".............#ggg#....",
        "..............###.....",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
    ],
    "gore_low": [
        "......................",
        "......................",
        "......................",
        "......................",
        "............#.....#...",
        "...........#w#...#w#..",
        "..........##tw###wt#..",
        "..........#btbbbbt#...",
        "..........#bbbbbbb#...",
        "..........#bb#y#bb#...",
        "..........#u#23332#...",
        "...........##2#3#2#...",
        "............#ggggg#...",
        "............#g###g#...",
        ".............#ggg#....",
        "..............###.....",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
    ],
    "horn_toss": [
        "......................",
        "..........#.......#...",
        ".........#w#.....#w#..",
        ".........#tw#...#wt#..",
        "..........#tb###bt#...",
        "..........#bbbbbbb#...",
        "..........#bbtbbbb##..",
        "..........#bb#y#bb#y#.",
        "..........#b#23332#w#.",
        "..........#u#2#3#2##..",
        "...........##ggggg#...",
        "............#g###g#...",
        ".............#ggg#....",
        "..............###.....",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
        "......................",
    ],
}


def build_bull_frame(tag: str, leg_pose: str, head_pose: str, body_dy: int = 0) -> Image.Image:
    legs = from_grid(BULL_LEGS_22[leg_pose])
    body = from_grid(BULL_BODY_22, oy=body_dy)
    head = from_grid(BULL_HEAD_22[head_pose], oy=body_dy)
    lint_layer_seam(tag, body, legs, "legs", min_overlap_px=6)
    lint_layer_seam(tag, body, head, "head", min_overlap_px=12)
    return layer_stack(22, 22, [legs, body, head])


def anim_bull() -> dict[str, list[Image.Image]]:
    idle = [
        build_bull_frame("bull_idle_0", "idle", "rest", 0),
        build_bull_frame("bull_idle_1", "paw_back", "snort_big", 0),
        build_bull_frame("bull_idle_2", "idle", "snort_big", 1),
        build_bull_frame("bull_idle_3", "idle", "rest", 0),
    ]
    run = [
        build_bull_frame("bull_run_0", "gallop_open", "rest", 0),
        build_bull_frame("bull_run_1", "gallop_tuck", "snort_big", -1),
        build_bull_frame("bull_run_2", "paw_back", "gore_low", 0),
        build_bull_frame("bull_run_3", "gallop_tuck", "rest", -1),
    ]
    attack = [
        build_bull_frame("bull_attack_0", "idle", "gore_low", 1),
        build_bull_frame("bull_attack_1", "gallop_open", "gore_low", 0),
        build_bull_frame("bull_attack_2", "gallop_tuck", "horn_toss", -1),
        build_bull_frame("bull_attack_3", "idle", "rest", 0),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 10. CRIMSON LICH KING BOSS (32x32) - centered legs/tassets, connected blade cleave
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
        "................................",
        "................................",
        ".......######...................",
        "......#Rrrrr#...................",
        ".....#Rorrrr#...................",
        "....#Roorrrrr#..................",
        "...#RorrrrrrrR#.................",
        "..#RoorrrrrrrRR#................",
        "..#RorrrrrrrrrRR#...............",
        ".#RoorrrrrrrrrRR#...............",
        ".#RorrrrrrrrrrrR#...............",
        ".#RrrrrrrrrrrrrR#...............",
        "..#RrrrrrrrrRRR#................",
        "..#RrrrrRRrrRR#.................",
        "..#RR#Rr#RRRR#..................",
        "...#..##..###...................",
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
        "................................",
        "................................",
        ".......######...................",
        "......#Rrrrr#...................",
        ".....#Rorrrr#...................",
        "....#Roorrrrr#..................",
        "...#RorrrrrrrR#.................",
        "..#RoorrrrrrrRR#................",
        ".#RoorrrrrrrrrRR#...............",
        "#RoorrrrrrrrrrrR#...............",
        "#RorrrrrrrrrrrrR#...............",
        ".#RrrrrrrrrrrrrR#...............",
        ".#RRrrrrrrrrRRR#................",
        "..#RrrrrRRrrRR#.................",
        "...#RR#Rr#RRR#..................",
        "....#..##..##...................",
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
        "................................",
        "................................",
        ".......######...................",
        "......#Rrrrr#...................",
        ".....#Rorrrr#...................",
        "....#Roorrrrr#..................",
        "...#RorrrrrrrR#.................",
        "..#RoorrrrrrrRR#................",
        ".#RorrrrrrrrrrRR#...............",
        ".#RorrrrrrrrrrRR#...............",
        "#RorrrrrrrrrrrrR#...............",
        "#RrrrrrrrrrrrrrR#...............",
        ".#RrrrrrrrrrRRR#................",
        "..#RRrrrRRrrRR#.................",
        "..#R##Rr##RRRR#.................",
        "......###..##...................",
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
        "................................",
        "................................",
        ".......######...................",
        "......#Rrrrr#...................",
        ".....#Rorrrr#...................",
        "....#Roorrrrr#..................",
        "...#RorrrrrrrR#.................",
        "..#RoorrrrrrrRR#................",
        "..#RorrrrrrrrrRR#...............",
        ".#RoorrrrrrrrrRR#...............",
        ".#RorrrrrrrrrrrR#...............",
        "..#RorrrrrrrrrRR#...............",
        "..#RrrrrrrrrRRR#................",
        "..#RrrrrRRrrRR#.................",
        "...#RR#Rr#RRR#..................",
        "....#..##..##...................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
    ],
]

# Both legs centered symmetrically at x=10..14 and x=17..21, starting UP at y=20 behind tassets!
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
        "..........#####..#####..........",
        "..........#2332..2332#..........",
        "..........#2332..2332#..........",
        ".........#2332#..#2332#.........",
        ".........#2332#..#2332#.........",
        ".........#2432#..#2342#.........",
        ".........#2332#..#2332#.........",
        "........#23332#..#23332#........",
        "........#23332#..#23332#........",
        "........#######..#######........",
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
        "..........#####..#####..........",
        "..........#2332..2332#..........",
        ".........#2332#..#2332#.........",
        "........#2332#....#2332#........",
        "........#2432#....#2332#........",
        "........#2332#....#2332#........",
        ".......#23332#....######........",
        ".......#23332#..................",
        ".......#######..................",
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
        "..........#####..#####..........",
        "..........#2332..2332#..........",
        ".........#2332#..#2332#.........",
        ".........#2332#...#2332#........",
        ".........#2332#...#2342#........",
        ".........#2332#...#2332#........",
        ".........######...#23332#.......",
        "..................#23332#.......",
        "..................#######.......",
        "................................",
        "................................",
        "................................",
    ],
}

# Broad symmetrical torso + tasset skirt spanning x=10..21 down to y=23
BOSS_TORSO_32 = [
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
    "......#..................#......",
    ".....#4#................#3#.....",
    ".....#2g###..######..###g2#.....",
    "....#23322#.#rooooor#22332#.....",
    "....#23322#.#roorro#.#2332#.....",
    ".....######.#rorrro#.######.....",
    "..........#roorrrrrR#...........",
    "..........#roorrRrrR#...........",
    "..........#roorrRrrR#...........",
    "..........#ogggggggo#...........",
    "..........#ogggygggo#...........",
    ".........#RrrrrrrrrrR#..........",
    ".........#RRrrrrrrrRR#..........",
    ".........#RRr#rrr#rRR#..........",
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
    "................................",
    "................................",
    ".........#.....#.#.#...#........",
    "........#w#...#y#y#y#.#4#.......",
    ".......#24#...#ggggg#.#32#......",
    ".......#22###.#ggggg###22#......",
    "........#2###roooooor###2#......",
    "..........##roorrooor##.........",
    "...........#ro#y#r#y#r#.........",
    "...........#rroooooorr#.........",
    "...........#R#w#w#w#rR#.........",
    "............#RrrrrrrR#..........",
    "............#RrrrrrrR#..........",
    ".............########...........",
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

# Sword always includes right arm/gauntlet overlapping torso shoulder/chest x=20..23
BOSS_SWORD_32 = [
    [
        "................................",
        "................................",
        ".........................#......",
        "........................#y#.....",
        ".......................#oyo#....",
        ".......................#gwg#....",
        "......................#ogwgo#...",
        ".......................#gwg#....",
        ".......................#gwg#....",
        "......................#ogwg#....",
        ".......................#gwgo#...",
        ".......................#gwg#....",
        "......................#ogwg#....",
        "......................#gwgo#....",
        ".......................#gyg#....",
        "....................#r##gyg#....",
        "...................#ro##ggg#....",
        "..................#roooggggg#...",
        "..................#rr##ggggg#...",
        "...................###..#o#.....",
        "........................#g#.....",
        ".......................#ygy#....",
        "........................###.....",
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
        ".........................#......",
        "........................#o#.....",
        ".......................#gyg#....",
        "......................#ogwgo#...",
        ".......................#gwg#....",
        ".......................#gwgo#...",
        "......................#ogwg#....",
        ".......................#gwg#....",
        ".......................#gygo#...",
        "......................#ogwg#....",
        ".......................#gwgo#...",
        ".......................#gwg#....",
        "......................#ogyg#....",
        "....................#r##gyg#....",
        "...................#ro##ggg#....",
        "..................#roooggggg#...",
        "..................#rr##ggggg#...",
        "...................###..#o#.....",
        "........................#g#.....",
        ".......................#ygy#....",
        "........................###.....",
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
        "........................#.......",
        ".......................#y#......",
        ".......................#gwg#....",
        ".......................#gwgo#...",
        "......................#ogwg#....",
        ".......................#gwg#....",
        ".......................#gwgo#...",
        "......................#ogwg#....",
        ".......................#gwg#....",
        ".......................#gygo#...",
        "......................#ogwg#....",
        ".......................#gyg#....",
        "......................#ogygo#...",
        "....................#r##gyg#....",
        "...................#ro##ggg#....",
        "..................#roooggggg#...",
        "..................#rr##ggggg#...",
        "...................###..#o#.....",
        "........................#g#.....",
        ".......................#ygy#....",
        "........................###.....",
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
        ".........................#......",
        "........................#g#.....",
        ".......................#oyo#....",
        ".......................#gwg#....",
        ".......................#gwgo#...",
        "......................#ogwg#....",
        ".......................#gwg#....",
        ".......................#gygo#...",
        "......................#ogwg#....",
        ".......................#gwg#....",
        ".......................#gwgo#...",
        "......................#ogwg#....",
        ".......................#gyg#....",
        "....................#r##gyg#....",
        "...................#ro##ggg#....",
        "..................#roooggggg#...",
        "..................#rr##ggggg#...",
        "...................###..#o#.....",
        "........................#g#.....",
        ".......................#ygy#....",
        "........................###.....",
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
        # 4: Overhead windup hoisted high left above pauldron
        "................................",
        "....#...........................",
        "...#y#..........................",
        "..#oyo#.........................",
        "...#gwg#........................",
        "...#ogwgo#......................",
        "....#gwg#.......................",
        "....#gwg#.......................",
        ".....#gyg#......................",
        ".....#r#gg#.....................",
        "....#ro#ggg#....................",
        "....#roogggg#...................",
        ".....#rr#ggg#...................",
        "......###og#....................",
        ".........###....................",
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
    ],
    [
        # 5: Massive blazing diagonal cleave + continuous attached arc smear (zero detached dots!)
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        ".........................####...",
        "........................#wywo#..",
        ".......................#ogwyw#..",
        ".......................#o#gwyw#.",
        "......................##.#ogwy#.",
        "....................#r#...#gwy#.",
        "...................#ro#gg##gwy#.",
        "..................#rooggggggwy#.",
        "...................#rr#gggggwy#.",
        "....................###.#gygwy#.",
        "........................#gwgwy#.",
        ".........................#ogwy#.",
        "..........................#gwy#.",
        "...........................#yo#.",
        "............................##..",
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
    ],
    [
        # 6: Low slamming follow-through cleave with attached golden ground burst
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
        "....................#r#.........",
        "...................#ro#gggg#....",
        "..................#roogggggg#...",
        "...................#rr#ggggg#...",
        "....................###.#gyg#...",
        ".........................#gwg#..",
        ".........................#ogwg#.",
        "..........................#gwgo#",
        "..........................#gygo#",
        ".........................#wyyo#.",
        "........................#oywy#..",
        ".........................####...",
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


def build_boss_frame(
    tag: str,
    cape_idx: int,
    leg_pose: str,
    torso_dy: int,
    head_dy: int,
    sword_idx: int,
    flare: bool = False,
) -> Image.Image:
    cape = from_grid(BOSS_CAPE_32[cape_idx], w=32, h=32, oy=torso_dy)
    legs = from_grid(BOSS_LEGS_32[leg_pose], w=32, h=32)
    torso = from_grid(BOSS_TORSO_32, w=32, h=32, oy=torso_dy)
    head = from_grid(BOSS_HEAD_32, w=32, h=32, oy=head_dy)
    sword = from_grid(BOSS_SWORD_32[sword_idx], w=32, h=32, oy=torso_dy)
    if flare:
        torso = recolor_img(torso, {"r": "o", "o": "g"})
    lint_layer_seam(tag, torso, legs, "legs", min_overlap_px=8)
    lint_layer_seam(tag, torso, head, "head", min_overlap_px=10)
    lint_layer_seam(tag, torso, cape, "cape", min_overlap_px=6)
    lint_layer_seam(tag, torso, sword, "sword", min_overlap_px=4)
    return layer_stack(32, 32, [cape, legs, torso, head, sword])


def anim_boss() -> dict[str, list[Image.Image]]:
    idle = [
        build_boss_frame("boss_idle_0", 0, "idle", 0, 0, 0),
        build_boss_frame("boss_idle_1", 1, "idle", 1, 0, 1),
        build_boss_frame("boss_idle_2", 2, "idle", 1, 1, 2),
        build_boss_frame("boss_idle_3", 3, "idle", 0, 1, 3),
    ]
    run = [
        build_boss_frame("boss_run_0", 1, "step_l", -1, 0, 1),
        build_boss_frame("boss_run_1", 2, "idle", 0, -1, 2),
        build_boss_frame("boss_run_2", 3, "step_r", -1, 0, 3),
        build_boss_frame("boss_run_3", 0, "idle", 0, 0, 0),
    ]
    attack = [
        build_boss_frame("boss_attack_0", 1, "idle", -1, -1, 4),
        build_boss_frame("boss_attack_1", 2, "step_l", 0, 0, 5, flare=True),
        build_boss_frame("boss_attack_2", 3, "step_r", 1, 1, 6),
        build_boss_frame("boss_attack_3", 0, "idle", 0, 0, 1),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 11. BONE ARCHER (16x16) - ranger hood, crisp skeleton, unmistakable bow draw & loose
# ===========================================================================

ARCHER_TORSO_16 = [
    "................",
    ".##.#####.......",
    "#rr##ubtbu#.....",
    ".#b##twttw#.....",
    "..#b#t#o#o#.....",
    "...##wttt##.....",
    "...##twtt#......",
    "...#u#wtw###....",
    "..#u#w#w#t##....",
    "..#t#tttt##.....",
    "...##t###t#.....",
    "....#twt#.......",
    "................",
    "................",
    "................",
    "................",
]

# Bone pelvis & femurs start UP at y=9 (3 rows behind ribcage y=1..11) -> >=5px overlap!
ARCHER_LEGS_16 = {
    "idle": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....#twt#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "...#u#.#u#......",
        "...###.###......",
    ],
    "step_l": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....#twt#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "...#t#..#t#.....",
        "..#u#...###.....",
        "..###...........",
    ],
    "step_r": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....#twt#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "....#t#.#t#.....",
        "....###..#u#....",
        ".........###....",
    ],
    "brace": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....#twt#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "....#t#t#.......",
        "...#t#..#t#.....",
        "..#u#....#u#....",
        "..###....###....",
    ],
}

# Oak bow + steel-tipped arrow matching arrow_0/arrow_1, connected cleanly via bow-arm
ARCHER_BOW_16 = {
    "rest": [
        "................",
        "................",
        "..........###...",
        "..........#t#...",
        "...........#t#..",
        "..........4.#t#.",
        "..........4..#b#",
        ".........#4..#b#",
        "........#tt##4b#",
        ".........#4..#b#",
        "..........4.#t#.",
        "..........#t#...",
        "..........###...",
        "................",
        "................",
        "................",
    ],
    "lower": [
        "................",
        "................",
        "................",
        "..........###...",
        "..........#t#...",
        "...........#t#..",
        "..........4.#t#.",
        ".........#4..#b#",
        "........#tt##4b#",
        ".........#4..#b#",
        "..........4.#t#.",
        "..........#t#...",
        "..........###...",
        "................",
        "................",
        "................",
    ],
    "draw_half": [
        "................",
        "..........###...",
        "..........#t#...",
        "..........4#t#..",
        ".........44.#t#.",
        ".........4...#b#",
        "........#r#tt4w#",
        ".......#rwttttw#",
        "........#r#..#b#",
        ".........44.#t#.",
        "..........#t#...",
        "..........###...",
        "................",
        "................",
        "................",
        "................",
    ],
    "draw_full": [
        "................",
        ".........###....",
        ".........#t#....",
        ".........4#t#...",
        "........44.#t#..",
        "........4...#b#.",
        ".......#r####4w#",
        "......#rwttttww#",
        ".......#r####4b#",
        "........4..#t#..",
        "........44#t#...",
        ".........###....",
        "................",
        "................",
        "................",
        "................",
    ],
    "loose_flash": [
        "................",
        "..........###...",
        "...........#t#..",
        "............#t#.",
        "............4#t#",
        "............4#w#",
        "........####4yw#",
        "........#ttw4ww#",
        "........####4yw#",
        "............4#b#",
        "...........#t#..",
        "..........###...",
        "................",
        "................",
        "................",
        "................",
    ],
}


def build_archer_frame(
    tag: str, leg_pose: str, bow_pose: str, torso_dy: int = 0, eye_bright: bool = False
) -> Image.Image:
    legs = from_grid(ARCHER_LEGS_16[leg_pose])
    torso = from_grid(ARCHER_TORSO_16, oy=torso_dy)
    if eye_bright:
        torso = recolor_img(torso, {"o": "y"})
    bow = from_grid(ARCHER_BOW_16[bow_pose], oy=min(0, torso_dy))
    lint_layer_seam(tag, torso, legs, "legs", min_overlap_px=4)
    lint_layer_seam(tag, torso, bow, "bow", min_overlap_px=3)
    return layer_stack(16, 16, [legs, torso, bow])


def anim_archer() -> dict[str, list[Image.Image]]:
    idle = [
        build_archer_frame("archer_idle_0", "idle", "rest", 0, False),
        build_archer_frame("archer_idle_1", "idle", "lower", 1, True),
        build_archer_frame("archer_idle_2", "idle", "rest", 1, True),
        build_archer_frame("archer_idle_3", "idle", "lower", 0, False),
    ]
    run = [
        build_archer_frame("archer_run_0", "step_l", "lower", 0, False),
        build_archer_frame("archer_run_1", "idle", "rest", -1, True),
        build_archer_frame("archer_run_2", "step_r", "lower", 0, False),
        build_archer_frame("archer_run_3", "idle", "rest", -1, False),
    ]
    attack = [
        build_archer_frame("archer_attack_0", "brace", "draw_half", 0, True),
        build_archer_frame("archer_attack_1", "brace", "draw_full", 0, True),
        build_archer_frame("archer_attack_2", "step_l", "loose_flash", -1, True),
        build_archer_frame("archer_attack_3", "idle", "rest", 0, False),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 12. EMBER IMP (16x16) - whole-frame wingbeat, flank swoop & fiery ember dart
# ===========================================================================

IMP_UPSTROKE_16 = [
    "................",
    ".#..#......#..#.",
    "#p##w#....#w##p#",
    "#p#p#V#..#V#p#p#",
    "#pr##pp##pp##rp#",
    ".###pVpppVVp###.",
    "....#p#ypp#y#...",
    "....#Vp####w#...",
    ".....#VppppV#...",
    "..##.#VppppV#...",
    ".#oV##VRVVVR#...",
    ".##..#R#..#R#...",
    ".....#R#..#R#...",
    ".....#V#..#V#...",
    ".....##....##...",
    "................",
]

IMP_MID_16 = [
    "................",
    "....#......#....",
    ".#..#w....#w..#.",
    "#p#.#V#..#V#.#p#",
    "#pV##pp##pp##Vp#",
    "#rp#pVpppVVp#pr#",
    "#RV#p#ypp#yp#VR#",
    ".#R#Vp####wp#R#.",
    "..##R#VppV##R#..",
    "...#RVppppVR#...",
    "..#p#VRVVVRV#...",
    "..##.#R#R#.#p#..",
    ".#V#.#R#R#..#...",
    "#pVp##R.#R#.....",
    ".##..#V#.#V#....",
    ".....##...##....",
]

IMP_DOWNSTROKE_16 = [
    "................",
    "................",
    "....#......#....",
    "....#w#..#w#....",
    "....#V####V#....",
    "....#ypppVV#....",
    "...#p#ypp#y#....",
    "..#rp#V##wVp#...",
    ".#rpp#VppV#pr#..",
    "#RVp##pppp##pR#.",
    "#VR#.#VRVV#.#VR#",
    ".##.#.#R#R#..##.",
    "...#p##R#R#.....",
    "...###.#V#V#....",
    "......##.##.....",
    "................",
]

IMP_CHARGE_16 = [
    "................",
    ".#..#......#..#.",
    "#p##w#....#t##V#",
    "#V#p#V#..#V#p#R#",
    "#pR##pp##pV##RV#",
    ".###p#ypp#yV###.",
    "....#Vp####w#...",
    "....#VV#ro#V#...",
    "..##.#V#yw#V#...",
    ".#oV##VRooVR#...",
    ".##..#R#..#R#...",
    ".....#R#..#R#...",
    ".....#V#..#V#...",
    ".....##....##...",
    "................",
    "................",
]

# Wing swoop launching an unmistakable fiery ember dart right (+X)
IMP_DART_LAUNCH_16 = [
    "................",
    "....#......#....",
    "#p#.#w#..#t#....",
    "#Vp##V#..#V##...",
    "#Rp#pVpppVVp#...",
    ".###p#ypp#yV#...",
    "....#Vp####w##..",
    "....#VVVVV#oo##.",
    "..##.#Vpp#royww#",
    ".#oV##VRV#royyw#",
    ".##..#R#.##oo##.",
    ".....#V#..#V#...",
    ".....##....##...",
    "................",
    "................",
    "................",
]

IMP_RECOIL_PUFF_16 = [
    "................",
    "................",
    "....#......#....",
    "....#w#..#t#....",
    "....#V####V#....",
    "....#ypppVV#....",
    "...#V#ypp#y###..",
    "..#Rp#V##wV#oy#.",
    ".#Rpp#VVVV#ryw#.",
    "#RVp##pppp##oy#.",
    "#VR#.#VRVV#.###.",
    ".##.#.#R#R#.....",
    "...#p##R#R#.....",
    "...###.#V#V#....",
    "......##.##.....",
    "................",
]


def anim_imp() -> dict[str, list[Image.Image]]:
    up = from_grid(IMP_UPSTROKE_16)
    mid = from_grid(IMP_MID_16)
    down = from_grid(IMP_DOWNSTROKE_16)
    charge = from_grid(IMP_CHARGE_16)
    launch = from_grid(IMP_DART_LAUNCH_16)
    recoil = from_grid(IMP_RECOIL_PUFF_16)

    idle = [up, mid, down, mid]
    run = [shift_img(down, dy=-1), mid, shift_img(up, dy=-1), down]
    attack = [charge, launch, recoil, mid]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 13. WORLD CHEST + MIMIC WAKE + CHOMPING MIMIC (16x16) - Hearth & Slate oak/gold
# ===========================================================================

CHEST_CLOSED_16 = [
    "................",
    "................",
    "................",
    "..############..",
    ".#gtttbbbbtttg#.",
    ".#gtbbbbbbbbtg#.",
    ".#gbb##gg##bbg#.",
    ".#g##gy##yg##g#.",
    ".#gbb##yy##bbg#.",
    ".#ubbbbbbbbbbu#.",
    ".#ubtbbbbbbtbu#.",
    ".#gbbubttbuubg#.",
    ".#gubbbbbbbbug#.",
    "..############..",
    "................",
    "................",
]

MIMIC_WAKE_FRAMES_16 = [
    # 0: 100% pixel-identical to chest_closed
    CHEST_CLOSED_16,
    # 1: lid cracks 1px open, crimson eyes glint in slit + ivory fangs gleam
    [
        "................",
        "................",
        "..############..",
        ".#gtttbbbbtttg#.",
        ".#gtbbbbbbbbtg#.",
        ".#g##R####R##g#.",
        ".##R#r####r#R##.",
        ".#w##gy##yg##w#.",
        ".#gbb##yy##bbg#.",
        ".#ubbbbbbbbbbu#.",
        ".#ubtbbbbbbtbu#.",
        ".#gbbubttbuubg#.",
        ".#gubbbbbbbbug#.",
        "..############..",
        "................",
        "................",
    ],
    # 2: lid hinged half open, jagged ivory teeth & plum tongue peeking out
    [
        "................",
        "..###########...",
        ".#gtttbbtbbbg#..",
        ".#gtbbbbbbtbg#..",
        ".#g#########g#..",
        ".#g#Rr###rR##g#.",
        ".#w#w##w##w#w#..",
        ".############...",
        ".#R#w#VVVV#w#g#.",
        ".#gbb#VpwV##bg#.",
        ".#ubbbbbbbbbbu#.",
        ".#gbbubttbuubg#.",
        ".#gubbbbbbbbug#.",
        "..############..",
        "................",
        "................",
    ],
    # 3: jaw flung wide with long sinuous amethyst tongue unfurling forward
    [
        "..###########...",
        ".#gtttbbtbbbg#..",
        ".#gtbbbbbbtbg#..",
        ".#g#########g#..",
        ".#g#Rr###rR##g#.",
        ".#w#w##w##w##R#.",
        ".###########p#..",
        ".#R##w###w#pVr#.",
        ".#gbb#VprV##bg#.",
        ".#gbb#Vprp#bbg#.",
        ".#gbb#g#pVr#bg#.",
        ".#ubbmb##pVrb#..".replace("m", "u"),
        ".#gbbbub##pVr#..",
        ".###########V#..",
        "............##..",
        "................",
    ],
]

MIMIC_SNAP_SHUT_16 = [
    "................",
    "................",
    "................",
    "..###########...",
    ".#gtttbbtbbbg#..",
    ".#gtbbbbbbtbg#..",
    ".#g#Rr###rR##g#.",
    ".#w#w##w##w##w#.",
    ".###########V#..",
    ".#gbb#Vprw##bg#.",
    ".#gbb#g#bg#bbg#.",
    ".#ubbub##bubbg#.",
    ".#gubbbbbbbbug#.",
    "..############..",
    "................",
    "................",
]

MIMIC_JAW_MID_16 = [
    "................",
    "..###########...",
    ".#gtttbbtbbbg#..",
    ".#gtbbbbbbtbg#..",
    ".#g#########g#..",
    ".#g#Rr###rR##g#.",
    ".#w#w##w##w#w#..",
    ".###########Vp#.",
    ".#R##w###w#pVr#.",
    ".#gbb#VprV#prb#.",
    ".#gbb#g##pVrbg#.",
    ".#ubbub##bp##g#.",
    ".#gubbbbbbbbug#.",
    "..############..",
    "................",
    "................",
]

MIMIC_JAW_WIDE_16 = MIMIC_WAKE_FRAMES_16[3]

MIMIC_TONGUE_WHIP_16 = [
    "..###########...",
    ".#gtttbbtbbbg#..",
    ".#gtbbbbbbtbg#..",
    ".#g#yr###ry##g#.",
    ".#w#w##w##w##R#.",
    ".############p#.",
    ".#R#w##w##w#pV##",
    ".#gbb#VprV##prw#",
    ".#gbb#Vprp#pVr#.",
    ".#gbb#g#pVrp#g#.",
    ".#ubbub##pVrb#..",
    ".#gbbbub##pVr#..",
    ".#gubbbb##prrV#.",
    "..#########Vprw#",
    "............###.",
    "................",
]

MIMIC_BITE_SLAM_16 = [
    "................",
    "................",
    "................",
    "..###########...",
    ".#gtttbbtbbbg#..",
    ".#gtbbbbbbtbg#..",
    ".#g#yw###wy##g#.",
    ".#w#w##w##w##w#.",
    ".############w#.",
    ".#gbb#Vprw##gy#.",
    ".#gbb#g#bg#bbw#.",
    ".#ubbub##bubbg#.",
    ".#gubbbbbbbbug#.",
    "..############..",
    "................",
    "................",
]


def anim_mimic() -> dict[str, list[Image.Image]]:
    shut = from_grid(MIMIC_SNAP_SHUT_16)
    mid = from_grid(MIMIC_JAW_MID_16)
    wide = from_grid(MIMIC_JAW_WIDE_16)
    whip = from_grid(MIMIC_TONGUE_WHIP_16)
    bite_slam = from_grid(MIMIC_BITE_SLAM_16)

    idle = [shut, mid, wide, mid]
    run = [wide, shut, whip, mid]
    attack = [shut, whip, bite_slam, wide]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 14. MAGMA GOLEM (24x24) - grounded basalt titan (bot_y=22), shoulder-locked fists
# ===========================================================================

GOLEM_TORSO_24 = [
    "........................",
    "........................",
    "........................",
    "........########........",
    ".......#43443333#.......",
    "......#233#y##y#2#......",
    "......#232#ooooo2#......",
    ".......#2########.......",
    "......#3o332233o3#......",
    "......#233g3333g2#......",
    "......#22#oogog#22#.....",
    "......#22#2#y#2#22#.....",
    "......#22##gog##22#.....",
    "......#22#2o#o2#22#.....",
    "......#22#2o#o2#22#.....",
    ".......#22#####22#......",
    ".......#222###222#......",
    "........................",
    "........................",
    "........................",
    "........................",
    "........................",
    "........................",
    "........................",
]

# Basalt pillars start UP at y=13 (4 rows inside torso y=3..16) -> >=9px overlap per leg!
GOLEM_LEGS_24 = {
    "idle": [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        ".......#222#.#222#......",
        ".......#222#.#222#......",
        ".......#222#.#222#......",
        ".......#22#...#22#......",
        "......#223#...#322#.....",
        "......#2o2#...#2o2#.....",
        "......#243#...#342#.....",
        ".....#2233#...#3322#....",
        ".....#2233#...#3322#....",
        ".....######...######....",
        "........................",
    ],
    "stomp_l": [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        ".......#222#.#222#......",
        ".......#222#.#222#......",
        ".......#222#.#222#......",
        "......#22#....#22#......",
        ".....#223#....#322#.....",
        ".....#2o2#....#2o2#.....",
        "....#2433#....#332#.....",
        "....#2233#....#####.....",
        "....#2233#..............",
        "....######..............",
        "........................",
    ],
    "passing": [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        ".......#222#.#222#......",
        ".......#222#.#222#......",
        ".......#222#.#222#......",
        "......#223#..#322#......",
        "......#233#..#332#......",
        "......#2o2#..#2o2#......",
        "......#243#..#342#......",
        "......#233#..#332#......",
        "......#####..#####......",
        "........................",
        "........................",
    ],
    "stomp_r": [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        ".......#222#.#222#......",
        ".......#222#.#222#......",
        ".......#222#.#222#......",
        "......#22#....#22#......",
        "......#23#....#323#.....",
        "......#2o#....#2o2#.....",
        "......#23#....#3342#....",
        "......####....#3322#....",
        "..............#3322#....",
        "..............######....",
        "........................",
    ],
}

# Every arm connects directly into torso shoulders x=6..7 / x=16..17, y=8..13
GOLEM_ARMS_24 = {
    "rest": [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "..######........######..",
        ".#443222#......#222333#.",
        "#w44322#........#233233#",
        "#33322#..........#23322#",
        "#33232#..........#22322#",
        "#22#32#..........#23222#",
        "#2ogo2#..........#2o#22#",
        "#2ggo2#..........#2oo22#",
        "#22#22#..........#22#22#",
        ".#####............####..",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
    ],
    "swing_l": [
        "........................",
        "........................",
        "........................",
        "........................",
        ".######.................",
        "#443222#................",
        "#w44322#................",
        "#2ogo22#..........#####.",
        "#22#222#.........#22333#",
        ".######..........#33233#",
        ".................#23322#",
        ".................#2o#22#",
        ".................#2oo22#",
        ".................#22#22#",
        "..................####..",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
    ],
    "swing_r": [
        "........................",
        "........................",
        "........................",
        "........................",
        ".................######.",
        "................#223344#",
        "................#22334w#",
        ".#####..........#22ogo2#",
        "#33322#.........#222#22#",
        "#33233#..........######.",
        "#22332#.................",
        "#22#o2#.................",
        "#22oo2#.................",
        "#22#22#.................",
        ".####...................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
    ],
    "raise_both": [
        "........................",
        ".#####............#####.",
        "#44322#..........#22344#",
        "#2ogo2#..........#2ogo2#",
        "#2ggo2#..........#2ogg2#",
        "#22222#..........#22222#",
        ".#33222#........#22233#.",
        "..#22322#......#22322#..",
        "...#2232#......#2322#...",
        "....####........####....",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
    ],
    "slam_ground": [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "..#####..........#####..",
        ".#44322#........#22344#.",
        ".#33222#........#22233#.",
        ".#2232#..........#2322#.",
        ".#2232#..........#2322#.",
        "#44322#..........#22344#",
        "#2ogo2#..........#2ogo2#",
        "#2ggo2#..........#2ogg2#",
        "#22222#..........#22222#",
        "#2ogo2#..........#2ogo2#",
        "#ywo22#..........#22owy#",
        ".#####............#####.",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
    ],
}


def build_golem_frame(
    tag: str, leg_pose: str, arm_pose: str, torso_dy: int = 0, hot: bool = False
) -> Image.Image:
    legs = from_grid(GOLEM_LEGS_24[leg_pose])
    torso = from_grid(GOLEM_TORSO_24, oy=torso_dy)
    arms = from_grid(GOLEM_ARMS_24[arm_pose], oy=min(0, torso_dy))
    lint_layer_seam(tag, torso, legs, "legs", min_overlap_px=6)
    lint_layer_seam(tag, torso, arms, "arms", min_overlap_px=4)
    out = layer_stack(24, 24, [legs, torso, arms])
    if hot:
        out = recolor_img(out, {"o": "g", "g": "y", "y": "w"})
    return out


def anim_golem() -> dict[str, list[Image.Image]]:
    idle = [
        build_golem_frame("golem_idle_0", "idle", "rest", 0, False),
        build_golem_frame("golem_idle_1", "idle", "rest", 1, True),
        build_golem_frame("golem_idle_2", "idle", "swing_l", 1, True),
        build_golem_frame("golem_idle_3", "idle", "rest", 0, False),
    ]
    run = [
        build_golem_frame("golem_run_0", "stomp_l", "swing_r", 0, False),
        build_golem_frame("golem_run_1", "passing", "rest", -1, True),
        build_golem_frame("golem_run_2", "stomp_r", "swing_l", 0, False),
        build_golem_frame("golem_run_3", "passing", "rest", -1, False),
    ]
    attack = [
        build_golem_frame("golem_attack_0", "passing", "raise_both", -1, True),
        build_golem_frame("golem_attack_1", "idle", "slam_ground", 2, True),
        build_golem_frame("golem_attack_2", "idle", "swing_l", 1, True),
        build_golem_frame("golem_attack_3", "idle", "rest", 0, False),
    ]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 15. SPORE MYCONID (16x16) - whole-frame grids, teal-moss cap & attached spore burst
# ===========================================================================

MYCONID_BASE_16 = [
    "................",
    "....########....",
    "..##FllleppF##..",
    ".#FllFppFelleF#.",
    "#VllFpVpFllppV#.",
    "#VFllllllFllpV#.",
    "#VVVllllllVVVV#.",
    ".#VVVpVVVVpVV#..",
    "..#VV#wz##wz#V#.",
    "..####V####V###.",
    "....#wwwwwtt#...",
    "...#t#wwwww#t#..",
    "...##.#www#.##..",
    ".....#tw#wt#....",
    "....#b#..#b#....",
    "....###..###....",
]

MYCONID_TILT_L_16 = [
    "................",
    "..########......",
    ".#FllleppF##....",
    "#FllFppFelle#...",
    "#VllFpVpFllpV#..",
    "#VFllllllFllpV#.",
    ".#VVllllllVVVV#.",
    "..#VVpVVVVpVV#..",
    "..#VV#wz##wz#V#.",
    "...###V####V###.",
    "....#wwwwwtt#...",
    "...#t#wwwww#t#..",
    "...##.#www#.##..",
    ".....#tw#wt#....",
    "....#b#..#b#....",
    "....###..###....",
]

MYCONID_TILT_R_16 = [
    "................",
    "......########..",
    "....##FllleppF#.",
    "...#FllFppFelle#",
    "..#VllFpVpFllpV#",
    ".#VFllllllFllpV#",
    ".#VVVllllllVVV#.",
    "..#VVpVVVVpVV#..",
    "..#VV#wz##wz#V#.",
    "..####V####V###.",
    "....#wwwwwtt#...",
    "...#t#wwwww#t#..",
    "...##.#www#.##..",
    ".....#tw#wt#....",
    "....#b#..#b#....",
    "....###..###....",
]

MYCONID_SQUASH_16 = [
    "................",
    "................",
    "...##########...",
    ".##FllleppFll##.",
    "#FllFppFellepFF#",
    "#VFllllllFllppV#",
    "#VVVllllllVVVVV#",
    "#VVVVpVVVVpVVVV#",
    ".##VV#wz##wz#V#.",
    "..####V####V###.",
    "....#wwwwwtt#...",
    "...##twwwwwt##..",
    "....##twwwt##...",
    ".....#tw#wt#....",
    "....#b#..#b#....",
    "....###..###....",
]

MYCONID_STEP_L_16 = [
    "................",
    "..########......",
    ".#FllleppF##....",
    "#FllFppFelle#...",
    "#VllFpVpFllpV#..",
    "#VFllllllFllpV#.",
    ".#VVllllllVVVV#.",
    "..#VVpVVVVpVV#..",
    "..#VV#wz##wz#V#.",
    "...###V####V###.",
    "....#wwwwwtt#...",
    "...#t#wwwww#t#..",
    "...##.#www#.##..",
    "....#tw#.###....",
    "...#b#..........",
    "...###..........",
]

MYCONID_STEP_R_16 = [
    "................",
    "......########..",
    "....##FllleppF#.",
    "...#FllFppFelle#",
    "..#VllFpVpFllpV#",
    ".#VFllllllFllpV#",
    ".#VVVllllllVVV#.",
    "..#VVpVVVVpVV#..",
    "..#VV#wz##wz#V#.",
    "..####V####V###.",
    "....#wwwwwtt#...",
    "...#t#wwwww#t#..",
    "...##.#www#.##..",
    "....###.#wt#....",
    ".........#b#....",
    ".........###....",
]

MYCONID_HOP_16 = [
    "....########....",
    "..##Fzzzleel##..",
    ".#FllFppFelllF#.",
    "#VllFpVpFllppV#.",
    "#VFllllllFllpV#.",
    "#VVVllllllVVVV#.",
    ".#VVVpVVVVpVV#..",
    "..#VV#wz##wz#V#.",
    "..####V####V###.",
    "....#wwwwwtt#...",
    "...#t#wwwww#t#..",
    "...##.#www#.##..",
    ".....#tw#wt#....",
    "....#b#..#b#....",
    "....###..###....",
    "................",
]

# Attack F1: bold billowing attached spore crown erupting directly out of cap dome!
MYCONID_SPORE_BURST_16 = [
    "..###..##..###..",
    ".#lzl##zw##lzl#.",
    "#ezwzlzwwzlzwze#",
    "#FllFppFelleplF#",
    "#VllFpVpFllppV#.",
    "#VFllllllFllpV#.",
    "#VVVllllllVVVV#.",
    ".#VVVpVVVVpVV#..",
    "..#VV#wz##wz#V#.",
    "..####V####V###.",
    "....#wwwwwtt#...",
    "...#t#wwwww#t#..",
    "...##.#www#.##..",
    ".....#tw#wt#....",
    "....#b#..#b#....",
    "....###..###....",
]

# Attack F2: glowing spore clouds puffing wide from cap sides (100% 4-connected, # outlined)
MYCONID_SPORE_BILLOW_16 = [
    "....########....",
    "..##ezzllzze##..",
    ".#FzlFppFellzF#.",
    "#ezzlFpVpFlzzze#",
    "#lzwFllllllFwzl#",
    "#ezVVllllllVVze#",
    ".##VVpVVVVpVV##.",
    "..#VV#wz##wz#V#.",
    "..####V####V###.",
    "....#wwwwwtt#...",
    "...#t#wwwww#t#..",
    "...##.#www#.##..",
    ".....#tw#wt#....",
    "....#b#..#b#....",
    "....###..###....",
    "................",
]


def anim_myconid() -> dict[str, list[Image.Image]]:
    base = from_grid(MYCONID_BASE_16)
    tilt_l = from_grid(MYCONID_TILT_L_16)
    tilt_r = from_grid(MYCONID_TILT_R_16)
    squash = from_grid(MYCONID_SQUASH_16)
    step_l = from_grid(MYCONID_STEP_L_16)
    step_r = from_grid(MYCONID_STEP_R_16)
    hop = from_grid(MYCONID_HOP_16)
    burst = from_grid(MYCONID_SPORE_BURST_16)
    billow = from_grid(MYCONID_SPORE_BILLOW_16)

    idle = [base, tilt_l, squash, tilt_r]
    run = [step_l, squash, step_r, hop]
    attack = [squash, burst, billow, base]
    return {"idle": idle, "run": run, "attack": attack}


# ===========================================================================
# 16. NATIVE 1:1 PIXEL-ART PROJECTILES & SPORE PUFF EFFECTS
# ===========================================================================

# Archer arrow pointing right (+X), 12x5: feathered tail + oak shaft + steel/ivory broadhead
ARROW_0_12x5 = [
    ".##....##...",
    "#rw####44#..",
    "#bttttt4ww#.",
    "#rb####33#..",
    ".##....##...",
]

ARROW_1_12x5 = [
    "..##....##..",
    ".#rw####4w#.",
    "#bttttww44w#",
    ".#rb####34#.",
    "..##....##..",
]

# Imp fiery ember dart pointing right (+X), 10x6
EMBER_DART_0_10x6 = [
    "....###...",
    "..##ooy##.",
    "#Rrooyyww#",
    "#rrooyyww#",
    "..##Rro##.",
    "....###...",
]

EMBER_DART_1_10x6 = [
    "...###....",
    ".#rroyy##.",
    ".#Rrooyww#",
    "#rrooyyww#",
    ".#Rrooy##.",
    "...###....",
]

# Myconid soft teal-moss spore puff, 12x12
SPORE_PUFF_0_12x12 = [
    "....####....",
    "..##lzll##..",
    ".#lzzzllee#.",
    ".#zzwzllee#.",
    "#elzzeeFaeF#",
    "#eeleezzeeF#",
    "#FeeezzlaeF#",
    "#FFeezlleeF#",
    ".#FFeeeaee#.",
    ".#FFFeeFFF#.",
    "..##FFFF##..",
    "....####....",
]

SPORE_PUFF_1_12x12 = [
    "...######...",
    "..#lzzlll#..",
    ".#lzzzlzeF#.",
    "#elzwzleeaF#",
    "#eellzzeaeF#",
    "#FezllzleeF#",
    "#FezzwlaeeF#",
    "#FFeelzzpFF#",
    "#FFFeeaeFFF#",
    ".#FFFeeFFF#.",
    "..#FFFFFF#..",
    "...######...",
]

PROJECTILE_GRIDS: list[tuple[str, list[str]]] = [
    ("arrow_0", ARROW_0_12x5),
    ("arrow_1", ARROW_1_12x5),
    ("ember_dart_0", EMBER_DART_0_10x6),
    ("ember_dart_1", EMBER_DART_1_10x6),
    ("spore_puff_0", SPORE_PUFF_0_12x12),
    ("spore_puff_1", SPORE_PUFF_1_12x12),
]


# ===========================================================================
# PACKING, EXPORT, LINTING & FULL-FRAME QA PREVIEW
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


def shift_invariant_diff(a: Image.Image, b: Image.Image) -> int:
    """Return min differing pixel count across small integer shifts [-2..2]."""
    w, h = a.size
    pa = a.load()
    pb = b.load()
    best = w * h
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            diff = 0
            for y in range(h):
                for x in range(w):
                    bx, by = x - dx, y - dy
                    ca = pa[x, y]
                    cb = pb[bx, by] if (0 <= bx < w and 0 <= by < h) else (0, 0, 0, 0)
                    if ca != cb:
                        diff += 1
            if diff < best:
                best = diff
    return best


def pack_atlas(
    frames: list[tuple[str, Image.Image]], atlas_w: int = 512, pad: int = 2
) -> tuple[Image.Image, dict]:
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
            "version": "2.0",
            "image": "monsters_atlas.png",
            "format": "RGBA8888",
            "size": {"w": atlas_w, "h": total_h},
            "scale": "1",
        },
    }
    return atlas_img, atlas_json


def make_qa_preview(
    all_anims: list[tuple[str, dict[str, list[Image.Image]]]],
    wake_imgs: list[tuple[str, Image.Image]],
    proj_imgs: list[tuple[str, Image.Image]],
) -> Image.Image:
    """Render a 3x zoomed full-frame QA preview (all 191 frames) on Hearth & Slate floor."""
    scale = 3
    cols_show = [
        ("idle", 0), ("idle", 1), ("idle", 2), ("idle", 3),
        ("run", 0), ("run", 1), ("run", 2), ("run", 3),
        ("attack", 0), ("attack", 1), ("attack", 2), ("attack", 3),
    ]
    cell_w = 34 * scale
    cell_h = 34 * scale
    label_w = 132
    pad = 6
    header = 34
    pw = label_w + len(cols_show) * (cell_w + pad) + pad
    ph = header + (len(all_anims) + 1) * (cell_h + 6) + pad
    prev = Image.new("RGB", (pw, ph), (20, 19, 26))  # INK #14131a
    d = ImageDraw.Draw(prev)
    font = ImageFont.load_default()

    d.text(
        (pad, 6),
        "Dungeonle Hearth & Slate Monsters (191 frames: 15x12 + chest/wake + 6 projectiles @3x)",
        fill=(247, 223, 134),
        font=font,
    )
    for ci, (anim_name, fi) in enumerate(cols_show):
        d.text(
            (label_w + ci * (cell_w + pad) + 4, 20),
            f"{anim_name}_{fi}",
            fill=(150, 219, 110) if anim_name == "run" else (169, 182, 204),
            font=font,
        )

    floor_bg = (33, 35, 46)  # SLATE_0 #21232e
    cell_border = (67, 73, 94)  # SLATE_2 #43495e

    for ri, (skin, anims) in enumerate(all_anims):
        ry = header + ri * (cell_h + 6)
        sample = anims["idle"][0]
        d.text(
            (pad, ry + cell_h // 2 - 6),
            f"{ri + 1:02d}. {skin} ({sample.width}x{sample.height})",
            fill=(242, 239, 228),
            font=font,
        )
        for ci, (anim_name, fi) in enumerate(cols_show):
            cx = label_w + ci * (cell_w + pad)
            im = anims[anim_name][fi]
            im_z = im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)
            cell = Image.new("RGBA", (cell_w, cell_h), (*floor_bg, 255))
            cell.alpha_composite(im_z, ((cell_w - im_z.width) // 2, cell_h - im_z.height - 3))
            prev.paste(cell.convert("RGB"), (cx, ry))
            d.rectangle([cx, ry, cx + cell_w - 1, ry + cell_h - 1], outline=cell_border)

    # Bottom row: chest_closed + mimic_wake_0..3 + 6 projectile frames (11 items across 12 cols)
    extras = wake_imgs + proj_imgs
    ry = header + len(all_anims) * (cell_h + 6)
    d.text((pad, ry + cell_h // 2 - 6), "Wake + Projectiles", fill=(230, 168, 46), font=font)
    for ci, (label, im) in enumerate(extras):
        cx = label_w + ci * (cell_w + pad)
        z_scale = 4 if im.width <= 12 else scale
        im_z = im.resize((im.width * z_scale, im.height * z_scale), Image.Resampling.NEAREST)
        cell = Image.new("RGBA", (cell_w, cell_h), (*floor_bg, 255))
        cell.alpha_composite(im_z, ((cell_w - im_z.width) // 2, (cell_h - im_z.height) // 2 + 4))
        prev.paste(cell.convert("RGB"), (cx, ry))
        d.rectangle([cx, ry, cx + cell_w - 1, ry + cell_h - 1], outline=(138, 110, 68))
        d.text((cx + 3, ry + 2), label, fill=(247, 223, 134), font=font)

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
                fname = f"{skin}_{anim_name}_{idx}"
                sizes.add(im.size)
                lint_frame(fname, im, INK_RGBA)
                packed_list.append((fname, im))
            lint_grounding(skin, anim_name, frames)
            if anim_name in ("run", "attack"):
                min_diff = 18 if frames[0].width <= 16 else 30
                peak_diff = max(shift_invariant_diff(frames[0], frames[k]) for k in range(1, 4))
                assert peak_diff >= min_diff, (
                    f"{skin}_{anim_name} motion too small ({peak_diff} < {min_diff} shift-invariant px)"
                )
        assert len(sizes) == 1, f"{skin} frames must share identical dimensions, got {sizes}"

    chest_img = from_grid(CHEST_CLOSED_16)
    lint_frame("chest_closed", chest_img, INK_RGBA)
    packed_list.append(("chest_closed", chest_img))

    wake_imgs = [from_grid(g) for g in MIMIC_WAKE_FRAMES_16]
    assert chest_img.tobytes() == wake_imgs[0].tobytes(), "mimic_wake_0 must match chest_closed"
    for idx, im in enumerate(wake_imgs):
        lint_frame(f"mimic_wake_{idx}", im, INK_RGBA)
        packed_list.append((f"mimic_wake_{idx}", im))

    proj_imgs: list[tuple[str, Image.Image]] = []
    for pname, grid in PROJECTILE_GRIDS:
        im = from_grid(grid)
        lint_frame(pname, im, INK_RGBA)
        packed_list.append((pname, im))
        proj_imgs.append((pname, im))

    atlas_img, atlas_json = pack_atlas(packed_list)
    DUNGEON_DIR.mkdir(parents=True, exist_ok=True)
    atlas_img.save(OUT_PNG)
    OUT_JSON.write_text(json.dumps(atlas_json, indent=2) + "\n")
    print(f"Wrote {OUT_PNG} {atlas_img.size} and {OUT_JSON} ({len(packed_list)} frames, 0 lint warnings)")

    try:
        SCRATCH_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        wake_pairs = [("chest", chest_img)] + [(f"wake_{i}", im) for i, im in enumerate(wake_imgs)]
        qa_img = make_qa_preview(qa_list, wake_pairs, proj_imgs)
        qa_img.save(SCRATCH_PREVIEW)
        print(f"Wrote QA preview -> {SCRATCH_PREVIEW} {qa_img.size}")
    except OSError as err:
        print(f"Skipped QA preview: {err}")


if __name__ == "__main__":
    main()
