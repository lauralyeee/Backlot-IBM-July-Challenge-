// Role ids are stable identifiers persisted on each world's `roles` array —
// only the label/blurb/voice copy changed here (to match the target
// audience: screenwriters, producers, and writers), the ids themselves
// stay the same so existing worlds' saved roles keep resolving correctly.
export const ROLES = [
  { id: "writer", label: "Screenwriter", blurb: "Features, pilots, and episodic series", voice: "script-ready lore — scene-actionable detail and dialogue-aware character voice" },
  { id: "game", label: "Producer", blurb: "Development, packaging, and pitching", voice: "packaging-ready canon with clear hooks and stakes suited for pitching to buyers" },
  { id: "media", label: "Novelist", blurb: "Novels, series, and short fiction", voice: "prose-ready lore with narrative texture" },
];

export const PERSONAS = [
  {
    id: "contemporary",
    label: "Contemporary drama novelist",
    desc: "Realistic present-day fiction about the people, families, and choices that define an ordinary life",
    eras: ["Before", "The Turning Point", "After"],
    nameIdeas: ["What We Carry", "The Long Way Back", "Everything We Didn't Say", "Ordinary Weather"],
    dialects: {
      "The Hallworth Family": { style: "plain-spoken, careful, a little guarded", rate: 0.95, pitch: 0.95 },
    },
    ideas: [
      { label: "A sibling returns home", text: "An estranged sibling comes back for a parent's illness and has to share a house with the family they left" },
      { label: "A job loss ripples out", text: "A layoff that quietly reorganizes a marriage, a friendship, and a kid's sense of what's stable" },
      { label: "An inherited house", text: "A house left to three siblings who each remember growing up in it differently, and disagree about what to do with it" },
      { label: "A secret finally surfaces", text: "A decades-old family secret comes out at the worst possible dinner, in front of the worst possible guest" },
      { label: "A friendship under strain", text: "Two friends whose lives have quietly grown apart try to have the vacation they used to have" },
      { label: "A diagnosis changes the plan", text: "A diagnosis that forces a family to say the things they'd been putting off indefinitely" },
    ],
    seed: [
      { title: "The Hallworth House", type: "location", era: "Before", faction: "The Hallworth Family", mood: "familiar", content: "A three-bedroom house on a street that's changed more than the house has. The kitchen table still has the water ring from a party in 2003 that nobody talks about anymore." },
      { title: "Dana Hallworth", type: "character", era: "Before", faction: "The Hallworth Family", mood: "tired", content: "The one who stayed. Manages her mother's medications, her brother's silences, and a job she's too proud to complain about. Keeps a running list of things she'll say once, someday, to somebody." },
      { title: "The Phone Call at 6 a.m.", type: "event", era: "The Turning Point", faction: "—", mood: "unsettled", content: "The call that starts the part of the story where nothing gets to stay the same. Nobody in the family remembers the exact words afterward — only that they were standing when they heard them." },
    ],
  },
  {
    id: "romcom",
    label: "Contemporary rom-com writer",
    desc: "A modern-day love story: meet-cutes, miscommunication, and the people who almost get in the way",
    eras: ["Before They Meet", "The Complication", "The Grand Gesture"],
    nameIdeas: ["The Coffee Shop on 5th", "Two Weeks' Notice", "The Wrong Number", "Second Chances, Third Dates"],
    dialects: {
      "The Downtown Crowd": { style: "quick, witty, overlapping banter", rate: 1.1, pitch: 1.05 },
    },
    ideas: [
      { label: "A meet-cute gone wrong", text: "Two strangers grab the same last cab in the rain and end up sharing it across town, arguing the whole way" },
      { label: "A fake relationship", text: "Two coworkers agree to pose as a couple for a family wedding, and the lines blur faster than either expected" },
      { label: "A best-friend confession", text: "One half of a decade-long friendship finally admits they've felt more for years, right before the other one moves away" },
      { label: "The ex at the wedding", text: "A wedding where the maid of honor's ex is the best man, and everyone else at the head table knows it" },
      { label: "A rival bakery", text: "Two competing bakeries on the same block, run by two people who can't stand each other and can't stop showing up at each other's door" },
      { label: "A wrong-number text thread", text: "A months-long text thread that started as a wrong number and became the most honest relationship either of them has" },
    ],
    seed: [
      { title: "The Merrow Street Café", type: "location", era: "Before They Meet", faction: "The Downtown Crowd", mood: "cozy", content: "A corner café with mismatched chairs and a chalkboard menu that never gets updated. Regulars claim the back booth by the window is good luck for first dates — nobody can explain why, they just keep coming back to it." },
      { title: "Priya Anand", type: "character", era: "Before They Meet", faction: "The Downtown Crowd", mood: "guarded", content: "A freelance illustrator who took over her late aunt's café lease on a whim and hasn't slept properly since. Fiercely loyal to the three regulars she actually likes, and allergic to being asked about her five-year plan." },
      { title: "The Note Left on the Register", type: "event", era: "The Complication", faction: "—", mood: "hopeful", content: "The night a customer left a note instead of a tip — three lines, no name, and a compliment specific enough that Priya has read it a dozen times trying to guess who wrote it." },
    ],
  },
  {
    id: "thriller",
    label: "Mystery & thriller plotter",
    desc: "A crime, an investigation, and the secrets that unravel — grounded suspense, nothing supernatural",
    eras: ["Before the Crime", "The Investigation", "The Reckoning"],
    nameIdeas: ["Nothing Left Unsaid", "The Last Known Address", "A Quiet Kind of Guilty", "What the Report Left Out"],
    dialects: {
      "Riverside PD": { style: "clipped, procedural, careful not to overpromise", rate: 1.0, pitch: 0.9 },
    },
    ideas: [
      { label: "An alibi with a gap", text: "A solid alibi that has one unaccounted-for hour nobody thought to ask about until now" },
      { label: "A witness who recants", text: "A key witness who suddenly changes their story, and the detective who has to figure out who got to them" },
      { label: "A cold case reopens", text: "A cold case reopened because of a single new detail a retiring officer can't let go of" },
      { label: "The wrong person confesses", text: "Someone confesses to a crime they didn't commit, and the investigator has to work out why" },
      { label: "A missing persons pattern", text: "A string of missing-persons cases that only look connected if you're the one person still cross-referencing them" },
      { label: "Evidence that doesn't fit", text: "A piece of evidence that contradicts the tidy version of events everyone has already agreed to believe" },
    ],
    seed: [
      { title: "Riverside Precinct", type: "location", era: "The Investigation", faction: "Riverside PD", mood: "tense", content: "A precinct running on too much coffee and not enough staff. The case board in the back room has stayed up eleven months past when it should have been cleared, and everyone's stopped mentioning it out loud." },
      { title: "Marisol Ortega", type: "character", era: "The Investigation", faction: "Riverside PD", mood: "methodical", content: "Fourteen years on the force, known for re-reading files nobody else will touch twice. Doesn't believe in coincidence and has the case-closure rate to back it up. Losing patience with the people telling her to let this one go." },
      { title: "The 11:40 Call", type: "event", era: "Before the Crime", faction: "—", mood: "ominous", content: "A phone call placed at 11:40 p.m. that three people gave three different accounts of afterward. The phone records exist. The transcript doesn't." },
    ],
  },
  {
    id: "historical",
    label: "Historical fiction chronicler",
    desc: "A real or realistic past setting — grounded history, no magic, no invented technology",
    eras: ["Rising Tensions", "The Event", "The Aftermath"],
    nameIdeas: ["The Long Correspondence", "What the Harbor Remembers", "A Decent Winter", "The Ones Who Stayed"],
    dialects: {
      "The Dockside Quarter": { style: "period-formal, measured, class-conscious", rate: 0.9, pitch: 0.95 },
    },
    ideas: [
      { label: "A letter arrives too late", text: "A letter that arrives months after it was needed, and changes nothing except how someone remembers that year" },
      { label: "A trade disrupted", text: "A trade route or livelihood disrupted by a real historical event, and the family who has to start over" },
      { label: "Two sides of a household", text: "A household split by loyalty to opposing sides of a conflict, still sharing the same table" },
      { label: "A record nearly lost", text: "A diary or ledger that survives by luck and becomes the only account of what actually happened" },
      { label: "An unlikely alliance", text: "Two people who would never have spoken under ordinary circumstances, thrown together by the period's upheaval" },
      { label: "A return after years away", text: "Someone returning to a hometown that the era has changed more than they have" },
    ],
    seed: [
      { title: "The Dockside Quarter", type: "location", era: "Rising Tensions", faction: "The Dockside Quarter", mood: "watchful", content: "A harbor district of warehouses, boarding houses, and a church that doubles as the neighborhood's real information exchange. Everyone here has a stake in whether the ships keep coming." },
      { title: "Eleanor Whitfield", type: "character", era: "Rising Tensions", faction: "The Dockside Quarter", mood: "resolute", content: "Runs her late husband's shipping ledger herself, against the advice of nearly everyone. Keeps her own counsel about which way the political wind is blowing, and writes it all down anyway." },
      { title: "The Closing of the Harbor", type: "event", era: "The Event", faction: "—", mood: "grave", content: "The week the harbor shut down without warning. Some families had a day to prepare. Most didn't. What people did in that week is still, years later, how the quarter sorts out who to trust." },
    ],
  },
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
      { title: "The Night Ledger", type: "other", typeLabel: "Faction", era: "The Quiet Century", faction: "The Night Ledger", mood: "secretive", content: "A brokerage of favours operating out of the city's closed spaces. Every favour is recorded; nothing is ever forgiven, only traded." },
    ],
  },
];

// "faction" used to be a fixed asset type, but not every world has
// factions (or calls them that) -- a mystery world might have "suspects,"
// a sci-fi world "corporations," a myth world "pantheons." Anything that
// doesn't fit the universal categories below now lands in "other," with
// the AI (or the writer, via the World Book editor) supplying a
// per-entry typeLabel naming what it actually is (e.g. "Faction," "Clan,"
// "Guild") -- see generation.py/generation.js schemaFor().
export const TYPES = ["lore", "character", "location", "event", "other"];

// Icons for each type live in components/Icons.jsx (TYPE_ICONS / TypeIcon) —
// kept out of this data file so worldData.js stays framework-agnostic.
export const TYPE_META = {
  lore: { label: "Lore" },
  character: { label: "Character" },
  location: { label: "Location" },
  event: { label: "Event" },
  other: { label: "Other" },
};
