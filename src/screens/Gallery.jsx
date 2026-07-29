import "@google/model-viewer";
import { useState, useEffect, useRef, useMemo } from "react";
import { uploadModel3D, generateModel3D, getModel3DStatus, deleteModel3D } from "../lib/api";
import { Btn, EmptyState, Banner } from "../components/ui";
import { IconUpload, IconCube, IconClose, IconTrash, TypeIcon } from "../components/Icons";
import { TYPES, TYPE_META } from "../lib/worldData";

const POLL_INTERVAL_MS = 4000;

// <model-viewer>'s CachingGLTFLoader (and the browser's own cache for
// <img>/<video>) caches a loaded file by its exact src URL, and model_path
// is stable per asset -- so without this, re-generating or re-uploading the
// SAME asset's concept media keeps showing whatever was cached from the
// first load, even after the underlying file changes or is deleted.
// model_added_at changes on every successful generate/upload, so appending
// it as a query string busts both caches.
function mediaSrc(asset) {
  if (!asset?.modelPath) return undefined;
  return asset.modelAddedAt ? `${asset.modelPath}?v=${asset.modelAddedAt}` : asset.modelPath;
}

// Accepted concept-media file extensions, mirroring the backend's
// classification in main.py's upload_model3d handler.
const ACCEPT_EXT = ".glb,.gltf,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov";
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);

