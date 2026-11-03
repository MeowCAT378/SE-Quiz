"""Draw the original 32-pixel-grid portraits as lossless 64x64 PNGs."""

from pathlib import Path
import struct
import zlib

OUT = Path(__file__).resolve().parents[1] / "static" / "avatars"
OUT.mkdir(parents=True, exist_ok=True)


def png(path, rows, scale=1):
    width, height = len(rows[0]) * scale, len(rows) * scale
    raw = bytearray()
    for row in rows:
        pixels = b"".join(bytes(pixel) * scale for pixel in row)
        for _ in range(scale):
            raw.extend(b"\0" + pixels)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


T = (0, 0, 0, 0)
INK = (37, 39, 55, 255)
HIGHLIGHT = (255, 243, 222, 255)
SKINS = [
    ((244, 199, 152, 255), (207, 143, 113, 255)),
    ((139, 91, 72, 255), (97, 63, 60, 255)),
    ((210, 154, 114, 255), (161, 103, 82, 255)),
    ((113, 72, 60, 255), (77, 51, 53, 255)),
    ((231, 176, 132, 255), (182, 121, 97, 255)),
]

# Hair, light, clothing, accent, skin, hairstyle, accessories. Each portrait has
# its own silhouette and clothing details while sharing face placement and light.
PEOPLE = [
    ("#d9a448", "#ffe094", "#91c8e9", "#e8f5ff", 0, "long", "bow"),
    ("#272938", "#626078", "#73549f", "#b698d8", 3, "crop", "hood"),
    ("#78503f", "#af7557", "#54876d", "#f2dfb1", 1, "bob", "varsity"),
    ("#493a35", "#806557", "#be6942", "#e7a46b", 2, "curly", "zip"),
    ("#88929d", "#d7dce0", "#455c7c", "#96a5b9", 0, "wolf", "stripe"),
    ("#50382f", "#886150", "#e17f78", "#ffe4c5", 4, "pony", "sport"),
    ("#593d34", "#96755e", "#e5d9b9", "#b38c72", 2, "wavy", "round"),
    ("#332d35", "#69616b", "#4d9b9d", "#95dbd3", 1, "short", "beanie"),
    ("#38323b", "#766671", "#9a85bb", "#d7bfdc", 3, "braids", "lapel"),
    ("#4a342e", "#816253", "#6689a9", "#b5cce0", 4, "part", "overshirt"),
    ("#ae7189", "#e4afbc", "#484852", "#b0a8b3", 0, "short", "stripe"),
    ("#292b39", "#55566a", "#b65c50", "#ec9e7f", 2, "long", "clip"),
    ("#303039", "#66636a", "#c2a24d", "#f2d985", 3, "afro", "collar"),
    ("#42382e", "#796656", "#71835a", "#b2b98a", 1, "undercut", "lapel"),
    ("#93533f", "#cb8061", "#6bbdb3", "#a2e2d0", 4, "wavy", "collar"),
    ("#3a3c40", "#777b80", "#537bb2", "#a1bde0", 0, "short", "square"),
    ("#423145", "#786078", "#805477", "#c89cb6", 2, "curlylong", "collar"),
    ("#252d3b", "#426d9b", "#777e85", "#b3bcc2", 1, "side", "highlight"),
    ("#644b39", "#a8835f", "#56866e", "#9fc2a6", 4, "tousled", "headphones"),
    ("#323044", "#655d7b", "#e6dcc1", "#b6a987", 3, "part", "collar"),
]


def color(value):
    return tuple(bytes.fromhex(value.removeprefix("#"))) + (255,)


