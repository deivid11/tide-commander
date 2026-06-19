#!/usr/bin/env python3
"""Generate the extension icons (no external deps). A teal 'tide' wave on a dark
panel with a red alert dot — run: python3 generate.py"""
import math
import struct
import zlib
import os

BG = (27, 34, 48, 255)
WAVE = (35, 190, 180, 255)
ALERT = (226, 72, 61, 255)


def pixel(x, y, size):
    # red alert dot, top-right
    dx, dy = x - size * 0.72, y - size * 0.30
    if dx * dx + dy * dy < (size * 0.15) ** 2:
        return ALERT
    # teal sine wave band across the middle
    wy = size * 0.58 + size * 0.15 * math.sin((x / size) * math.pi * 2.0)
    if abs(y - wy) < size * 0.10:
        return WAVE
    return BG


def write_png(path, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: none
        for x in range(size):
            raw.extend(pixel(x, y, size))
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (16, 48, 128):
        write_png(os.path.join(here, f"icon{s}.png"), s)
        print(f"wrote icon{s}.png")