function extOf(filename) {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

// A single tile/frame that renders whichever concept-media kind an asset
// has -- a rotating 3D model, a still concept-art image, or an autoplaying
// video -- so the grid and the focused overlay can share one component
// instead of branching in three places.
function ConceptMedia({ asset, style, interactive, ...rest }) {
  const ext = extOf(asset.modelPath || "");
  const kind = asset.modelKind || (IMAGE_EXTS.has(ext) ? "image" : VIDEO_EXTS.has(ext) ? "video" : "3d");
  const src = mediaSrc(asset);
  if (kind === "image") {
    return <img src={src} alt={asset.title} style={{ objectFit: "contain", ...style }} {...rest} />;
  }
  if (kind === "video") {
    return (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        controls={interactive}
        style={{ objectFit: "contain", ...style }}
        {...rest}
      />
    );
  }
  return (
    <model-viewer
      src={src}
      alt={asset.title}
      camera-controls
      auto-rotate
      disable-zoom={interactive ? undefined : true}
      shadow-intensity="1"
      exposure="1"
      style={style}
      {...rest}
    />
  );
}

const MEDIA_KIND_LABEL = { "3d": "3D model", image: "concept art", video: "video" };

export default function Gallery({ world, assets, addAsset }) {
  const withModel = useMemo(
    () => assets.filter((a) => a.modelStatus === "ready" && a.modelPath),
    [assets]
  );
  const pending = useMemo(
    () => assets.filter((a) => a.modelStatus === "pending"),
    [assets]
  );

  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [genBusyId, setGenBusyId] = useState(null);
  const [deleteBusyId, setDeleteBusyId] = useState(null);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(null);
  const fileInputRef = useRef(null);

  // Assets grouped into a row per category (Character, Location, ...) in
  // canonical TYPES order, skipping any type this world has nothing of --
  // replaces the old single flat strip of every asset's icon, which read as
  // a wall of undifferentiated squares once a world had more than a
  // handful of entries.
  const assetsByType = useMemo(
    () => TYPES.map((t) => ({ type: t, items: assets.filter((a) => a.type === t) })).filter((g) => g.items.length),
    [assets]
  );

  // Poll every asset currently "pending" (Blender/CharMorph generation in
  // flight) until it flips to ready/failed. One shared interval covers all
  // of them rather than one timer per row.
  useEffect(() => {
    if (pending.length === 0) return;
    const id = setInterval(async () => {
      for (const a of pending) {
        try {
          const res = await getModel3DStatus(world.id, a.id);
          if (res.asset.modelStatus !== "pending") addAsset(res.asset);
        } catch {
          // transient — try again next tick
        }
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pending, world.id, addAsset]);

  function openFilePicker() {
    if (!selectedAssetId) return;
    setError("");
    fileInputRef.current?.click();
  }

  async function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedAssetId) return;
    const ext = extOf(file.name);
    if (!ACCEPT_EXT.split(",").includes(ext)) {
      setError(`"${ext || "that file"}" isn't a supported format. Choose a 3D model (.glb/.gltf), an image, or a video.`);
      return;
    }
    setUploadBusy(true);
    setError("");
    try {
      const res = await uploadModel3D(world.id, Number(selectedAssetId), file);
      addAsset(res.asset);
      setSelectedAssetId("");
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
    }
    setUploadBusy(false);
  }

  async function handleGenerate(assetId) {
    setGenBusyId(assetId);
    setError("");
    try {
      const res = await generateModel3D(world.id, assetId);
      addAsset(res.asset);
    } catch (err) {
      setError(`Couldn't start generation: ${err.message}`);
    }
    setGenBusyId(null);
  }

  async function handleDelete(assetId) {
    setDeleteBusyId(assetId);
    setError("");
    try {
      const res = await deleteModel3D(world.id, assetId);
      addAsset(res.asset);
      if (focused?.id === assetId) setFocused(null);
    } catch (err) {
      setError(`Couldn't remove model: ${err.message}`);
    }
    setDeleteBusyId(null);
  }

  const selectedAsset = assets.find((a) => String(a.id) === String(selectedAssetId));

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, marginBottom: 6 }}>Gallery</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", maxWidth: 640 }}>
          Visual reference for anything in your world: a rotating 3D concept model,
          a piece of concept art, or a short video, attached to any character, location,
          or entry. Generate a 3D model for a character directly from canon, or upload
          your own media for anything that can't be generated.
        </p>
      </div>

      {error && (
        <Banner tone="danger" action={<Btn small onClick={() => setError("")} title="Dismiss this error">Dismiss</Btn>}>
          {error}
        </Banner>
      )}

      {/* Selection area, revamped: assets grouped into a labeled row per
          category instead of one flat icon strip, inside a borderless
          section (a hairline below replaces the old bordered "card" box).
          The upload/generate/remove actions only appear once something's
          selected, as a slim contextual bar rather than three buttons
          permanently sitting in the toolbar. */}
      <div className="gallery-picker">
        <div className="gallery-picker-head">
          <label className="section-label" style={{ marginBottom: 0 }}>Add concept media</label>
          <p className="gallery-picker-sub">Pick an asset below, then upload your own media or generate a 3D concept for it.</p>
        </div>

        {assetsByType.map(({ type, items }) => (
          <div className="asset-category-row" key={type}>
            <div className="asset-category-label">
              <TypeIcon type={type} width={13} height={13} />
              {type === "other" ? "Other" : TYPE_META[type]?.label || type}
            </div>
            <div className="asset-chip-row">
              {items.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`asset-chip ${String(selectedAssetId) === String(a.id) ? "active" : ""}`}
                  onClick={() => setSelectedAssetId(String(a.id))}
                  title={a.modelStatus === "ready" ? `Has ${MEDIA_KIND_LABEL[a.modelKind || "3d"]}` : undefined}
                  aria-pressed={String(selectedAssetId) === String(a.id)}
                >
                  <TypeIcon type={a.type} width={14} height={14} />
                  <span>{a.title}</span>
                  {a.modelStatus === "ready" && <span className="asset-chip-dot" />}
                </button>
              ))}
            </div>
          </div>
        ))}

        {selectedAsset && (
          <div className="gallery-action-bar fade-in">
            <div className="gallery-action-bar-title">
              <TypeIcon type={selectedAsset.type} width={15} height={15} />
              <strong>{selectedAsset.title}</strong>
              <Btn variant="ghost" small onClick={() => setSelectedAssetId("")}>
                Change
              </Btn>
            </div>
            <div className="gallery-action-bar-buttons">
              <Btn onClick={openFilePicker} disabled={uploadBusy} title="Upload a 3D model (.glb/.gltf), a concept-art image, or a short video for the selected asset">
                <IconUpload width={15} height={15} /> {uploadBusy ? "Uploading…" : "Upload media"}
              </Btn>
              {selectedAsset.type === "character" ? (
                <Btn
                  variant="primary"
                  onClick={() => handleGenerate(selectedAsset.id)}
                  disabled={genBusyId === selectedAsset.id || selectedAsset.modelStatus === "pending"}
                  title="Generate a 3D concept model from canon via Blender + CharMorph"
                >
                  <IconCube width={15} height={15} /> {selectedAsset.modelStatus === "pending" || genBusyId === selectedAsset.id
                    ? "Generating…"
                    : "Generate 3D concept"}
                </Btn>
              ) : (
                <span
                  className="gallery-action-note"
                  title="Blender/CharMorph generation drafts body-shape sliders from a character's canon sheet, so 3D generation only applies to character assets. Any type can still upload concept art or a video."
                >
                  <IconCube width={13} height={13} style={{ flexShrink: 0 }} /> 3D generation isn't available for a {selectedAsset.type}. Upload concept art or a video instead
                </span>
              )}
              {selectedAsset.modelStatus === "ready" && (
                <Btn
                  variant="danger"
                  onClick={() => handleDelete(selectedAsset.id)}
                  disabled={deleteBusyId === selectedAsset.id}
                  title="Remove this asset's concept media (deletes the file and clears it from the Gallery)"
                >
                  <IconTrash width={15} height={15} /> {deleteBusyId === selectedAsset.id ? "Removing…" : "Remove media"}
                </Btn>
              )}
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_EXT}
          onChange={handleFileChosen}
          style={{ display: "none" }}
        />
      </div>

      {pending.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {pending.map((a) => (
            <span key={a.id} className="tag" title="Blender/CharMorph generation in progress" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span className="pulse-dot" style={{ width: 6, height: 6 }} /> {a.title}: generating…
            </span>
          ))}
        </div>
      )}

      {withModel.length === 0 ? (
        <EmptyState
          icon={IconCube}
          title="No concept media yet"
          text="Upload a 3D model, an image, or a video (or generate a 3D model for a character above) to see it here."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          {withModel.map((a) => (
            <div
              key={a.id}
              className="gallery-tile"
              onClick={() => setFocused(a)}
              title={`${a.title}: click to open a larger view`}
            >
              <ConceptMedia
                asset={a}
                style={{ width: "100%", height: 200, background: "var(--bg-elevated)", display: "block" }}
              />
              <div style={{ marginTop: 10, fontSize: 13.5, fontWeight: 600 }}>{a.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                {a.type} · {MEDIA_KIND_LABEL[a.modelKind || "3d"]} · {a.modelSource?.startsWith("charmorph") ? "generated" : "uploaded"}
              </div>
            </div>
          ))}
        </div>
      )}

      {focused && (
        // Borderless screening-room view: the media itself is the entire
        // frame -- no card box or panel chrome around it, just a dim
        // backdrop, a minimal floating close control, and the title as a
        // soft caption rather than a boxed header bar. Works the same for
        // a rotating 3D model, a still image, or an autoplaying video.
        <div
          onClick={() => setFocused(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.86)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 100, animation: "fadeIn 0.2s ease",
          }}
        >
          <button
            type="button"
            className="gallery-close-btn"
            onClick={() => setFocused(null)}
            title="Close"
            style={{ position: "fixed", top: 26, right: 26, width: 42, height: 42, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <IconClose width={18} height={18} />
          </button>
          <ConceptMedia
            asset={focused}
            interactive
            style={{ width: "min(94vw, 1200px)", height: "min(86vh, 860px)", background: "transparent", display: "block" }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            style={{
              position: "fixed", left: 0, right: 0, bottom: 0, padding: "48px 32px 28px",
              background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
              pointerEvents: "none", textAlign: "center",
            }}
          >
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, color: "#fff" }}>{focused.title}</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
              {focused.type} · {MEDIA_KIND_LABEL[focused.modelKind || "3d"]}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
