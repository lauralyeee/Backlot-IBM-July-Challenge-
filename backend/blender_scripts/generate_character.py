"""
Headless Blender/CharMorph character export script.

Runs INSIDE Blender's own Python (via bpy), invoked by backend/model3d.py:

    blender --background --python generate_character.py -- \\
        --params '{"BodyType_Fat": 0.4}' --output /path/to/asset_id.glb

Manual test (Blender has its own bundled Python, not this repo's venv):

    /opt/homebrew/bin/blender --background --python \\
        backend/blender_scripts/generate_character.py -- \\
        --params '{}' --output /tmp/test.glb

Deliberately does NOT use --factory-startup (would disable CharMorph), and
re-enables the CharMorph addon at the top regardless, in case --background
doesn't carry over the interactive GUI's addon state.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import bpy


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--params", required=True, help="JSON object of CharMorph morph values, keys like 'BodyType_Fat'")
    parser.add_argument("--output", required=True, help="Output .glb path")
    parser.add_argument("--base-model", default=None, help="Override CharMorph's base_model selection (defaults to whatever the UI already has selected -- confirm this resolves to Vitruvian before relying on the default)")
    return parser.parse_args(argv)


def main():
    args = parse_args()
    try:
        params = json.loads(args.params)
    except json.JSONDecodeError as e:
        print(f"[generate_character] FATAL: --params was not valid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        bpy.ops.preferences.addon_enable(module="CharMorph")
    except Exception as e:
        print(f"[generate_character] addon_enable warning (may already be enabled): {e}", file=sys.stderr)

    # --background starts from Blender's stock scene (Cube, Camera, Light).
    # export_scene.gltf() exports the whole scene by default, so without
    # clearing it first the character showed up standing inside a cube.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    wm = bpy.data.window_managers.get("WinMan")
    if wm is None:
        # Guards the unlikely case of an empty window_managers list --
        # CharMorph's UI-backed API has nothing to attach to without it.
        if len(bpy.data.window_managers) == 0:
            print(
                "[generate_character] FATAL: bpy.data.window_managers is empty in this "
                "--background session -- CharMorph's UI-backed API has nothing to "
                "attach to.",
                file=sys.stderr,
            )
            sys.exit(2)
        wm = bpy.data.window_managers[0]

    ui = wm.charmorph_ui
    if args.base_model:
        ui.base_model = args.base_model
    # else: leave whatever CharMorph's UI already has selected by default.

    bpy.ops.charmorph.import_char()

    morphs = wm.charmorphs
    applied = {}
    skipped = {}
    for key, value in params.items():
        prop_name = f"prop_{key}"
        if hasattr(morphs, prop_name):
            try:
                setattr(morphs, prop_name, float(value))
                applied[key] = value
            except Exception as e:
                skipped[key] = str(e)
        else:
            skipped[key] = "unknown morph (no matching CharMorph property)"

    print(f"[generate_character] applied={applied}")
    if skipped:
        print(f"[generate_character] skipped={skipped}")

    # Prints every morph property CharMorph exposes on this character --
    # model3d.py echoes this to the backend console on every generation, so
    # ALLOWED_MORPH_KEYS there can be verified/extended without the Blender GUI.
    all_morph_props = sorted(
        name[len("prop_"):] for name in dir(morphs) if name.startswith("prop_")
    )
    print(f"[generate_character] ALL_AVAILABLE_MORPHS ({len(all_morph_props)}): {all_morph_props}")

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    if args.base_model == 'antonia':
        # Antonia's own textures export cleanly through this exporter (unlike
        # Vitruvian's packed UDIM textures, which crash it -- see the else
        # branch). Real materials are worth it, but an uncompressed export
        # runs ~128MB, so use JPEG-compressed textures + Draco mesh
        # compression to keep it web-sized. Falls back to a real-materials
        # export with no compression if this Blender build rejects the
        # kwargs, rather than failing generation outright.
        try:
            bpy.ops.export_scene.gltf(
                filepath=args.output,
                export_format='GLB',
                export_materials='EXPORT',
                export_image_format='JPEG',
                export_jpeg_quality=80,
                export_draco_mesh_compression_enable=True,
            )
            print("[generate_character] exported Antonia with real materials + JPEG/Draco compression")
        except TypeError as e:
            print(f"[generate_character] compressed export kwargs rejected ({e}) -- retrying with real materials, no compression", file=sys.stderr)
            bpy.ops.export_scene.gltf(
                filepath=args.output,
                export_format='GLB',
                export_materials='EXPORT',
            )
    else:
        # Vitruvian (and any non-Antonia base): its packed UDIM textures
        # crash Blender's glTF exporter, so skip the real material and swap
        # in a flat single-color material before export instead -- not real
        # skin texture, just enough that the model doesn't render as a
        # stark blob in a glTF viewer.
        export_materials_mode = 'NONE'
        try:
            skin_material = bpy.data.materials.new(name="concept_skin")
            skin_material.use_nodes = True
            bsdf = skin_material.node_tree.nodes.get("Principled BSDF")
            if bsdf is not None:
                bsdf.inputs["Base Color"].default_value = (0.82, 0.68, 0.56, 1.0)  # neutral tan
                if "Roughness" in bsdf.inputs:
                    bsdf.inputs["Roughness"].default_value = 0.55
            for obj in bpy.data.objects:
                if obj.type == 'MESH':
                    obj.data.materials.clear()
                    obj.data.materials.append(skin_material)
            export_materials_mode = 'EXPORT'
            print("[generate_character] applied a flat concept_skin material")
        except Exception as e:
            print(f"[generate_character] skin material setup failed ({e}) -- falling back to geometry-only export", file=sys.stderr)

        bpy.ops.export_scene.gltf(
            filepath=args.output,
            export_format='GLB',
            export_materials=export_materials_mode,
        )

    print(f"[generate_character] wrote {args.output}")


if __name__ == "__main__":
    main()
