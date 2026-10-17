import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ago, useApi } from '../hooks';

export const linkFor = (n) => {
  if (n.entity_type === 'order') return `/orders/${n.entity_id}`;
  if (n.entity_type === 'panic_alert') return '/panic';
  return null;
};

/** Polls every 10 s - comfortably inside the 30 s delivery target (NFR-02). */
export default function NotificationBell() {
  const { data, reload } = useApi('/notifications', { interval: 10000 });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const unread = data ? data.unread : 0;
  const list = data ? data.notifications.slice(0, 15) : [];

  const openOne = async (n) => {
    if (!n.read_at) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    setOpen(false);
    reload();
    const to = linkFor(n);
    if (to) navigate(to);
  };

  return (
    <div className="bell" ref={ref}>
      <button className="small" onClick={() => setOpen(!open)} aria-label="Notifications">
        Notifications
        {unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="dropdown">
          <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
            <strong style={{ fontSize: 14 }}>Notifications</strong>
            {unread > 0 && (
              <button className="link small" onClick={async () => { await api.post('/notifications/read-all'); reload(); }}>
                Mark all read
              </button>
            )}
          </div>
          {list.length === 0 && <div className="empty">Nothing yet</div>}
          {list.map((n) => (
            <div
              key={n.id}
              className={`notif ${n.read_at ? '' : 'unread'} ${n.type.startsWith('PANIC') ? 'panicky' : ''}`}
              onClick={() => openOne(n)}
            >
              <div>{n.message}</div>
              <div className="when">{ago(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
