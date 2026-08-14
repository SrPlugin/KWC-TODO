interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchBar({ value, onChange }: Props) {
  return (
    <div className="search-bar">
      <span className="search-bar-icon" aria-hidden="true">
        🔍
      </span>
      <input
        type="search"
        value={value}
        placeholder="Buscar tarea por título, descripción o responsable…"
        aria-label="Buscar tarea"
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="search-bar-clear" aria-label="Limpiar búsqueda" onClick={() => onChange('')}>
          ×
        </button>
      )}
    </div>
  );
}
