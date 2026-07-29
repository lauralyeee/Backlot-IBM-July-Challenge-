"""
Headless Blender/CharMorph character export script.

Runs INSIDE Blender's own Python (via `bpy`) -- not a standalone script.
Invoked by backend/model3d.py as:

    blender --background --python generate_character.py -- \\
        --params '{"BodyType_Fat": 0.4}' --output /path/to/asset_id.glb

Manual test command (run by hand on the dev machine, NOT from this repo's
Python venv -- Blender has its own bundled Python):

    /opt/homebrew/bin/blender --background --python \\
        backend/blender_scripts/generate_character.py -- \\
        --params '{}' --output /tmp/test.glb

Per the implementation plan doc's "Open unknowns still to resolve DURING
Phase 4" section: everything in CharMorph's Python API used below was only
confirmed by hand in Blender's INTERACTIVE GUI/Python console during Phase
0 -- whether bpy.data.window_managers[...] resolves the same way with zero
windows open (true --background mode) was flagged as untested. If this
script fails, the most likely first culprit is that lookup; run the manual
command above and report the exact traceback back before assuming anything
else is broken.

Deliberately does NOT use --factory-startup (that would reset to factory
defaults and disable CharMorph) -- and defensively re-enables the CharMorph
addon at the top regardless, in case --background doesn't carry over
whatever addon state the interactive GUI had.
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

    # Every --background invocation starts from Blender's stock startup
    # scene (a Cube, a Camera, a Light) -- confirmed live 2026-07-28: the
    # exported .glb showed the character standing waist-deep inside a large
    # white cube, because export_scene.gltf() exports the whole scene by
    # default, not just whatever import_char() adds. Clear the scene first
    # so the only thing left to export is the character itself.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    # window_managers[...] is confirmed to work in the interactive GUI
    # (Phase 0) but NOT yet independently confirmed in --background mode --
    # this is the open unknown flagged in the module docstring above.
    wm = bpy.data.window_managers.get("WinMan")
    if wm is None:
        if len(bpy.data.window_managers) == 0:
            print(
                "[generate_character] FATAL: bpy.data.window_managers is empty in this "
                "--background session -- CharMorph's UI-backed API (charmorph_ui / "
                "charmorphs) has nothing to attach to. This is exactly the untested "
                "case flagged in the implementation plan doc. Report this back so the "
                "pipeline can be reworked around CharMorph's lower-level (non-UI) API "
                "if one exists.",
                file=sys.stderr,
            )
            sys.exit(2)
        wm = bpy.data.window_managers[0]

    ui = wm.charmorph_ui
    if args.base_model:
        ui.base_model = args.base_model
    # else: leave whatever CharMorph's UI already has selected. Per Phase 0
    # notes, read the exact stored value via Blender's Python console with
    # Vitruvian selected in the interactive GUI, then hardcode it here with
    # --base-model once confirmed -- a display label and the internal value
    # aren't guaranteed identical.

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

    # Ground truth for ALLOWED_MORPH_KEYS in backend/model3d.py: only 4 of
    # those keys were ever hands-on confirmed (see Phase 0 notes), so most
    # of what's in that list right now is an educated guess. This prints
    # EVERY morph property CharMorph actually exposes on this character --
    # model3d.py echoes this whole log to the backend server's own console
    # on every generation, so the real list is one generate-click away
    # instead of requiring the Blender GUI. Once you have it, send the list
    # back so ALLOWED_MORPH_KEYS can be corrected to real names instead of
    # guesses.
    all_morph_props = sorted(
        name[len("prop_"):] for name in dir(morphs) if name.startswith("prop_")
    )
    print(f"[generate_character] ALL_AVAILABLE_MORPHS ({len(all_morph_props)}): {all_morph_props}")

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    if args.base_model == 'antonia':
        # Antonia Polygon's OWN textures export cleanly through this same
        # exporter (unlike Vitruvian's packed UDIM textures, which crash it
        # -- see the else branch below) -- confirmed live 2026-07-28 via
        # Blender's own glTF viewer. Real texture is worth the extra file
        # size for this base, but an uncompressed export ran ~128MB in
        # that same test, unusable for a web app -- so export with real
        # materials, but ask for JPEG-compressed textures and Draco mesh
        # compression to bring that down.
        #
        # UNTESTED as of this writing: the exact kwarg names/values below
        # (export_image_format, export_jpeg_quality,
        # export_draco_mesh_compression_enable) against this Blender
        # version's exporter. Wrapped so a TypeError/naming mismatch falls
        # back to a real-materials export with no compression, rather than
        # failing generation outright -- if that fallback path is ever
        # hit, check bpy.ops.export_scene.gltf.get_rna_type().properties
        # in Blender's Python console for this build's real kwarg names.
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
        # Vitruvian (and any other non-Antonia base): OWN textures are
        # packed + UDIM-tiled, which Blender's glTF exporter cannot handle
        # ("UDIM packed images are not supported for export") -- exporting
        # the real material crashes. Sidestep the crash a different way --
        # don't export the base's real material at all, replace it with a
        # brand new, trivial, single flat-color material of our own before
        # export. This is NOT real skin texture and still no costume
        # (that's still the 2D portrait's job) -- it's just enough so the
        # model doesn't render as a stark blob in a glTF viewer.
        #
        # Confirmed working 2026-07-28 (live user test, "The Silent
        # Guardian" generation) -- this branch is unchanged from that
        # confirmed-good version.
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

        # The exact enum value for export_materials was not independently
        # re-verified against the installed exporter version -- if this
        # raises a TypeError/ValueError on the kwarg, check
        # bpy.ops.export_scene.gltf.get_rna_type().properties['export_materials']
        # for the current valid enum values in the Blender Python console.
        bpy.ops.export_scene.gltf(
            filepath=args.output,
            export_format='GLB',
            export_materials=export_materials_mode,
        )

    print(f"[generate_character] wrote {args.output}")


if __name__ == "__main__":
    main()
