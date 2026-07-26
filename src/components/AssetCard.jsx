import { TYPE_META } from "../lib/worldData";
import { Tag } from "./ui";

export default function AssetCard({ asset, onClick, compact }) {
  const meta = TYPE_META[asset.type] || { icon: "📄", label: asset.type };
  return (
    <div
      className={`card ${onClick ? "card-hover" : ""} fade-in`}
      onClick={onClick}
      style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 18 }}>{meta.icon}</span>
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
        <Tag>{meta.label}</Tag>
        <Tag>{asset.era}</Tag>
        {asset.faction !== "—" && <Tag>{asset.faction}</Tag>}
        <Tag>{asset.mood}</Tag>
      </div>
    </div>
  );
}
