export function Btn({ children, onClick, disabled, variant, small, style, type = "button" }) {
  const cls = ["btn", variant === "primary" && "btn-primary", variant === "ghost" && "btn-ghost", small && "btn-sm"].filter(Boolean).join(" ");
  return <button type={type} className={cls} onClick={onClick} disabled={disabled} style={style}>{children}</button>;
}

export function Chip({ children, onClick, active, teal }) {
  return (
    <button type="button" className={`chip ${active ? "active" : ""} ${teal ? "chip-teal" : ""}`} onClick={onClick}>
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

export function EmptyState({ icon, title, text, action }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 24px", color: "var(--text-dim)" }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "var(--text)", marginBottom: 6 }}>{title}</div>
      <p style={{ fontSize: 14.5, maxWidth: 400, margin: "0 auto 18px", lineHeight: 1.6 }}>{text}</p>
      {action}
    </div>
  );
}

export function Banner({ tone = "accent", children, action }) {
  const colorMap = {
    accent: { bg: "var(--accent-soft)", border: "var(--accent)" },
    danger: { bg: "var(--danger-soft)", border: "var(--danger)" },
    ok: { bg: "var(--ok-soft)", border: "var(--ok)" },
    teal: { bg: "var(--teal-soft)", border: "var(--teal)" },
  };
  const c = colorMap[tone];
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: "var(--radius)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
      <div style={{ flex: 1, fontSize: 14.5, lineHeight: 1.55 }}>{children}</div>
      {action}
    </div>
  );
}
