"""Shrink a bake for the web, in place.

    python tools/pack.py bake

Run with Blender's Python (bpy, pillow). Lightmaps PNG -> WebP (quality 92),
reflection probes HDR 1024x512 -> 512x256, and scene.json updated to match.
Mesh compression of room.glb is done separately with gltf-transform (see README).
"""
import bpy, sys, os, json
from PIL import Image

D = [a for a in sys.argv[1:] if not a.startswith("-")][0]
meta = json.load(open(os.path.join(D, "scene.json")))

for name, lm in meta["lightmaps"].items():
    src = os.path.join(D, lm["file"])
    if not src.endswith(".png"):
        continue
    dst = src[:-4] + ".webp"
    Image.open(src).save(dst, "WEBP", quality=92, method=6)
    os.remove(src)
    lm["file"] = os.path.basename(dst)
    print("lightmap", name, os.path.getsize(dst) // 1024, "KB")

for zone, f in meta.get("env", {}).items():
    p = os.path.join(D, f)
    img = bpy.data.images.load(p)
    if img.size[0] > 512:
        img.scale(512, 256)
        img.filepath_raw = p
        img.file_format = "HDR"
        img.save()
    print("probe", zone, os.path.getsize(p) // 1024, "KB")
    bpy.data.images.remove(img)

json.dump(meta, open(os.path.join(D, "scene.json"), "w"), indent=1)
print("packed", D)
