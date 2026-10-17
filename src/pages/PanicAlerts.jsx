import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, Status } from '../components/bits';
import { ago, fmt, useAction, useApi } from '../hooks';

const STAGE = { ORDERING: 'Ordering physician', ON_CALL: 'On-call physician', DIRECTOR: 'Lab director' };

function summary(d) {
  if (!d) return '';
  if (d.value !== undefined) return d.value;
  if (d.interpretation) return d.interpretation;
  return d.growth ? `Growth: ${d.organism}` : 'No growth';
}

/** R-13 / US-09: panic-value alerts and acknowledgement. */
export default function PanicAlerts() {
  const { user } = useAuth();
  const { data, error, reload } = useApi('/panic-alerts', { interval: 10000 });
  const act = useAction();
  const open = (data || []).filter((a) => a.status === 'OPEN');
  const closed = (data || []).filter((a) => a.status !== 'OPEN');

  const ack = (a) => {
    const note = window.prompt('Acknowledgement note (e.g. action taken):', '') ?? null;
    if (note === null) return;
    act.run(async () => { await api.post(`/panic-alerts/${a.id}/acknowledge`, { note }); reload(); });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{user.role === 'lab_admin' ? 'Panic monitor' : 'Panic alerts'}</h1>
          <div className="muted">Unacknowledged alerts escalate: ordering physician → on-call physician → lab director.</div>
        </div>
      </div>
      <ErrorMsg error={error || act.error} />

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 18px 0' }}><h2>Open ({open.length})</h2></div>
        <AlertTable rows={open} onAck={ack} busy={act.busy} />
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 18px 0' }}><h2>Acknowledged</h2></div>
        <AlertTable rows={closed} />
      </div>
    </>
  );
}

function AlertTable({ rows, onAck, busy }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Raised</th><th>Patient</th><th>Test</th><th>Value</th><th>Stage</th><th>Ordering physician</th><th>{onAck ? '' : 'Acknowledged'}</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="empty">None</td></tr>}
          {rows.map((a) => (
            <tr key={a.id}>
              <td style={{ fontSize: 13 }}>{ago(a.created_at)}</td>
              <td>{a.patient_name}</td>
              <td><Link to={`/orders/${a.order_id}`}>{a.test_name}</Link> <span className="muted mono">#{a.order_id}</span></td>
              <td><span className="flag P">{summary(a.result_data)}</span></td>
              <td>{a.status === 'OPEN' ? <span className="badge panic">{STAGE[a.stage]}</span> : <Status s="ACKNOWLEDGED" />}</td>
              <td>{a.ordering_physician_name}</td>
              <td>
                {onAck ? <button className="small danger solid" disabled={busy} onClick={() => onAck(a)}>Acknowledge</button>
                  : <span style={{ fontSize: 13 }}>{a.acknowledged_by_name}<div className="muted">{fmt(a.acknowledged_at)}</div></span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
