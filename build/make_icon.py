#!/usr/bin/env python3
"""
Draws the app icon from the source map data: the ring (the area the app
covers) with softened corners, the Schelde flowing past its west side, the
Leien as one curved boulevard, and the Stadspark - simple flat shapes in the
colours of the province of Antwerp's flag (red, white, yellow, blue).

    python3 build/make_icon.py

Writes:
    icons/icon.svg              master, full-bleed square (iOS rounds it)
    icons/favicon.svg           same with rounded corners, for browser tabs
    icons/apple-touch-icon.png  180 x 180, home-screen icon
    icons/favicon-32.png        32 x 32, for browsers without SVG favicons

Geometry comes straight from data/source/antwerp-inside-the-ring-data.json,
so re-run this after the ring boundary changes. PNGs are drawn with Pillow
(supersampled, then downscaled) from the same shapes as the SVG.
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source" / "antwerp-inside-the-ring-data.json"
OUT = ROOT / "icons"

# Province of Antwerp flag colours (adopted 1996/97)
RED = "#d81e05"
WHITE = "#ffffff"
YELLOW = "#f9dd16"
BLUE = "#0038a8"

PALETTE = {
    "background": WHITE,
    "city": RED,
    "river": BLUE,
    "leien": WHITE,
    "park": YELLOW,
}

SIZE = 1024  # master canvas
LEIEN = ["Italiëlei", "Frankrijklei", "Britselei", "Amerikalei"]  # north to south

data = json.loads(SRC.read_text())
LAT0 = 51.215
COS0 = math.cos(math.radians(LAT0))


def xy(p):
    """lon/lat -> metres east / north of an arbitrary origin"""
    return ((p[0] - 4.40) * COS0 * 111320.0, (p[1] - LAT0) * 111320.0)


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (ax, ay), (bx, by) = pts[0], pts[-1]
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = abs(dy * (px - ax) - dx * (py - ay)) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def rdp_closed(pts, eps):
    """simplify a closed ring: split it at the vertex farthest from the
    first one, simplify both halves, and join them again"""
    far = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))
    a = rdp(pts[: far + 1], eps)
    b = rdp(pts[far:] + [pts[0]], eps)
    return a[:-1] + b[:-1]


def chaikin(pts, rounds, closed):
    """corner cutting: each round replaces every corner with two points a
    quarter of the way along its edges - converges to a smooth curve"""
    for _ in range(rounds):
        out = []
        n = len(pts)
        rng = range(n) if closed else range(n - 1)
        if not closed:
            out.append(pts[0])
        for i in rng:
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
            out.append((0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1))
            out.append((0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1))
        if not closed:
            out.append(pts[-1])
        pts = out
    return pts


def principal_order(points):
    """order a cloud of street points along its main direction and average
    them into a clean centreline (streets are many parallel carriageways)"""
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    sxx = sum((p[0] - cx) ** 2 for p in points)
    syy = sum((p[1] - cy) ** 2 for p in points)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in points)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang)
    t = [((p[0] - cx) * ux + (p[1] - cy) * uy, p) for p in points]
    t.sort()
    bins = max(2, min(8, len(points) // 6))
    lo, hi = t[0][0], t[-1][0]
    out = []
    for b in range(bins):
        a0 = lo + (hi - lo) * b / bins
        a1 = lo + (hi - lo) * (b + 1) / bins
        sel = [p for s, p in t if a0 <= s <= a1]
        if sel:
            out.append((sum(p[0] for p in sel) / len(sel), sum(p[1] for p in sel) / len(sel)))
    return out


# ---------------------------------------------------------------- shapes (metres)

ring = [xy(p) for p in data["ring_boundary"][:-1]]
ring = chaikin(rdp_closed(ring, 90), 4, closed=True)

# The Schelde: in the data it *is* the ring's west edge (the quays), so the
# river is drawn as a band just outside that edge. Like the real river it
# comes up from the south past the Kennedy tunnel corner, runs along the
# quays, and bends away west past the north end of the city - off the tile
# at both ends.
raw_ring = [xy(p) for p in data["ring_boundary"][:-1]]


def west_edge(pts):
    """the ring's quay side: from its south-west corner (the first vertex)
    north until the boundary turns east along the docks"""
    edge = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        if b[0] - a[0] > 2.5 * abs(b[1] - a[1]):  # heading (nearly) east: past the quays
            break
        edge.append(b)
    return edge


def offset_west(pts, d):
    out = []
    for i, (x, y) in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1
        nx, ny = -ty / L, tx / L  # left of a south->north line = west
        out.append((x + nx * d, y + ny * d))
    return out


RIVER_W = 420  # metres - about the real Schelde's width here
RIVER_GAP = 120  # metres of background between the quay and the river band
quays = rdp(west_edge(raw_ring), 60)
centre = offset_west(quays, RIVER_GAP + RIVER_W / 2)
(x0, y0), (x1, y1) = centre[0], centre[1]
L = math.hypot(x1 - x0, y1 - y0)
south = [(x0 - (x1 - x0) / L * 3500, y0 - (y1 - y0) / L * 3500)]
xn, yn = centre[-1]
north = [(xn + 60, yn + 900), (xn - 700, yn + 1900), (xn - 4200, yn + 3100)]
river = chaikin(south + centre + north, 5, closed=False)

leien = []
for name in LEIEN:
    pts = [xy(p) for s in data["streets"] if s["name"] == name for l in s["lines"] for p in l]
    seg = principal_order(pts)
    # orient each piece to continue the chain
    if leien:
        last = leien[-1]
        if math.dist(seg[-1], last) < math.dist(seg[0], last):
            seg = seg[::-1]
    elif seg[0][1] < seg[-1][1]:
        seg = seg[::-1]  # start at the north end
    leien.extend(seg)
leien = chaikin(rdp(leien, 150), 5, closed=False)

park = next(p for p in data["parks"] if p["name"] == "Stadspark")
park = [xy(p) for p in park["ring"]]
park = chaikin(rdp_closed(park[:-1], 45), 3, closed=True)
PARK_SCALE = 1.7  # stylised: drawn larger than life so it reads at icon size
pcx = sum(p[0] for p in park) / len(park)
pcy = sum(p[1] for p in park) / len(park)
park = [(pcx + (x - pcx) * PARK_SCALE, pcy + (y - pcy) * PARK_SCALE) for x, y in park]

# ---------------------------------------------------------------- fit to canvas

xs = [p[0] for p in ring]
ys = [p[1] for p in ring]
span = max(max(xs) - min(xs), max(ys) - min(ys))
SCALE = SIZE * 0.74 / span
# centre the ring, nudged east to leave room for the river on the west
CX = (min(xs) + max(xs)) / 2 - span * 0.04
CY = (min(ys) + max(ys)) / 2


def px(p):
    return (SIZE / 2 + (p[0] - CX) * SCALE, SIZE / 2 - (p[1] - CY) * SCALE)


RING = [px(p) for p in ring]
RIVER = [px(p) for p in river]
LEIEN_PX = [px(p) for p in leien]
PARK = [px(p) for p in park]
RIVER_PX = RIVER_W * SCALE
LEIEN_PX_W = 34  # boulevard stroke, canvas px


def path_d(pts, closed):
    d = "M" + " L".join("%.1f,%.1f" % p for p in pts)
    return d + (" Z" if closed else "")


def svg(rounded):
    clip = ""
    bg = '<rect width="%d" height="%d" fill="%s"/>' % (SIZE, SIZE, PALETTE["background"])
    if rounded:
        r = SIZE * 0.22
        clip = '<clipPath id="tile"><rect width="%d" height="%d" rx="%d"/></clipPath>' % (SIZE, SIZE, r)
    body = (
        bg
        + '<path d="%s" fill="none" stroke="%s" stroke-width="%.1f" stroke-linecap="round" stroke-linejoin="round"/>'
        % (path_d(RIVER, False), PALETTE["river"], RIVER_PX)
        + '<path d="%s" fill="%s"/>' % (path_d(RING, True), PALETTE["city"])
        + '<path d="%s" fill="%s"/>' % (path_d(PARK, True), PALETTE["park"])
        + '<path d="%s" fill="none" stroke="%s" stroke-width="%d" stroke-linecap="round" stroke-linejoin="round"/>'
        % (path_d(LEIEN_PX, False), PALETTE["leien"], LEIEN_PX_W)
    )
    if rounded:
        body = '<defs>%s</defs><g clip-path="url(#tile)">%s</g>' % (clip, body)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">%s</svg>\n'
        % (SIZE, SIZE, SIZE, SIZE, body)
    )


def png(size, rounded, ss=4):
    S = size * ss
    k = S / SIZE
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if rounded:
        draw.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=PALETTE["background"])
    else:
        draw.rectangle((0, 0, S, S), fill=PALETTE["background"])
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)

    def stroke(pts, colour, width):
        # a thick line as a union of one quad per segment plus a disc at
        # every vertex (round joins and caps) - smoother than Pillow's wide
        # lines, and unlike a single offset outline it can't self-intersect
        q = [(x * k, y * k) for x, y in pts]
        r = width * k / 2
        for (x0, y0), (x1, y1) in zip(q, q[1:]):
            L = math.hypot(x1 - x0, y1 - y0) or 1
            nx, ny = -(y1 - y0) / L * r, (x1 - x0) / L * r
            ld.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=colour)
        for x, y in q:
            ld.ellipse((x - r, y - r, x + r, y + r), fill=colour)

    stroke(RIVER, PALETTE["river"], RIVER_PX)
    ld.polygon([(x * k, y * k) for x, y in RING], fill=PALETTE["city"])
    ld.polygon([(x * k, y * k) for x, y in PARK], fill=PALETTE["park"])
    stroke(LEIEN_PX, PALETTE["leien"], LEIEN_PX_W)
    if rounded:  # keep the shapes inside the rounded tile
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=255)
        layer.putalpha(Image.composite(layer.getchannel("A"), mask, mask).point(lambda v: v))
        layer = Image.composite(layer, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask)
    img.alpha_composite(layer)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    (OUT / "icon.svg").write_text(svg(rounded=False))
    (OUT / "favicon.svg").write_text(svg(rounded=True))
    png(180, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    png(32, rounded=True).save(OUT / "favicon-32.png", optimize=True)
    print("wrote", ", ".join(sorted(p.name for p in OUT.iterdir())))
