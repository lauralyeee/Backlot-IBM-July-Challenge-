export const ROLES = [
  { id: "writer", label: "Writer", blurb: "Novels, series, short stories", voice: "prose-ready lore with narrative texture" },
  { id: "game", label: "Game designer", blurb: "Video games, tabletop, RPGs", voice: "gameplay-usable hooks, factions, and stakes" },
  { id: "media", label: "Interactive media team", blurb: "Podcasts, transmedia, experiences", voice: "format-neutral canon that adapts across prose, audio, and visual formats" },
];

export const PERSONAS = [
  {
    id: "odyssey",
    label: "Epic odyssey chronicler",
    desc: "A sea voyage through myth: islands, kings, monsters, the long way home",
    eras: ["Before the War", "The Wandering", "The Homecoming"],
    nameIdeas: ["The Wine-Dark Reaches", "Nine Years From Ithaca", "The Long Way Home", "Salt and Oath"],
    dialects: {
      "House of the Absent King": { style: "formal, weary, long vowels drawn out", rate: 0.88, pitch: 0.85 },
      "The Sandy Court": { style: "warm, talkative, hospitable cadence", rate: 1.05, pitch: 1.05 },
      "The Tide-Sworn": { style: "clipped, salt-worn, superstitious", rate: 0.95, pitch: 0.7 },
    },
    ideas: [
      { label: "Ithaca", text: "Ithaca — the small Ionian island kingdom the voyage is trying to reach, ruled by a king who has been away so long the court assumes he is dead" },
      { label: "Pylos", text: "Pylos — a sandy mainland harbour kingdom where a young traveller arrives seeking news of his missing father from an aging, talkative king" },
      { label: "Sparta", text: "Sparta — an inland kingdom of hard soldiers, where a returned queen and her husband keep a court full of unspoken history about the war" },
      { label: "Crete", text: "Crete — a great southern island of ninety cities and older, stranger customs than the mainland remembers" },
      { label: "The Cyclops' cave", text: "A cave on a wild island where a one-eyed herdsman keeps sheep and a cruel idea of hospitality" },
      { label: "The Sirens' strait", text: "A narrow passage where singing carries across the water, promising every sailor the one thing they most want to hear" },
      { label: "Circe's hall", text: "An island hall where a sorceress hosts sailors generously and changes what they are before they notice" },
      { label: "The land of the dead", text: "A shore at the edge of the map where the living may speak with the dead, if they bring the right offering" },
      { label: "Calypso's island", text: "A green island where a lonely immortal offers a shipwrecked traveller a life without hardship, and he refuses it" },
      { label: "The suitors' feast", text: "A great hall where dozens of suitors eat through an absent king's stores, waiting for his wife to choose one of them" },
    ],
    seed: [
      { title: "Ithaca", type: "location", era: "The Homecoming", faction: "House of the Absent King", mood: "yearning", content: "A small, steep island in the western sea — goats, olive terraces, one good harbour. It is not rich and never was, but it is the fixed point every route in this world bends toward. The palace has been run by a waiting household for nineteen years." },
      { title: "Pylos", type: "location", era: "Before the War", faction: "The Sandy Court", mood: "hospitable", content: "A mainland harbour kingdom of long beaches and cattle wealth, famed for hosting guests properly. Its old king remembers every ship that sailed to the war and every man who did not come back, and will tell you about all of them." },
      { title: "The Isle of Unstrung Bows", type: "location", era: "The Wandering", faction: "The Tide-Sworn", mood: "deceptive", content: "An island whose harbour welcomes every ship with feasts and garlands. No crew that stays past the third sunset has been seen again, and the harbourmaster keeps a wall of unstrung bows — one for each vanished vessel." },
      { title: "Kessa of the Nine Currents", type: "character", era: "The Wandering", faction: "The Tide-Sworn", mood: "cunning", content: "A navigator said to have bargained with a sea-god for knowledge of the nine hidden currents. Each current she uses costs her one true memory of home, and she no longer remembers her mother's face." },
      { title: "The Oath at the Burning Harbour", type: "event", era: "Before the War", faction: "—", mood: "fateful", content: "The night twelve captains swore on a burning ship to return home together or not at all. The gods heard the oath and, as gods do, chose to enforce it literally." },
    ],
  },
  {
    id: "highfantasy",
    label: "High-fantasy lore master",
    desc: "Epic history, kingdoms, magic with rules",
    eras: ["Age of Founding", "The Sundering", "Age of Reclamation"],
    nameIdeas: ["The Vhel Reaches", "Kingdoms of the Quiet Page", "The Warded Lands", "Ninefold Realm"],
    dialects: {
      "Order of the Quiet Page": { style: "hushed, reverent, precise diction", rate: 0.85, pitch: 0.9 },
    },
    ideas: [
      { label: "A sunken library", text: "A library built below the waterline, kept dry by magic no one alive fully understands" },
      { label: "A broken oath-bell", text: "A bell that rings once for every oath broken within a day's ride" },
      { label: "A guild of mapmakers", text: "A guild that maps places before they exist, and is usually right" },
      { label: "A king with no name", text: "A ruler whose true name was taken as payment for the throne" },
      { label: "Magic with a price", text: "A magic system where every spell costs the caster a specific, permanent thing" },
      { label: "A border that moves", text: "A national border that shifts a mile each winter, and the villages caught in between" },
    ],
    seed: [
      { title: "The Sunken Library of Vhel", type: "location", era: "Age of Founding", faction: "Order of the Quiet Page", mood: "reverent", content: "A library built below the waterline of Lake Vhel, its halls kept dry by a lattice of warding stones. The Order of the Quiet Page maintains it and forbids reading any book aloud." },
      { title: "Warden Ilsette", type: "character", era: "Age of Reclamation", faction: "Order of the Quiet Page", mood: "stern", content: "Last sworn warden of the Sunken Library. She has memorized the location of every warding stone and trusts no one who asks about them." },
      { title: "The Sundering", type: "event", era: "The Sundering", faction: "—", mood: "catastrophic", content: "The night the warding lattice failed for seven hours. A third of the library flooded, and the books lost that night are spoken of only in the Order's private records." },
    ],
  },
  {
    id: "scifi",
    label: "Hard sci-fi chronicler",
    desc: "Space colonies, real physics, near futures",
    eras: ["Pre-Departure", "The Crossing", "First Settlement"],
    nameIdeas: ["The Meridian Line", "Nine Years of Silence", "First Settlement", "The Consortium Routes"],
    dialects: {
      "Consortium of Lines": { style: "clinical, procedural, understated", rate: 1.0, pitch: 1.0 },
    },
    ideas: [
      { label: "A relay station", text: "A relay station at the midpoint of the route, crewed by four people on nine-year rotations" },
      { label: "A deleted archive", text: "An operator who kept copies of every message the company ordered erased" },
      { label: "The first colony law", text: "The first law the settlement passed, and the argument that produced it" },
      { label: "A generation gap", text: "Children born in transit who have never stood on a planet and do not want to" },
      { label: "A supply failure", text: "The year a scheduled resupply simply did not arrive, and no one ever explained why" },
      { label: "A rationed resource", text: "The one resource the colony rations, and the black market that grew around it" },
    ],
    seed: [
      { title: "Relay Station Meridian", type: "location", era: "The Crossing", faction: "Consortium of Lines", mood: "isolated", content: "A communications relay at the midpoint of the colony route, crewed by four people on nine-year rotations. Every message between Earth and the settlement passes through it." },
      { title: "Operator Senna Okoye", type: "character", era: "The Crossing", faction: "Consortium of Lines", mood: "meticulous", content: "Senior operator on Meridian. Keeps an unofficial archive of messages the Consortium ordered deleted." },
    ],
  },
  {
    id: "urban",
    label: "Urban-myth cartographer",
    desc: "Hidden magic in a modern city",
    eras: ["The Quiet Century", "The Uncovering", "Present Day"],
    nameIdeas: ["The Night Ledger", "Platform Nine", "The Unmapped City", "Debts and Doorways"],
    dialects: {
      "The Night Ledger": { style: "low, discreet, transactional", rate: 0.92, pitch: 0.8 },
    },
    ideas: [
      { label: "A platform off the map", text: "A station platform that appears on no current map, where trains stop only between 3:00 and 3:04 a.m." },
      { label: "A brokerage of favours", text: "An organisation that trades in favours and never forgives a debt, only sells it on" },
      { label: "A building that gains floors", text: "An office tower that quietly gained three floors nobody remembers approving" },
      { label: "The last night bus", text: "A bus route that runs one stop further than the timetable admits" },
      { label: "A locksmith who knows too much", text: "A locksmith who can open anything and refuses roughly half the jobs offered" },
      { label: "A rule everyone obeys", text: "An unwritten city rule that everyone follows and nobody can explain" },
    ],
    seed: [
      { title: "Platform Nine of Central Station", type: "location", era: "Present Day", faction: "The Night Ledger", mood: "uneasy", content: "A decommissioned platform that appears on no current map. Trains stop there only between 3:00 and 3:04 a.m., and only for passengers carrying an unpaid debt." },
      { title: "The Night Ledger", type: "faction", era: "The Quiet Century", faction: "The Night Ledger", mood: "secretive", content: "A brokerage of favours operating out of the city's closed spaces. Every favour is recorded; nothing is ever forgiven, only traded." },
    ],
  },
];

export const TYPES = ["lore", "character", "location", "faction", "event"];

export const TYPE_META = {
  lore: { icon: "📜", label: "Lore" },
  character: { icon: "🧑", label: "Character" },
  location: { icon: "🗺️", label: "Location" },
  faction: { icon: "🛡️", label: "Faction" },
  event: { icon: "⚡", label: "Event" },
};
