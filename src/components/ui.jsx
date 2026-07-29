import { IconClose, IconAlert, IconCheck, IconGlobe } from "./Icons";

export function Btn({ children, onClick, disabled, variant, small, style, type = "button", ...rest }) {
  const cls = ["btn", variant === "primary" && "btn-primary", variant === "ghost" && "btn-ghost", small && "btn-sm"].filter(Boolean).join(" ");
  return <button type={type} className={cls} onClick={onClick} disabled={disabled} style={style} {...rest}>{children}</button>;
}

export function Chip({ children, onClick, active, teal, ...rest }) {
  return (
    <button type="button" className={`chip ${active ? "active" : ""} ${teal ? "chip-teal" : ""}`} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

export function Field({ area, rows = 3, ...props }) {
  return area
    ? <textarea rows={rows} className="field" {...props} />
    : <input className="field" {...props} />;
}

export function Tag({ children }) {
  return <span className="tag">{children}</span>;
}

export function SectionLabel({ children }) {
  return <div className="section-label">{children}</div>;
}

export function Busy({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0", color: "var(--text-dim)", fontSize: 14.5 }}>
      <span className="pulse-dot" />
      {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 24px", color: "var(--text-dim)" }}>
      {Icon && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, opacity: 0.55 }}>
          <Icon width={30} height={30} />
        </div>
      )}
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 21, color: "var(--text)", marginBottom: 6 }}>{title}</div>
      <p style={{ fontSize: 14.5, maxWidth: 400, margin: "0 auto 18px", lineHeight: 1.6 }}>{text}</p>
      {action}
    </div>
  );
}

// The palette is deliberately monochrome (no hue for any tone), so a
// banner's meaning is carried by its icon and border weight instead of
// color: an alert triangle for danger, a check for a confirmation, a
// compass mark for a neutral/informational note. Distinguishable at a
// glance without relying on red/green.
export function Banner({ tone = "accent", children, action, onClose }) {
  const toneMap = {
    accent: { bg: "var(--accent-soft)", border: "var(--border)", Icon: IconGlobe, weight: 1 },
    danger: { bg: "var(--danger-soft)", border: "var(--text)", Icon: IconAlert, weight: 2 },
    ok: { bg: "var(--ok-soft)", border: "var(--text-dim)", Icon: IconCheck, weight: 1 },
    teal: { bg: "var(--teal-soft)", border: "var(--border)", Icon: IconGlobe, weight: 1 },
  };
  const c = toneMap[tone];
  return (
    <div style={{ background: c.bg, borderLeft: `${c.weight === 2 ? 3 : 2}px solid ${c.border}`, border: `1px solid var(--border-soft)`, borderLeftWidth: c.weight === 2 ? 3 : 2, borderLeftColor: c.border, borderRadius: "var(--radius)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
      <c.Icon width={18} height={18} style={{ flexShrink: 0, color: "var(--text-dim)" }} />
      <div style={{ flex: 1, fontSize: 14.5, lineHeight: 1.55 }}>{children}</div>
      {action}
      {onClose && (
        <button
          type="button"
          className="icon-btn"
          title="Dismiss"
          onClick={onClose}
          style={{ flexShrink: 0, opacity: 0.65 }}
        >
          <IconClose width={15} height={15} />
        </button>
      )}
    </div>
  );
}
