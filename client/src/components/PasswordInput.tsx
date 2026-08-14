import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export default function PasswordInput({ className, ...rest }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input-wrap">
      <input type={visible ? 'text' : 'password'} className={className} {...rest} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        tabIndex={-1}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l18 18" strokeLinecap="round" />
            <path d="M10.58 10.58a2 2 0 102.83 2.83" strokeLinecap="round" />
            <path d="M9.36 5.29A9.99 9.99 0 0112 5c5 0 9 4.5 10 7-.32.86-1 1.99-2.02 3.02M6.11 6.1C4.14 7.42 2.67 9.36 2 12c1 2.5 5 7 10 7 1.4 0 2.7-.32 3.86-.86" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
