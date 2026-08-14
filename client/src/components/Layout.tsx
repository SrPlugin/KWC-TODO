import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { socket } from '../socket';
import { ROLE_LABELS } from '../types';
import NotificationBell from './NotificationBell';

export default function Layout() {
  const { user, logout } = useAuth();

  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

  if (!user) return null;
  const isOwner = user.role === 'dueno';

  return (
    <div className="board-page">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="login-dot" />
          <h1>KWC INC S.A</h1>
        </div>
        <div className="topbar-user">
          <NotificationBell />
          <div className="topbar-user-info">
            <strong>{user.name}</strong>
            <span>{ROLE_LABELS[user.role]}</span>
          </div>
          <button className="btn-ghost" onClick={logout}>
            Salir
          </button>
        </div>
      </header>

      <nav className="main-nav">
        <NavLink to="/" end className={({ isActive }) => `main-nav-link ${isActive ? 'main-nav-active' : ''}`}>
          Tablero
        </NavLink>
        <NavLink to="/dashboard" className={({ isActive }) => `main-nav-link ${isActive ? 'main-nav-active' : ''}`}>
          Dashboard
        </NavLink>
        <NavLink to="/history" className={({ isActive }) => `main-nav-link ${isActive ? 'main-nav-active' : ''}`}>
          Historial
        </NavLink>
        {isOwner && (
          <NavLink to="/users" className={({ isActive }) => `main-nav-link ${isActive ? 'main-nav-active' : ''}`}>
            Usuarios
          </NavLink>
        )}
      </nav>

      <Outlet />
    </div>
  );
}
