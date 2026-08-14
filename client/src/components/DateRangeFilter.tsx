interface Props {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function DateRangeFilter({ from, to, onChange }: Props) {
  const presets = [
    { label: 'Hoy', from: today(), to: today() },
    { label: '7 días', from: isoDaysAgo(6), to: today() },
    { label: '30 días', from: isoDaysAgo(29), to: today() },
  ];

  return (
    <div className="date-filter">
      <div className="date-filter-presets">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`chip ${from === p.from && to === p.to ? 'chip-active' : ''}`}
            onClick={() => onChange({ from: p.from, to: p.to })}
          >
            {p.label}
          </button>
        ))}
        {(from || to) && (
          <button type="button" className="chip" onClick={() => onChange({ from: '', to: '' })}>
            Limpiar
          </button>
        )}
      </div>
      <div className="date-filter-inputs">
        <input type="date" value={from} onChange={(e) => onChange({ from: e.target.value, to })} />
        <span>–</span>
        <input type="date" value={to} onChange={(e) => onChange({ from, to: e.target.value })} />
      </div>
    </div>
  );
}
