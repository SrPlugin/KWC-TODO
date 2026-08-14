import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { socket } from '../socket';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../api';
import type { Notification } from '../types';

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUnreadRef = useRef(0);

  const load = useCallback(
    async (announce: boolean) => {
      if (!user) return;
      try {
        const data = await fetchNotifications(user.id);
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);

        if (announce && data.unreadCount > lastUnreadRef.current) {
          const newest = data.notifications.find((n) => !n.read);
          if (newest && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('KWC INC S.A', { body: newest.message });
          }
        }
        lastUnreadRef.current = data.unreadCount;
      } catch {
        // silencioso: las notificaciones no son críticas para el flujo principal
      }
    },
    [user]
  );

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    load(false);
    const onChanged = () => load(true);
    socket.on('notifications:changed', onChanged);
    return () => {
      socket.off('notifications:changed', onChanged);
    };
  }, [load]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function handleOpenNotification(n: Notification) {
    if (!user) return;
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: 1 } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await markNotificationRead(user.id, n.id);
      } catch {
        load(false);
      }
    }
  }

  async function handleMarkAll() {
    if (!user) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead(user.id);
    } catch {
      load(false);
    }
  }

  if (!user) return null;

  return (
    <div className="notif-bell-container" ref={containerRef}>
      <button type="button" className="notif-bell" onClick={() => setOpen((o) => !o)} aria-label="Notificaciones">
        🔔
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <span>Notificaciones</span>
            {unreadCount > 0 && (
              <button type="button" className="notif-mark-all" onClick={handleMarkAll}>
                Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="notif-list">
            {notifications.length === 0 && <p className="hint-text notif-empty">Sin notificaciones</p>}
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`notif-item ${!n.read ? 'notif-item-unread' : ''}`}
                onClick={() => handleOpenNotification(n)}
              >
                <span
                  className={`notif-dot ${
                    n.type === 'completed'
                      ? 'notif-dot-completed'
                      : n.type === 'message'
                        ? 'notif-dot-message'
                        : 'notif-dot-assigned'
                  }`}
                />
                <span className="notif-text">
                  <span>{n.message}</span>
                  <span className="notif-time">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
