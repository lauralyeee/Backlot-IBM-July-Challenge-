import { useState, useEffect } from "react";
import { generateAsset, renameEra, removeEra, describeEras } from "../lib/api";
import { TYPE_META } from "../lib/worldData";
import { Chip, Field, Btn, Busy, Banner, EmptyState } from "../components/ui";
import { IconClock, TypeIcon, IconSpark, IconChevronUp, IconChevronDown } from "../components/Icons";
import AssetCard from "../components/AssetCard";

export default function Timeline({ world, assets, addAsset, setWorld, onWorldUpdated, refreshAssets }) {
  const [subjectId, setSubjectId] = useState("");
  const [era, setEra] = useState(world.eras[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const subject = assets.find((a) => String(a.id) === subjectId);

  // The eras editor now lives on this same screen, so a rename/removal of
  // the currently-selected shift target is one click away instead of a
  // screen navigation -- keep the selection valid instead of pointing at
  // an era that no longer exists.
  useEffect(() => {
    if (!world.eras.includes(era)) setEra(world.eras[0] || "");
  }, [world.eras]); // eslint-disable-line react-hooks/exhaustive-deps

  async function shift() {
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await generateAsset(world.id, "era_shift", {
        subjectId: subject.id,
        era,
      });
      const asset = { ...res.asset, era };
      addAsset(asset); setResult(asset);
    } catch (e) {
      setError(`Couldn't shift that entry: ${e.message} Please try again.`);
    }
    setBusy(false);
  }

  // ── Timeline / eras editor ───────────────────────────────────────────────
  // Lives here rather than in Settings -- this is where eras are actually
  // used, so setting them up (and seeing the effect immediately) belongs
  // on the same screen.
  const [saved, setSaved] = useState(false);
  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const [eraEditIndex, setEraEditIndex] = useState(null);
  const [eraEditValue, setEraEditValue] = useState("");
  const [eraNoteValue, setEraNoteValue] = useState("");
  const [describeBusy, setDescribeBusy] = useState(false);
  const [newEraName, setNewEraName] = useState("");
  const [eraBusy, setEraBusy] = useState(false);
  const [eraError, setEraError] = useState("");
  const [pendingRemoveEra, setPendingRemoveEra] = useState(null);
  const [mergeTarget, setMergeTarget] = useState("");

  function startRenameEra(i) {
    setEraEditIndex(i);
    setEraEditValue(world.eras[i]);
    setEraNoteValue((world.eraNotes || {})[world.eras[i]] || "");
    setEraError("");
  }

  function cancelRenameEra() {
    setEraEditIndex(null);
    setEraEditValue("");
  }

  async function saveRenameEra() {
    const oldEra = world.eras[eraEditIndex];
    const newEra = eraEditValue.trim();
    const newNote = eraNoteValue.trim();
    const oldNote = ((world.eraNotes || {})[oldEra] || "").trim();
    if (!newEra) { cancelRenameEra(); return; }
    if (newEra !== oldEra && world.eras.some((e, i) => i !== eraEditIndex && e.toLowerCase() === newEra.toLowerCase())) {
      setEraError(`"${newEra}" already exists in this timeline.`);
      return;
    }
    if (newEra === oldEra && newNote === oldNote) { cancelRenameEra(); return; }
    setEraBusy(true); setEraError("");
    try {
      let current = world;
      if (newEra !== oldEra) {
        // Rename goes through the dedicated endpoint so the note key AND
        // every asset tagged with the old era name follow the rename.
        const res = await renameEra(world.id, oldEra, newEra);
        current = res.world;
        onWorldUpdated(res.world);
        if (res.assetsUpdated > 0) await refreshAssets();
      }
      if (newNote !== oldNote) {
        setWorld({ ...current, eraNotes: { ...(current.eraNotes || {}), [newEra]: newNote } });
      }
      setEraEditIndex(null); setEraEditValue(""); setEraNoteValue("");
      flash();
    } catch (e) {
      setEraError(`Couldn't save: ${e.message}`);
    }
    setEraBusy(false);
  }

  // Pure reorder — same era strings, new order, no asset cascade needed —
  // so this just goes through the ordinary setWorld/patchWorld path.
  function moveEra(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= world.eras.length) return;
    const next = [...world.eras];
    [next[i], next[j]] = [next[j], next[i]];
    setWorld({ ...world, eras: next });
    flash();
  }

  // Pure append — no existing asset can already reference a brand-new era
  // name, so no cascade needed here either.
  function addEra() {
    const name = newEraName.trim();
    if (!name) return;
    if (world.eras.some((e) => e.toLowerCase() === name.toLowerCase())) {
      setEraError(`"${name}" already exists in this timeline.`);
      return;
    }
    setEraError("");
    setWorld({ ...world, eras: [...world.eras, name] });
    setNewEraName("");
    flash();
  }

  async function attemptRemoveEra(era_) {
    setEraError(""); setEraBusy(true);
    try {
      const res = await removeEra(world.id, era_);
      onWorldUpdated(res.world);
      if (res.assetsReassigned > 0) await refreshAssets();
      flash();
    } catch (e) {
      if (e.message.includes("409")) {
        setPendingRemoveEra(era_);
        setMergeTarget(world.eras.find((x) => x !== era_) || "");
      } else {
        setEraError(`Couldn't remove: ${e.message}`);
      }
    }
    setEraBusy(false);
  }

  async function autoDescribe() {
    setDescribeBusy(true); setEraError("");
    try {
      const res = await describeEras(world.id);
      onWorldUpdated(res.world);
      flash();
    } catch (e) {
      setEraError(`Couldn't write descriptions: ${e.message}`);
    }
    setDescribeBusy(false);
  }

  async function confirmRemoveWithMerge() {
    setEraBusy(true); setEraError("");
    try {
      const res = await removeEra(world.id, pendingRemoveEra, mergeTarget);
      onWorldUpdated(res.world);
      await refreshAssets();
      setPendingRemoveEra(null);
      flash();
    } catch (e) {
      setEraError(`Couldn't remove: ${e.message}`);
    }
    setEraBusy(false);
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, marginBottom: 6 }}>Time-Shift Mode</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14.5 }}>Pick an entry, choose an era, and see it re-rendered without breaking continuity.</p>
      </div>

      {assets.length === 0 ? (
        <EmptyState icon={IconClock} title="Nothing to time-shift yet" text="Add an entry to your World Book first, then come back here to see it in another era. You can still set up your eras below in the meantime." />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-label">1. Pick something from your world</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {assets.map((a) => (
                <Chip
                  key={a.id}
                  active={subjectId === String(a.id)}
                  onClick={() => setSubjectId(String(a.id))}
                  title={`Pick "${a.title}" (${TYPE_META[a.type]?.label || a.type}, ${a.era}) as the subject to time-shift`}
                >
                  <TypeIcon type={a.type} width={13} height={13} /> {a.title} <span style={{ opacity: 0.6 }}>· {a.era}</span>
                </Chip>
              ))}
            </div>

            <div className="section-label">2. Choose an era</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {world.eras.map((e) => (
                <button
                  key={e}
                  onClick={() => setEra(e)}
                  title={(world.eraNotes || {})[e] || ""}
                  style={{
                    flex: 1, padding: "14px 10px", borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "center",
                    border: `2px solid ${era === e ? "var(--accent)" : "var(--border)"}`,
                    background: era === e ? "var(--accent-soft)" : "var(--bg-elevated)",
                    color: era === e ? "var(--accent-strong)" : "var(--text)",
                    fontWeight: era === e ? 700 : 500, fontSize: 13.5,
                  }}
                >
                  {e}
                </button>
              ))}
            </div>

            {((world.eraNotes || {})[era] || "").trim() ? (
              <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "6px 0 0", lineHeight: 1.55 }}>
                {world.eraNotes[era]}
              </p>
            ) : (
              <p style={{ fontSize: 12.5, color: "var(--text-faint)", margin: "6px 0 0", lineHeight: 1.55 }}>
                "{era}" has no description yet. Add one below (or use Auto-describe)
                so shifts and portraits know what this era actually means.
              </p>
            )}

            <Btn variant="primary" onClick={shift} disabled={busy || !subject} title="Regenerate this entry as it would appear in the chosen era" style={{ marginTop: 12 }}>
              {busy ? "Traveling…" : `Show it in ${era}`}
            </Btn>
          </div>

          {busy && <Busy label={`Traveling to ${era}…`} />}
          {error && <Banner tone="danger">{error}</Banner>}

          {result && subject && (
            <div style={{ marginBottom: 24 }}>
              <div className="section-label">Before &amp; after</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} id="timeline-compare">
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Original · {subject.era}</div>
                  <AssetCard asset={subject} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--accent-strong)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Shifted · {era}</div>
                  <AssetCard asset={result} />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {saved && <Banner tone="ok">Saved.</Banner>}

      <div className="card">
        <h3 style={{ fontSize: 15.5, marginBottom: 4 }}>Set up your eras</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>
          Not fixed to 3. Add, edit, reorder, or remove eras. Order is the world's chronology.
          The descriptions matter: Time-Shift and portrait generation read them to understand
          what each era actually means, instead of guessing from its name.
        </p>
        {eraError && <p style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>{eraError}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {world.eras.map((e, i) => (
            <div key={e} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              {eraEditIndex === i ? (
                <>
                  <Field value={eraEditValue} onChange={(ev) => setEraEditValue(ev.target.value)} />
                  <Field
                    area
                    rows={2}
                    value={eraNoteValue}
                    onChange={(ev) => setEraNoteValue(ev.target.value)}
                    placeholder="What defines this era? 1-2 sentences: events, tone, tech/culture. Time-Shift and portraits read this."
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn small onClick={saveRenameEra} disabled={eraBusy} title="Save this era's name and description">Save</Btn>
                    <Btn small onClick={cancelRenameEra} title="Discard changes">Cancel</Btn>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 14 }}>{e}</span>
                    <Btn small onClick={() => moveEra(i, -1)} disabled={eraBusy || i === 0} title="Move earlier in the timeline"><IconChevronUp width={13} height={13} /></Btn>
                    <Btn small onClick={() => moveEra(i, 1)} disabled={eraBusy || i === world.eras.length - 1} title="Move later in the timeline"><IconChevronDown width={13} height={13} /></Btn>
                    <Btn small onClick={() => startRenameEra(i)} disabled={eraBusy} title="Rename or add a description for this era">Edit</Btn>
                    <Btn small onClick={() => attemptRemoveEra(e)} disabled={eraBusy || world.eras.length <= 1} title="Remove this era from the timeline">Remove</Btn>
                  </div>
                  {((world.eraNotes || {})[e] || "").trim() ? (
                    <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>{world.eraNotes[e]}</div>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No description yet. Use Edit to write one, or try Auto-describe below.</div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {pendingRemoveEra && (
          <Banner tone="danger">
            <div>
              <div style={{ marginBottom: 8 }}>Entries still use "{pendingRemoveEra}". Move them to another era first:</div>
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={{ marginBottom: 8, width: "100%", padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                {world.eras.filter((x) => x !== pendingRemoveEra).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn small onClick={confirmRemoveWithMerge} disabled={eraBusy} title="Move affected entries to the selected era, then remove this one">Move &amp; remove</Btn>
                <Btn small onClick={() => setPendingRemoveEra(null)} title="Cancel removing this era">Cancel</Btn>
              </div>
            </div>
          </Banner>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Field value={newEraName} onChange={(e) => setNewEraName(e.target.value)} placeholder="Add a new era…" />
          <Btn small onClick={addEra} disabled={!newEraName.trim()} title="Add this as a new era">Add</Btn>
        </div>
        <Btn small onClick={autoDescribe} disabled={describeBusy || eraBusy} title="Automatically write short descriptions for eras that don't have one yet">
          <IconSpark width={13} height={13} /> {describeBusy ? "Writing descriptions…" : "Auto-describe eras (fills empty ones)"}
        </Btn>
      </div>

      <style>{`@media (max-width: 760px) { #timeline-compare { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
