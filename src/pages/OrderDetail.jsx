import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download } from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, Flag, Pipeline, Priority, ResultValue, Status } from '../components/bits';
import ResultForm from '../components/ResultForm';
import { fmt, useAction, useApi } from '../hooks';

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: order, error, reload } = useApi(`/orders/${id}`, { interval: 15000 });
  const act = useAction();
  const [showAudit, setShowAudit] = useState(false);

  if (error) return <ErrorMsg error={error} />;
  if (!order) return <div className="muted">Loading…</div>;

  const isTech = user.role === 'technician' && order.assigned_technician_id === user.id;
  const isOrderingDoc = user.role === 'physician' && order.physician_id === user.id;
  const isAdmin = user.role === 'lab_admin';
  const needsCollection = order.items.some((i) => i.status === 'COLLECTION_REQUIRED');
  const live = !['CLOSED', 'CANCELLED'].includes(order.status);

  const run = (fn) => act.run(async () => { await fn(); await reload(); });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <h1>Order #{order.id}</h1>
            <Priority p={order.priority} />
            <Status s={order.status} />
          </div>
          <div className="muted">Placed {fmt(order.created_at)}{order.closed_at && ` · closed ${fmt(order.closed_at)}`}</div>
        </div>
        <div className="row">
          {isTech && needsCollection && live && (
            <button className="primary" disabled={act.busy} onClick={() => run(() => api.post(`/orders/${order.id}/specimens`))}>
              Record specimen collection
            </button>
          )}
          {(isOrderingDoc || isAdmin) && ['PENDING', 'ASSIGNED'].includes(order.status) && (
            <button className="danger" disabled={act.busy} onClick={() => {
              const reason = window.prompt('Reason for cancelling this order?');
              if (reason !== null) run(() => api.post(`/orders/${order.id}/cancel`, { reason }));
            }}>Cancel order</button>
          )}
          {(isOrderingDoc || isAdmin) && order.status === 'IN_PROGRESS' && (
            <button disabled={act.busy} onClick={() => run(() => api.post(`/orders/${order.id}/close`))}>Close order</button>
          )}
        </div>
      </div>
      <ErrorMsg error={act.error} />

      <div className="grid-2">
        <div className="card">
          <dl className="kv">
            <dt>Patient</dt>
            <dd>
              {['physician', 'lab_admin'].includes(user.role)
                ? <Link to={`/patients/${order.patient_id}`}>{order.patient_name}</Link>
                : order.patient_name}
              {order.patient_dob && <span className="muted"> · DOB {String(order.patient_dob).slice(0, 10)}</span>}
            </dd>
            <dt>Ordering physician</dt><dd>{order.physician_name}</dd>
            <dt>Technician</dt>
            <dd>{isAdmin && live ? <AssignSelect order={order} onDone={reload} /> : (order.technician_name || <span className="muted">Unassigned</span>)}</dd>
            {order.notes && (<><dt>Notes</dt><dd>{order.notes}</dd></>)}
          </dl>
        </div>
        <div className="card">
          <h3>Specimens</h3>
          {order.specimens.length === 0 && <div className="muted" style={{ fontSize: 14 }}>No specimen collected yet.</div>}
          {order.specimens.map((s) => <SpecimenRow key={s.id} s={s} canAct={isTech} onChange={reload} />)}
          {order.panels.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Panels</h3>
              {order.panels.map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
                  <span>{p.name} <span className="mono muted">{p.code}</span></span>
                  <Status s={p.status} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <h2 style={{ marginTop: 8 }}>Tests</h2>
      {order.items.map((item) => (
        <ItemCard key={item.id} item={item} order={order} user={user} isTech={isTech} isOrderingDoc={isOrderingDoc} isAdmin={isAdmin} onChange={reload} />
      ))}

      {user.role !== 'patient' && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Audit trail</h2>
            <button className="small" onClick={() => setShowAudit(!showAudit)}>{showAudit ? 'Hide' : 'Show'}</button>
          </div>
          {showAudit && <AuditTrail orderId={order.id} />}
        </div>
      )}
    </>
  );
}

