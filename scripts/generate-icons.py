"""Generates the app and tray icons from the logo geometry (see LogoMark.vue).

Run: python3 scripts/generate-icons.py   (requires Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

ACCENT = (110, 108, 255, 255)
WHITE = (255, 255, 255, 255)
GREEN = (62, 207, 142, 255)
OUT = Path(__file__).resolve().parent.parent / "resources" / "icons"
SS = 8  # supersampling factor for smooth edges


def logo(size: int, badge: bool = False) -> Image.Image:
    s = size * SS
    unit = s / 24  # the SVG is drawn on a 24x24 grid
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=6.5 * unit, fill=ACCENT)
    # Solid left half-disc: centre (10.75, 12), radius 5.5
    cx, cy, r = 10.75 * unit, 12 * unit, 5.5 * unit
    d.pieslice([cx - r, cy - r, cx + r, cy + r], 90, 270, fill=WHITE)
    # Outlined right half-ring: centre (13.25, 12), radius 4.65, stroke 1.9
    cx2, r2, w = 13.25 * unit, 4.65 * unit, 1.9 * unit
    d.arc([cx2 - r2, cy - r2, cx2 + r2, cy + r2], 270, 90, fill=WHITE, width=round(w))
    for y in (cy - r2, cy + r2):  # round caps
        d.ellipse([cx2 - w / 2, y - w / 2, cx2 + w / 2, y + w / 2], fill=WHITE)
    if badge:
        br = 4.2 * unit
        bx, by = s - br - 0.4 * unit, s - br - 0.4 * unit
        d.ellipse([bx - br - unit, by - br - unit, bx + br + unit, by + br + unit], fill=(11, 12, 15, 255))
        d.ellipse([bx - br, by - br, bx + br, by + br], fill=GREEN)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    logo(512).save(OUT / "icon.png")
    logo(256).save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    logo(32).save(OUT / "tray.png")
    logo(32, badge=True).save(OUT / "tray-active.png")
    logo(64).save(OUT / "tray@2x.png")
    logo(64, badge=True).save(OUT / "tray-active@2x.png")
    print(f"Icons written to {OUT}")


if __name__ == "__main__":
    main()