def portrait(spec):
    hair, hairlight, shirt, accent, skin_index, style, detail = spec
    hair, hairlight, shirt, accent = map(color, (hair, hairlight, shirt, accent))
    skin, shadow = SKINS[skin_index]
    skin_light = tuple(min(255, int(channel * 0.82 + 46)) for channel in skin[:3]) + (255,)
    shirt_shadow = tuple(int(channel * 0.72) for channel in shirt[:3]) + (255,)
    p = [[T for _ in range(32)] for _ in range(32)]

    def rect(x1, y1, x2, y2, c):
        for y in range(max(0, y1), min(32, y2)):
            for x in range(max(0, x1), min(32, x2)):
                p[y][x] = c

    # Torso: low shoulders, narrow neck and modest layered clothing.
    rect(11, 22, 21, 29, INK)
    rect(12, 22, 20, 27, shadow)
    rect(13, 22, 19, 26, skin)
    for y, inset in [(25, 7), (26, 5), (27, 4), (28, 3), (29, 3), (30, 2), (31, 2)]:
        rect(inset, y, 32 - inset, y + 1, INK)
        rect(inset + 1, y, 31 - inset, y + 1, shirt)
    rect(6, 29, 8, 31, accent)
    rect(24, 29, 26, 31, accent)
    rect(8, 29, 10, 31, shirt_shadow)
    rect(22, 30, 24, 32, shirt_shadow)
    if detail in ("collar", "overshirt", "varsity", "lapel"):
        rect(10, 25, 13, 28, accent)
        rect(19, 25, 22, 28, accent)
        rect(13, 26, 19, 27, INK)
    if detail == "bow":
        rect(11, 25, 21, 26, accent)
        rect(13, 26, 19, 27, HIGHLIGHT)
        rect(15, 26, 17, 28, hair)
    if detail == "hood":
        rect(9, 25, 12, 28, accent)
        rect(20, 25, 23, 28, accent)
        rect(13, 27, 14, 30, HIGHLIGHT)
        rect(18, 27, 19, 30, HIGHLIGHT)
    if detail in ("zip", "sport", "stripe"):
        rect(15, 27, 17, 32, accent)
        if detail == "sport":
            rect(8, 28, 11, 29, accent)
            rect(21, 28, 24, 29, accent)
    if detail == "headphones":
        rect(10, 25, 22, 28, INK)
        rect(11, 25, 14, 27, accent)
        rect(18, 25, 21, 27, accent)

    # Shared, deliberately blocky face and a consistent slight-left light.
    rect(11, 8, 21, 22, INK)
    rect(10, 11, 22, 18, INK)
    rect(11, 9, 20, 21, skin)
    rect(12, 19, 20, 22, shadow)
    rect(12, 10, 20, 19, skin)
    rect(12, 17, 14, 18, skin_light)
    rect(15, 11, 17, 12, skin_light)
    rect(10, 15, 12, 18, shadow)
    rect(20, 15, 22, 18, shadow)
    rect(12, 15, 15, 16, shadow)
    rect(17, 15, 20, 16, shadow)
    eye = (74, 130, 181, 255) if spec is PEOPLE[0] else INK
    rect(13, 14, 15, 15, eye)
    rect(18, 14, 20, 15, eye)
    rect(16, 16, 17, 18, shadow)
    rect(15, 19, 18, 20, INK)
    rect(16, 20, 18, 21, skin)

    # Hair is drawn as individual pixel clusters, not a filtered silhouette.
    rect(10, 6, 22, 11, INK)
    rect(11, 5, 20, 10, hair)
    rect(13, 4, 19, 8, hair)
    rect(12, 6, 16, 7, hairlight)
    rect(11, 8, 14, 12, hair)
    rect(19, 7, 21, 13, hair)
    if style in ("long", "braids", "curlylong"):
        rect(8, 10, 11, 25, INK)
        rect(9, 10, 11, 24, hair)
        rect(21, 9, 24, 26, INK)
        rect(21, 10, 23, 25, hair)
        rect(9, 13, 10, 16, hairlight)
        rect(22, 13, 23, 16, hairlight)
    if style == "bob":
        rect(8, 10, 11, 23, INK)
        rect(9, 10, 11, 22, hair)
        rect(21, 10, 24, 23, INK)
        rect(21, 10, 23, 22, hair)
        rect(9, 21, 12, 23, hairlight)
    if style in ("curly", "curlylong", "afro"):
        for x, y in [(8, 8), (10, 5), (13, 4), (17, 3), (21, 5), (23, 8), (9, 12), (21, 11)]:
            rect(x, y, x + 3, y + 3, INK)
            rect(x + 1, y, x + 3, y + 2, hair)
        if style == "afro":
            rect(8, 7, 24, 11, hair)
            rect(9, 5, 22, 8, hair)
            rect(10, 9, 13, 15, hair)
            rect(20, 9, 23, 15, hair)
        if style == "curlylong":
            rect(8, 17, 11, 25, hair)
            rect(21, 17, 24, 25, hair)
    if style == "crop":
        for x in [10, 13, 17, 20]:
            rect(x, 5 + x % 2, x + 2, 9, hairlight)
        rect(10, 10, 12, 12, hair)
    if style == "wolf":
        rect(9, 10, 12, 17, hair)
        rect(21, 9, 24, 18, hair)
        rect(8, 16, 11, 19, hairlight)
        rect(22, 17, 25, 21, hair)
        rect(13, 9, 17, 12, hairlight)
    if style == "wavy":
        rect(8, 11, 11, 19, hair)
        rect(9, 19, 12, 22, hairlight)
        rect(21, 10, 24, 17, hair)
        rect(20, 18, 23, 24, hairlight)
    if style == "pony":
        rect(22, 6, 26, 11, INK)
        rect(23, 7, 26, 20, hair)
        rect(23, 19, 25, 24, hairlight)
        rect(12, 8, 18, 10, hairlight)
    if style == "braids":
        for y in [15, 19, 23]:
            rect(8, y, 11, y + 2, hairlight)
            rect(21, y + 1, 24, y + 3, hairlight)
    if style == "part":
        rect(16, 5, 17, 8, HIGHLIGHT)
        rect(11, 8, 15, 11, hairlight)
        rect(18, 7, 22, 10, hairlight)
    if style == "side":
        rect(11, 7, 21, 10, hair)
        rect(11, 8, 18, 9, hairlight)
        rect(21, 10, 23, 18, hair)
    if style == "undercut":
        rect(10, 10, 12, 15, shadow)
        rect(12, 6, 21, 9, hairlight)
        rect(19, 8, 22, 12, hair)
    if style == "tousled":
        rect(9, 5, 13, 8, hair)
        rect(17, 3, 20, 7, hair)
        rect(21, 5, 24, 9, hair)
        rect(12, 8, 19, 9, hairlight)
    if detail == "beanie":
        rect(10, 4, 22, 7, accent)
        rect(9, 7, 23, 10, shirt)
        rect(13, 3, 19, 5, shirt)
    if detail in ("round", "square"):
        if detail == "round":
            rect(12, 13, 16, 17, INK)
            rect(17, 13, 21, 17, INK)
            rect(13, 14, 15, 16, skin)
            rect(18, 14, 20, 16, skin)
        else:
            rect(12, 13, 16, 16, INK)
            rect(17, 13, 21, 16, INK)
            rect(13, 14, 15, 15, skin)
            rect(18, 14, 20, 15, skin)
        rect(16, 14, 17, 15, INK)
        rect(13, 14, 15, 15, eye)
        rect(18, 14, 20, 15, eye)
    if detail == "clip":
        rect(19, 9, 22, 11, accent)
    if detail == "highlight":
        rect(19, 6, 21, 11, hairlight)
    return p


portraits = [portrait(spec) for spec in PEOPLE]
for i, pixels in enumerate(portraits, 1):
    png(OUT / f"avatar-{i:02}.png", pixels, 2)

# Nearest-neighbor contact sheet; intentionally outside the static asset set.
background = (223, 231, 232, 255)
sheet = [[background for _ in range(5 * 144)] for _ in range(4 * 164)]
for n, pixels in enumerate(portraits):
    ox, oy = n % 5 * 144 + 8, n // 5 * 164 + 8
    for y, row in enumerate(pixels):
        for x, pixel in enumerate(row):
            for dy in range(4):
                for dx in range(4):
                    if pixel != T:
                        sheet[oy + y * 4 + dy][ox + x * 4 + dx] = pixel
png(OUT / "contact-sheet.png", sheet)
