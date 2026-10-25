#!/usr/bin/env python3
"""Validate downloaded Siege art, crop generated sprites, and export budgeted WebP."""

import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
BUDGET = 300 * 1024


def encode(image):
    for quality in (92, 86, 80, 74, 68, 60):
        buffer = io.BytesIO()
        image.save(buffer, "WEBP", quality=quality, method=6, exact=True)
        if buffer.tell() <= BUDGET:
            return buffer.getvalue(), quality
    raise ValueError("Image exceeds the 300KiB budget after optimization")


def transparent_divisions(image, count, horizontal):
    length = image.width if horizontal else image.height
    alpha = image.getchannel("A")
    divisions = [0]
    for index in range(1, count):
        target = round(index * length / count)
        radius = max(1, round(length / count / 8))
        candidates = []
        for coordinate in range(max(1, target - radius), min(length, target + radius + 1)):
            strip = (coordinate, 0, coordinate + 1, image.height) if horizontal else (0, coordinate, image.width, coordinate + 1)
            if alpha.crop(strip).getextrema()[1] < 8:
                candidates.append(coordinate)
        if not candidates:
            raise ValueError(f"No transparent gap near sprite division {target}; inspect the source sheet")
        divisions.append(min(candidates, key=lambda value: abs(value - target)))
    return divisions + [length]


def sprite_bounds(image, columns, rows, animation_rows=False):
    xs = transparent_divisions(image, columns, True)
    ys = transparent_divisions(image, rows, False)
    cells = []
    for row in range(rows):
        for column in range(columns):
            bounds = (xs[column], ys[row], xs[column + 1], ys[row + 1])
            cell = image.crop(bounds)
            offset = (bounds[0] - round(column * image.width / columns), bounds[1] - round(row * image.height / rows))
            cells.append((cell, bounds, offset))
    # Restore nominal grid origins after moving cuts into actual transparent gaps.
    origin = (min(0, min(offset[0] for _, _, offset in cells)), min(0, min(offset[1] for _, _, offset in cells)))
    size = (
        max(cell.width + offset[0] - origin[0] for cell, _, offset in cells),
        max(cell.height + offset[1] - origin[1] for cell, _, offset in cells),
    )
    aligned = []
    for cell, bounds, offset in cells:
        position = (offset[0] - origin[0], offset[1] - origin[1])
        canvas = Image.new("RGBA", size)
        canvas.paste(cell, position)
        box = canvas.getchannel("A").point(lambda alpha: 255 if alpha >= 8 else 0).getbbox()
        if box is None:
            raise ValueError(f"Empty sprite at {bounds}")
        aligned.append((canvas, bounds, position, box))
    # Each character's frames share a crop; different characters keep their own anchor.
    groups = [aligned[row * columns:(row + 1) * columns] for row in range(rows)] if animation_rows else [aligned]
    tiles = []
    for group in groups:
        boxes = [box for _, _, _, box in group]
        crop = (
            min(box[0] for box in boxes) - 12, min(box[1] for box in boxes) - 12,
            max(box[2] for box in boxes) + 12, max(box[3] for box in boxes) + 12,
        )
        # Pillow pads out-of-bounds crops with transparency instead of clipping margins.
        tiles.extend((cell.crop(crop), bounds, crop, offset) for cell, bounds, offset, _ in group)
    return tiles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-directory", type=Path, default=ROOT / "docs/siege-art/source")
    parser.add_argument("--input-extension", choices=("png", "webp"), default="webp")
    parser.add_argument("--source-metadata", type=Path, required=True)
    parser.add_argument("--conversation", required=True)
    args = parser.parse_args()
    plan = json.loads((ROOT / "docs/siege-art/prompts.json").read_text())
    metadata = {item["id"]: item for item in json.loads(args.source_metadata.read_text())}
    exports, sources = [], []
    for asset in plan["assets"]:
        path = args.input_directory / f"{asset['id']}.{args.input_extension}"
        raw = path.read_bytes()
        receipt = metadata[asset["id"]]
        checksum = hashlib.sha256(raw).hexdigest()
        if len(raw) != receipt["bytes"] or checksum != receipt["sha256"]:
            raise ValueError(f"{asset['id']}: exported bytes do not match the website receipt")
        with Image.open(io.BytesIO(raw)) as source:
            source.load()
            image = source.convert("RGBA")
        if image.size != (receipt["width"], receipt["height"]):
            raise ValueError(f"{asset['id']}: exported dimensions do not match the website receipt")
        alpha = image.getchannel("A")
        transparent = alpha.histogram()[0] / (image.width * image.height)
        corners = [alpha.getpixel(point) for point in ((0, 0), (image.width - 1, 0), (0, image.height - 1), (image.width - 1, image.height - 1))]
        if asset["alpha"] and (transparent < 0.2 or any(corners) or alpha.getextrema()[1] == 0):
            raise ValueError(f"{asset['id']}: expected transparent margins and visible art")
        sources.append({
            "id": asset["id"], "sha256": checksum, "bytes": len(raw),
            "width": image.width, "height": image.height,
            "alpha": asset["alpha"], "transparentFraction": transparent,
            "original": {
                "file": receipt["sourceFilename"], "sha256": receipt["originalSHA256"],
                "width": receipt["originalWidth"], "height": receipt["originalHeight"],
                "location": "ChatGPT generation conversation; optimized WebP exported locally",
            },
        })
        if asset["kind"] == "sprite-sheet":
            layout = asset["layout"]
            tiles = sprite_bounds(image, layout["columns"], layout["rows"], layout.get("animationRows", False))
            for name, (tile, cell, crop, offset) in zip(layout["sprites"], tiles, strict=True):
                tile.thumbnail((512, 512) if name.startswith("castle-") else (256, 256), Image.Resampling.LANCZOS)
                exports.append((name, tile, asset["id"], {"cell": cell, "crop": crop, "alignmentOffset": offset}))
        else:
            size = (1120, 640) if asset["kind"] == "background" else (512, 512)
            exports.append((asset["id"], ImageOps.fit(image, size, Image.Resampling.LANCZOS), asset["id"], {}))
    # Validate every source and encode every output before writing runtime files.
    encoded, manifest = [], []
    for name, image, source, bounds in exports:
        data, quality = encode(image)
        encoded.append((name, data))
        manifest.append({
            "id": name, "file": f"{name}.webp", "source": source,
            "width": image.width, "height": image.height, "bytes": len(data),
            "quality": quality, "sha256": hashlib.sha256(data).hexdigest(), **bounds,
        })
    destination = ROOT / "apps/siege/public/art"
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in encoded:
        temporary = destination / f".{name}.webp.tmp"
        temporary.write_bytes(data)
        temporary.replace(destination / f"{name}.webp")
    (destination / "manifest.json").write_text(json.dumps({
        "game": "Doodle Siege", "channel": "ChatGPT website in the built-in browser",
        "conversation": args.conversation, "sources": sources, "assets": manifest,
    }, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"assets": len(encoded), "bytes": sum(len(data) for _, data in encoded)}))


if __name__ == "__main__":
    main()
