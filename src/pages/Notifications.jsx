import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { linkFor } from '../components/NotificationBell';
import { fmt, useApi } from '../hooks';

export default function Notifications() {
  const { data, reload } = useApi('/notifications', { interval: 10000 });
  const navigate = useNavigate();
  const open = async (n) => {
    if (!n.read_at) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    reload();
    const to = linkFor(n);
    if (to) navigate(to);
  };
  return (
    <>
      <div className="page-head">
        <div><h1>Notifications</h1><div className="muted">{data ? `${data.unread} unread` : ''}</div></div>
        <button onClick={async () => { await api.post('/notifications/read-all'); reload(); }}>Mark all read</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {data && data.notifications.length === 0 && <div className="empty">No notifications.</div>}
        {(data?.notifications || []).map((n) => (
          <div key={n.id} className={`notif ${n.read_at ? '' : 'unread'} ${n.type.startsWith('PANIC') ? 'panicky' : ''}`} onClick={() => open(n)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>{n.message}</span>
              <span className="badge">{n.type.replace(/_/g, ' ').toLowerCase()}</span>
            </div>
            <div className="when">{fmt(n.created_at)}</div>
          </div>
        ))}
      </div>
    </>
  );
}
