"""Bake the villa's light in Blender Cycles.

    python tools/bake.py build/scene.json bake [samples] [lightmap_px] [probe_samples]

Run with Blender's Python (the `bpy` module). Reads the geometry and lights the
page exports (tools/shoot.mjs export), rebuilds them in Blender with physically
based materials, a sky, the sun and the lamps, and writes into <out>:

  lm_<zone>.png    one lightmap atlas per walked zone: diffuse irradiance (direct and
                   bounced), denoised, sRGB-encoded after dividing by `scale`
  env_<zone>.hdr   a 360 capture from inside each zone, for reflections
  room.glb         the baked meshes with a second UV set (the lightmap UVs)
  scene.json       what the page needs to put it together

The page multiplies a lightmap by scale * pi (three.js divides diffuse light by pi).
Metals, glass, crystal, flowers and leaves are not baked: metals reflect but take no
diffuse light, and the small things get one even light level per zone instead.
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector

args = [a for a in sys.argv[1:] if not a.startswith("-")]
SRC, OUT = args[0], args[1]
SAMPLES = int(args[2]) if len(args) > 2 else 32
LM_PX = int(args[3]) if len(args) > 3 else 1024
PROBE_SAMPLES = int(args[4]) if len(args) > 4 else 48
os.makedirs(OUT, exist_ok=True)
data = json.load(open(SRC))

bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene

# three.js (x, y up, z) -> Blender (x, y, z up)
def V(x, y, z):
    return (x, -z, y)

def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hexlin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))

# ---- materials: what matters for the bake is how much light each surface bounces, and
# in what colour. Base colours are the average colour of the page's textures.
MATS = {
    "cement": dict(c="#c9cbd0", r=0.42), "marbleWhite": dict(c="#ebe9e4", r=0.2), "navy": dict(c="#1d2f52", r=0.4),
    "teak": dict(c="#7a4f30", r=0.5), "paving": dict(c="#cbbca6", r=0.9), "plaster": dict(c="#e9e7e2", r=0.92),
    "ceiling": dict(c="#efeeea", r=1), "render": dict(c="#e3e2df", r=1), "roof": dict(c="#55606e", r=0.8),
    "wallTile": dict(c="#dfe3e8", r=0.15), "blackMarble": dict(c="#1e1e21", r=0.12), "gold": dict(c="#c9a05a", r=0.28, m=1),
    "iron": dict(c="#1b1c1e", r=0.5, m=0.6), "mirror": dict(c="#d8d8d4", r=0.03, m=1), "jali": dict(c="#c9a05a", r=0.35, m=1, jali=True),
    "crystal": dict(c="#ffffff", r=0.0, e=("#ffe2b8", 1.5)), "lampGlass": dict(c="#fff1d8", r=0.4, e=("#ffc27a", 40)),
    "night": dict(c="#1e2430", r=0.6), "glass": dict(c="#ffffff", r=0.0, glass=True), "velvet": dict(c="#1c2b55", r=0.75, sheen=1),
    "drape": dict(c="#1a2850", r=0.8, sheen=1), "porcelain": dict(c="#f1efe9", r=0.2), "clay": dict(c="#a8673f", r=0.85),
    "ceramic": dict(c="#244a6b", r=0.25), "flowerWhite": dict(c="#f3ede6", r=0.7), "flowerPink": dict(c="#d98aa4", r=0.7),
    "flowerPlum": dict(c="#7d3f6e", r=0.7), "leaf": dict(c="#3f5a2c", r=0.7), "trunk": dict(c="#6b5a48", r=1),
    "water": dict(c="#ffffff", r=0.0, glass=True), "cascade": dict(c="#ffffff", r=0.0, glass=True), "mosaic": dict(c="#2f86ad", r=0.12),
    "art": dict(c="#9c6e5a", r=0.85), "linen": dict(c="#ecebe6", r=0.95), "umbrella": dict(c="#1d2f52", r=0.9),
}
NO_BAKE = {"gold", "mirror", "jali", "iron", "crystal", "lampGlass", "glass", "night", "flowerWhite", "flowerPink", "flowerPlum", "leaf", "water", "cascade"}

def jali_image():
    """The same pattern as js/patterns.js: rings on a 1/4 grid, used as an alpha mask."""
    from PIL import Image, ImageDraw
    S_ = 512
    im = Image.new("L", (S_, S_), 0)
    d = ImageDraw.Draw(im)
    r = S_ // 4
    w = int(S_ * 0.035)
    for i in range(-1, 5):
        for j in range(-1, 5):
            d.ellipse([i * r - r, j * r - r, i * r + r, j * r + r], outline=255, width=w)
    d.rectangle([0, 0, S_ - 1, S_ - 1], outline=255, width=int(S_ * 0.05 / 2))
    p = os.path.join(OUT, "_jali.png")
    im.save(p)
    img = bpy.data.images.load(p)
    img.colorspace_settings.name = "Non-Color"
    return img

materials = {}
def material(name):
    if name in materials:
        return materials[name]
    spec = MATS.get(name, dict(c="#cccccc", r=0.8))
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*hexlin(spec["c"]), 1)
    b.inputs["Roughness"].default_value = spec["r"]
    b.inputs["Metallic"].default_value = spec.get("m", 0)
    if "sheen" in spec:
        b.inputs["Sheen Weight"].default_value = spec["sheen"]
    if "e" in spec:
        col, strength = spec["e"]
        b.inputs["Emission Color"].default_value = (*hexlin(col), 1)
        b.inputs["Emission Strength"].default_value = strength
    if spec.get("glass"):
        b.inputs["Alpha"].default_value = 0.0  # window glass lets the light through (no caustics needed)
    if spec.get("jali"):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = jali_image()
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1 / 0.7, 1 / 0.7, 1)
        uvn = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], b.inputs["Alpha"])
    materials[name] = m
    return m

# ---- meshes ---------------------------------------------------------------------------------
objects = []
for md in data["meshes"]:
    P = md["position"]
    nv = len(P) // 3
    idx = md["index"] or list(range(nv))
    pivot = md["pivot"]
    verts = [V(P[3 * i], P[3 * i + 1], P[3 * i + 2]) for i in range(nv)]
    faces = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]
    me = bpy.data.meshes.new(md["key"])
    me.from_pydata(verts, [], faces)
    me.validate(clean_customdata=False)
    if md["uv"]:
        U = md["uv"]
        uvl = me.uv_layers.new(name="UVMap")
        lv = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get("vertex_index", lv)
        uva = np.array(U, dtype=np.float32).reshape(-1, 2)[lv]
        uvl.data.foreach_set("uv", uva.ravel())
    else:
        me.uv_layers.new(name="UVMap")
    # weld coincident vertices: the page builds every quad with its own corners, which would
    # unwrap into thousands of tiny islands; welded, a wall unwraps as one piece
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.set_sharp_from_angle(angle=math.radians(35))
    me.materials.append(material(md["mat"]))
    ob = bpy.data.objects.new(md["key"], me)
    S.collection.objects.link(ob)
    if pivot:
        ob.location = V(pivot[0], pivot[1], pivot[2])
        ob.rotation_euler = (0, 0, pivot[3])
    ob["key"] = md["key"]
    ob["zone"] = md["zone"]
    ob["mat"] = md["mat"]
    ob["bakeme"] = bool(md["bake"]) and md["mat"] not in NO_BAKE
    objects.append(ob)
print(f"built {len(objects)} objects", flush=True)

# ---- sky, sun and lamps ---------------------------------------------------------------------
sun = data["sun"]
el, az = math.radians(sun["elevation"]), math.radians(sun["azimuth"])
world = bpy.data.worlds.new("sky")
S.world = world
try:
    world.use_nodes = True
except Exception:
    pass
wn = world.node_tree
bg = wn.nodes.get("Background")
sky = wn.nodes.new("ShaderNodeTexSky")
sky.sky_type = "MULTIPLE_SCATTERING"
sky.sun_disc = False
sky.sun_elevation = el
sky.sun_rotation = az
# the physical sky is very blue in shade; take half its saturation away
hs = wn.nodes.new("ShaderNodeHueSaturation")
hs.inputs["Saturation"].default_value = 0.5
wn.links.new(sky.outputs["Color"], hs.inputs["Color"])
wn.links.new(hs.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.3

sd = bpy.data.lights.new("sun", "SUN")
sd.energy = 4.0
sd.angle = math.radians(0.6)
sd.color = (1.0, 0.86, 0.72)
so = bpy.data.objects.new("sun", sd)
S.collection.objects.link(so)
travel = Vector(V(-math.sin(az) * math.cos(el), -math.sin(el), math.cos(az) * math.cos(el)))
so.rotation_euler = travel.to_track_quat("-Z", "Y").to_euler()

# the garden: a warm ground for the facade to catch bounced light from (the page shows paper here)
gm = bpy.data.meshes.new("ground")
G = 120
gm.from_pydata([(-G, -G, -0.45), (G, -G, -0.45), (G, G, -0.45), (-G, G, -0.45)], [], [(0, 1, 2, 3)])
go = bpy.data.objects.new("ground", gm)
S.collection.objects.link(go)
mg = bpy.data.materials.new("ground")
try:
    mg.use_nodes = True
except Exception:
    pass
mg.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*hexlin("#9a8f78"), 1)
gm.materials.append(mg)

for L in data["lights"]:
    ld = bpy.data.lights.new("lamp", "POINT")
    ld.energy = L["watts"]
    ld.shadow_soft_size = L["radius"]
    # lamp colours from the page, softened halfway to white: warm, not orange
    ld.color = tuple(0.5 + 0.5 * c for c in hexlin(L["color"]))
    lo = bpy.data.objects.new("lamp", ld)
    lo.location = (L["x"], L["n"], L["y"])
    S.collection.objects.link(lo)

# ---- Cycles ---------------------------------------------------------------------------------
S.render.engine = "CYCLES"
try:
    S.render.compositor_device = "CPU"
except Exception:
    pass
S.cycles.device = "CPU"
S.cycles.max_bounces = 8
S.cycles.diffuse_bounces = 5
S.cycles.transparent_max_bounces = 16
S.view_settings.view_transform = "AgX"

# ---- denoise a float image with OIDN through the compositor ---------------------------------
def denoise(img):
    ng = bpy.data.node_groups.new("dn", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    i = ng.nodes.new("CompositorNodeImage"); i.image = img
    d = ng.nodes.new("CompositorNodeDenoise")
    for name, val in (("HDR", True), ("Prefilter", "Accurate")):
        try:
            d.inputs[name].default_value = val
        except Exception:
            pass
    o = ng.nodes.new("NodeGroupOutput")
    ng.links.new(i.outputs["Image"], d.inputs["Image"])
    ng.links.new(d.outputs["Image"], o.inputs[0])
    S.compositing_node_group = ng
    S.render.resolution_x = img.size[0]
    S.render.resolution_y = img.size[1]
    S.render.resolution_percentage = 100
    tmp = os.path.join(OUT, "_dn.exr")
    S.render.image_settings.file_format = "OPEN_EXR"
    S.render.image_settings.color_depth = "32"
    S.render.filepath = tmp
    # the compositor needs a render to run; a 1-sample camera render of nothing is enough
    if not S.camera:
        cd = bpy.data.cameras.new("dncam"); co = bpy.data.objects.new("dncam", cd)
        co.location = (0, 0, -500); co.rotation_euler = (math.pi, 0, 0)
        S.collection.objects.link(co); S.camera = co
    keep = S.cycles.samples
    S.cycles.samples = 1
    bpy.ops.render.render(write_still=True)
    S.cycles.samples = keep
    S.compositing_node_group = None
    out = bpy.data.images.load(tmp)
    out.colorspace_settings.name = "Non-Color"
    px = np.array(out.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(out)
    os.remove(tmp)
    return px

def select_only(objs):
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

# ---- lightmap atlases ----------------------------------------------------------------------
atlases = {}
for o in objects:
    if o["bakeme"]:
        atlases.setdefault(o["zone"], []).append(o)
        o["lightmap"] = "lm_" + o["zone"]

stats, flat = {}, {}
for zone, objs in atlases.items():
    for o in objs:
        uv = o.data.uv_layers.new(name="LightmapUV")
        o.data.uv_layers.active = uv
        for l in o.data.uv_layers:
            l.active_render = l.name == "UVMap"
    select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.002, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    img = bpy.data.images.new("lm_" + zone, LM_PX, LM_PX, float_buffer=True, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    added = []
    for m in {s.material for o in objs for s in o.material_slots if s.material}:
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.image = img
        m.node_tree.nodes.active = n
        added.append((m, n))
    S.cycles.samples = SAMPLES
    S.render.bake.use_pass_direct = True
    S.render.bake.use_pass_indirect = True
    S.render.bake.use_pass_color = False
    S.render.bake.margin = 6
    S.render.bake.margin_type = "EXTEND"
    S.render.bake.target = "IMAGE_TEXTURES"
    select_only(objs)
    print(f"BAKING {zone}: {len(objs)} objects, {LM_PX}px, {SAMPLES} samples", flush=True)
    bpy.ops.object.bake(type="DIFFUSE")
    for m, n in added:
        m.node_tree.nodes.remove(n)
    px = denoise(img)[:, :, :3]
    scale = float(np.percentile(px, 99.6)) or 1.0
    lit = px[px.max(axis=2) > 1e-4]
    flat[zone] = float(np.median(lit)) if lit.size else 0.0
    v = np.clip(px / scale, 0, 1)
    v = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    from PIL import Image
    Image.fromarray((np.flipud(v) * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(OUT, f"lm_{zone}.png"))
    stats["lm_" + zone] = {"file": f"lm_{zone}.png", "scale": scale}
    print(f"BAKED {zone}: scale {scale:.3f}, median {flat[zone]:.3f}", flush=True)

# ---- 360 captures for reflections -----------------------------------------------------------
PROBES = {"entry": (26.2, 1.6, 5.25), "foyer": (20.6, 1.7, 5.0), "dining": (15.25, 1.6, 9.6),
          "pool": (12.0, 1.4, 17.5), "gallery": (12.5, 1.6, 6.5)}  # (x, y, n)
envs = {}
cd = bpy.data.cameras.new("probe")
cd.type = "PANO"
try:
    cd.panorama_type = "EQUIRECTANGULAR"
except AttributeError:
    cd.cycles.panorama_type = "EQUIRECTANGULAR"
pc = bpy.data.objects.new("probe", cd)
S.collection.objects.link(pc)
S.camera = pc
S.compositing_node_group = None
for zone, (x, y, n) in PROBES.items():
    pc.location = (x, n, y)
    pc.rotation_euler = (math.radians(90), 0, math.radians(-90))
    S.render.resolution_x, S.render.resolution_y, S.render.resolution_percentage = 1024, 512, 100
    S.cycles.samples = PROBE_SAMPLES
    S.cycles.use_denoising = True
    S.render.image_settings.file_format = "HDR"
    S.render.filepath = os.path.join(OUT, f"env_{zone}.hdr")
    bpy.ops.render.render(write_still=True)
    envs[zone] = f"env_{zone}.hdr"
    print("PROBE", zone, flush=True)

# ---- export the baked meshes ----------------------------------------------------------------
for o in list(S.objects):
    if o.type != "MESH" or not o.get("bakeme"):
        bpy.data.objects.remove(o, do_unlink=True)
for o in S.objects:
    o.data.uv_layers.active = o.data.uv_layers["UVMap"]
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "room.glb"), export_format="GLB", export_yup=True, export_extras=True,
    export_texcoords=True, export_normals=True, export_materials="NONE", export_lights=False, export_cameras=False,
)
json.dump({"glb": "room.glb", "lightmaps": stats, "flat": flat, "env": envs, "exposure": 1.0}, open(os.path.join(OUT, "scene.json"), "w"), indent=1)
os.remove(os.path.join(OUT, "_jali.png"))
print("EXPORT OK", flush=True)
