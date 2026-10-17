import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, Priority, Status } from '../components/bits';
import { fmt, useApi } from '../hooks';

const TITLES = { physician: 'My Orders', lab_admin: 'Order Queue', technician: 'My Worklist' };
const STATUSES = ['', 'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED'];

/** Search + filter orders (R-17). The backend scopes results to the caller's role. */
export default function Orders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'lab_admin';
  const [draft, setDraft] = useState({ patient: '', test: '', physician: '', status: '', priority: '', from: '', to: '' });
  const [filters, setFilters] = useState(isAdmin ? { unassigned: 'true' } : {});
  const [tab, setTab] = useState(isAdmin ? 'unassigned' : 'all');
  const { data, error, loading, reload } = useApi(`/orders${qs({ ...filters, limit: 100 })}`, { interval: 15000 });
  const techs = useApi('/users?role=technician', { skip: !isAdmin });
  const [assignErr, setAssignErr] = useState(null);

  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const apply = (e) => {
    e && e.preventDefault();
    setTab('all');
    setFilters({ ...draft });
  };
  const switchTab = (t) => {
    setTab(t);
    setFilters(t === 'unassigned' ? { unassigned: 'true' } : t === 'active' ? { status: 'IN_PROGRESS' } : {});
  };

  const assign = async (orderId, technicianId) => {
    setAssignErr(null);
    try {
      await api.post(`/orders/${orderId}/assign`, { technicianId: Number(technicianId) });
      reload();
    } catch (e) {
      setAssignErr(e.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{TITLES[user.role]}</h1>
          <div className="muted">{data ? `${data.total} order${data.total === 1 ? '' : 's'}` : ' '}</div>
        </div>
        {user.role === 'physician' && <Link to="/orders/new"><button className="primary">New order</button></Link>}
      </div>

      {isAdmin && (
        <div className="tabs">
          {[['unassigned', 'Awaiting assignment'], ['active', 'In progress'], ['all', 'All orders']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => switchTab(k)}>{l}</button>
          ))}
        </div>
      )}

      <form className="card row" onSubmit={apply} style={{ alignItems: 'flex-end' }}>
        {user.role !== 'patient' && <label>Patient<input value={draft.patient} onChange={set('patient')} placeholder="name or ID" /></label>}
        <label>Test<input value={draft.test} onChange={set('test')} placeholder="code or name" style={{ width: 120 }} /></label>
        {user.role !== 'physician' && <label>Physician<input value={draft.physician} onChange={set('physician')} style={{ width: 140 }} /></label>}
        <label>Status
          <select value={draft.status} onChange={set('status')}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}
          </select>
        </label>
        <label>Priority
          <select value={draft.priority} onChange={set('priority')}>
            <option value="">Any</option><option value="stat">STAT</option><option value="routine">Routine</option>
          </select>
        </label>
        <label>From<input type="date" value={draft.from} onChange={set('from')} /></label>
        <label>To<input type="date" value={draft.to} onChange={set('to')} /></label>
        <button className="primary">Search</button>
        <button type="button" onClick={() => { setDraft({ patient: '', test: '', physician: '', status: '', priority: '', from: '', to: '' }); switchTab(isAdmin ? 'unassigned' : 'all'); }}>Clear</button>
      </form>

      <ErrorMsg error={error || assignErr} />
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th><th>Priority</th><th>Patient</th><th>Tests</th><th>Physician</th>
                <th>{isAdmin ? 'Technician' : 'Technician'}</th><th>Status</th><th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && <tr><td colSpan={8} className="empty">Loading…</td></tr>}
              {data && data.orders.length === 0 && <tr><td colSpan={8} className="empty">No orders match.</td></tr>}
              {data && data.orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={(e) => e.target.tagName !== 'SELECT' && navigate(`/orders/${o.id}`)}>
                  <td className="mono">#{o.id}</td>
                  <td><Priority p={o.priority} /></td>
                  <td>{o.patient_name}</td>
                  <td className="mono" style={{ fontSize: 12.5 }}>{(o.items || []).map((i) => i.code).join(', ')}</td>
                  <td>{o.physician_name}</td>
                  <td>
                    {isAdmin && ['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(o.status) && techs.data ? (
                      <select value={o.assigned_technician_id || ''} onChange={(e) => assign(o.id, e.target.value)} onClick={(e) => e.stopPropagation()}>
                        <option value="" disabled>Assign…</option>
                        {techs.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    ) : (o.technician_name || <span className="muted">—</span>)}
                  </td>
                  <td><Status s={o.status} /></td>
                  <td className="muted" style={{ fontSize: 13 }}>{fmt(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
