import { TYPE_META } from "../lib/worldData";
import { Tag } from "./ui";
import { TypeIcon } from "./Icons";

export default function AssetCard({ asset, onClick, compact }) {
  const meta = TYPE_META[asset.type] || { label: asset.type };
  // "other"-typed entries carry their own AI- (or writer-) assigned label
  // (e.g. "Faction", "Clan") instead of the generic "Other" bucket name.
  const typeLabel = asset.type === "other" && asset.typeLabel ? asset.typeLabel : meta.label;
  return (
    <div
      className={`card ${onClick ? "card-hover" : ""} fade-in`}
      onClick={onClick}
      style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <TypeIcon type={asset.type} width={16} height={16} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16.5, lineHeight: 1.3 }}>{asset.title}</div>
        </div>
        {asset.offline && <span className="badge-offline">offline draft</span>}
      </div>
      {!compact && (
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-dim)", margin: 0, flex: 1 }}>
          {asset.content}
        </p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "auto" }}>
        <Tag>{typeLabel}</Tag>
        <Tag>{asset.era}</Tag>
        {asset.faction !== "—" && <Tag>{asset.faction}</Tag>}
        <Tag>{asset.mood}</Tag>
      </div>
    </div>
  );
}