function AssignSelect({ order, onDone }) {
  const techs = useApi('/users?role=technician');
  const act = useAction();
  if (!techs.data) return null;
  return (
    <span>
      <select value={order.assigned_technician_id || ''} disabled={act.busy}
        onChange={(e) => act.run(async () => { await api.post(`/orders/${order.id}/assign`, { technicianId: Number(e.target.value) }); onDone(); })}>
        <option value="" disabled>Assign technician…</option>
        {techs.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <ErrorMsg error={act.error} />
    </span>
  );
}

function SpecimenRow({ s, canAct, onChange }) {
  const act = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '8px 0', fontSize: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="mono">{s.accession_number}</span>
        <Status s={s.status} />
      </div>
      <div className="muted" style={{ fontSize: 12.5 }}>
        Collected {fmt(s.collected_at)}{s.rejection_reason && ` · Rejected: ${s.rejection_reason}`}
      </div>
      {canAct && s.status !== 'REJECTED' && (
        <div className="row" style={{ marginTop: 6 }}>
          {s.status === 'COLLECTED' && (
            <button className="small primary" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/specimens/${s.id}/process`); onChange(); })}>
              Start processing
            </button>
          )}
          {!rejecting && <button className="small danger" onClick={() => setRejecting(true)}>Reject specimen</button>}
          {rejecting && (
            <form className="row" onSubmit={(e) => { e.preventDefault(); act.run(async () => { await api.post(`/specimens/${s.id}/reject`, { reason }); onChange(); }); }}>
              <select value={reason} onChange={(e) => setReason(e.target.value)} required>
                <option value="">Reason…</option>
                {['Hemolyzed', 'Clotted', 'Insufficient volume', 'Mislabeled / unlabeled', 'Wrong container', 'Exceeded stability time'].map((r) => <option key={r}>{r}</option>)}
              </select>
              <button className="small danger solid" disabled={act.busy}>Confirm reject</button>
              <button type="button" className="small" onClick={() => setRejecting(false)}>Cancel</button>
            </form>
          )}
        </div>
      )}
      <ErrorMsg error={act.error} />
    </div>
  );
}

function ItemCard({ item, order, user, isTech, isOrderingDoc, isAdmin, onChange }) {
  const act = useAction();
  const [mode, setMode] = useState(null); // 'enter' | 'amend' | 'retest' | 'history'
  const [retestReason, setRetestReason] = useState('');
  const done = async (fn) => {
    const r = await act.run(fn);
    if (r !== undefined) { setMode(null); onChange(); }
  };
  const canEnter = isTech && ['IN_PROCESSING', 'RESULT_AVAILABLE'].includes(item.status);
  const canAmend = item.status === 'RELEASED' && (isTech || isOrderingDoc);

  return (
    <div className={`item-card ${item.is_panic && item.status !== 'RELEASED' ? 'panic' : ''}`}>
      <div className="item-head">
        <div>
          <div style={{ fontWeight: 600 }}>{item.test_name} <span className="mono muted">{item.test_code}</span></div>
          <div className="row" style={{ marginTop: 4, gap: 8 }}>
            <Pipeline status={item.status} />
            <Status s={item.status} />
            {item.accession_number && <span className="mono muted">{item.accession_number}</span>}
          </div>
        </div>
        <div className="row">
          {user.role !== 'technician' && item.status === 'RELEASED' && (
            <button className="small" onClick={() => act.run(() => download(`/order-items/${item.id}/report`, `MedLab-${item.test_code}-${item.id}.pdf`))}>Download PDF</button>
          )}
          {item.latest_version_id && <button className="small" onClick={() => setMode(mode === 'history' ? null : 'history')}>Versions</button>}
          {(isOrderingDoc || isAdmin) && ['COLLECTION_REQUIRED', 'COLLECTED'].includes(item.status) && (
            <button className="small danger" onClick={() => {
              const reason = window.prompt('Reason for cancelling this test?');
              if (reason !== null) done(() => api.post(`/order-items/${item.id}/cancel`, { reason }));
            }}>Cancel test</button>
          )}
        </div>
      </div>

      {item.retest_reason && ['IN_PROCESSING', 'RESULT_AVAILABLE'].includes(item.status) && (
        <div className="error" style={{ marginTop: 8, background: 'var(--warn-soft)', color: 'var(--warn)' }}>Returned for retest: {item.retest_reason}</div>
      )}

      {item.latest_data && (
        <div className="result-box">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <ResultValue category={item.category} data={item.latest_data} unit={item.unit} refLow={item.ref_low} refHigh={item.ref_high} />
            <div className="row">
              <Flag flag={item.abnormal_flag} panic={item.is_panic} />
              <span className="muted" style={{ fontSize: 12 }}>v{item.latest_version}{item.is_amendment ? ' · amended' : ''}</span>
            </div>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        {canEnter && mode !== 'enter' && (
          <button className="small primary" onClick={() => setMode('enter')}>{item.status === 'RESULT_AVAILABLE' ? 'Re-enter result' : 'Enter result'}</button>
        )}
        {isTech && item.status === 'RESULT_AVAILABLE' && (
          <button className="small primary" disabled={act.busy} onClick={() => done(() => api.post(`/order-items/${item.id}/submit`))}>Submit for physician review</button>
        )}
        {isOrderingDoc && item.status === 'UNDER_REVIEW' && (
          <>
            <button className="small primary" disabled={act.busy} onClick={() => done(() => api.post(`/order-items/${item.id}/review`, { decision: 'approve' }))}>Approve &amp; release</button>
            <button className="small" onClick={() => setMode('retest')}>Return for retest</button>
          </>
        )}
        {canAmend && mode !== 'amend' && <button className="small" onClick={() => setMode('amend')}>Amend result</button>}
      </div>

      {mode === 'enter' && (
        <ResultForm item={item} busy={act.busy}
          onSubmit={(data) => done(() => api.post(`/order-items/${item.id}/results`, { data }))} />
      )}
      {mode === 'amend' && (
        <ResultForm item={item} busy={act.busy} initial={item.latest_data} requireReason submitLabel="Issue amended version"
          onSubmit={(data, reason) => done(() => api.post(`/order-items/${item.id}/amend`, { data, reason }))} />
      )}
      {mode === 'retest' && (
        <form className="result-box row" onSubmit={(e) => { e.preventDefault(); done(() => api.post(`/order-items/${item.id}/review`, { decision: 'retest', reason: retestReason })); }}>
          <input value={retestReason} onChange={(e) => setRetestReason(e.target.value)} placeholder="Reason for retest" required style={{ flex: 1 }} />
          <button className="small primary" disabled={act.busy}>Return to lab</button>
          <button type="button" className="small" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}
      {mode === 'history' && <VersionHistory item={item} />}
      <ErrorMsg error={act.error} />
    </div>
  );
}

export function VersionHistory({ item }) {
  const { data } = useApi(`/order-items/${item.id}/history`);
  if (!data) return null;
  return (
    <div className="result-box">
      <table>
        <thead><tr><th>Ver.</th><th>State</th><th>Result</th><th>Entered</th><th>Released</th><th>Note</th></tr></thead>
        <tbody>
          {data.map((v) => (
            <tr key={v.id}>
              <td className="mono">v{v.version}</td>
              <td><Status s={v.state} /></td>
              <td className={v.state === 'SUPERSEDED' ? 'superseded' : ''}>
                <ResultValue category={v.category} data={v.data} unit={item.unit} /> <Flag flag={v.abnormal_flag} panic={v.is_panic} />
              </td>
              <td style={{ fontSize: 12.5 }}>{fmt(v.entered_at)}<div className="muted">{v.entered_by_name}</div></td>
              <td style={{ fontSize: 12.5 }}>{v.released_at ? fmt(v.released_at) : '—'}<div className="muted">{v.released_by_name}</div></td>
              <td style={{ fontSize: 12.5 }}>{v.is_amendment ? `Amended: ${v.amendment_reason}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTrail({ orderId }) {
  const { data, error } = useApi(`/orders/${orderId}/audit`);
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;
  return (
    <div className="table-wrap" style={{ marginTop: 10 }}>
      <table>
        <thead><tr><th>When</th><th>Entity</th><th>Action</th><th>Transition</th><th>By</th></tr></thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.id}>
              <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmt(a.created_at)}</td>
              <td className="mono" style={{ fontSize: 12 }}>{a.entity_type} {a.entity_id}</td>
              <td style={{ fontSize: 13 }}>{a.action}</td>
              <td className="mono" style={{ fontSize: 12 }}>{a.from_state || a.to_state ? `${a.from_state || '∅'} → ${a.to_state || ''}` : ''}</td>
              <td style={{ fontSize: 13 }}>{a.actor_name || <span className="muted">system</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
