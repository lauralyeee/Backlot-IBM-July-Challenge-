"""
Python mirror of the static data in src/lib/worldData.js.
Only the ROLES array is needed server-side (for prompt building).
"""

ROLES = [
    {
        "id": "writer",
        "label": "Writer",
        "blurb": "Novels, series, short stories",
        "voice": "prose-ready lore with narrative texture",
    },
    {
        "id": "game",
        "label": "Game designer",
        "blurb": "Video games, tabletop, RPGs",
        "voice": "gameplay-usable hooks, factions, and stakes",
    },
    {
        "id": "media",
        "label": "Interactive media team",
        "blurb": "Podcasts, transmedia, experiences",
        "voice": "format-neutral canon that adapts across prose, audio, and visual formats",
    },
]
