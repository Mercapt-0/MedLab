import { Link, useParams } from 'react-router-dom';
import { download } from '../api';
import { ErrorMsg, Flag, ResultValue, Status } from '../components/bits';
import { fmt, useAction, useApi } from '../hooks';

/** R-16: complete chronological history, including superseded (amended) versions. */
export function HistoryView({ patientId, patientView = false }) {
  const { data, error } = useApi(`/patients/${patientId}/history`);
  const act = useAction();
  if (error) return <ErrorMsg error={error} />;
  if (!data) return <div className="muted">Loading…</div>;
  const tests = [...data.tests].reverse(); // newest first

  return (
    <>
      <ErrorMsg error={act.error} />
      {tests.length === 0 && <div className="card empty">{patientView ? 'No released results yet.' : 'No tests on record.'}</div>}
      {tests.map((t) => {
        const current = t.versions.find((v) => v.state === 'CURRENT') || t.versions[t.versions.length - 1];
        const older = t.versions.filter((v) => v !== current);
        return (
          <div className="item-card" key={t.itemId}>
            <div className="item-head">
              <div>
                <div style={{ fontWeight: 600 }}>{t.testName} <span className="mono muted">{t.testCode}</span></div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Ordered {fmt(t.orderedAt)} by {t.physicianName} · {patientView ? `Order #${t.orderId}` : <Link to={`/orders/${t.orderId}`}>Order #{t.orderId}</Link>}
                </div>
              </div>
              <div className="row">
                <Status s={t.status} />
                {t.status === 'RELEASED' && (
                  <button className="small" disabled={act.busy} onClick={() => act.run(() => download(`/order-items/${t.itemId}/report`, `MedLab-${t.testCode}-${t.itemId}.pdf`))}>Download PDF</button>
                )}
              </div>
            </div>
            {current && (
              <div className="result-box row" style={{ justifyContent: 'space-between' }}>
                <ResultValue category={t.category} data={current.data} unit={t.unit} refLow={t.refLow} refHigh={t.refHigh} />
                <div className="row">
                  <Flag flag={current.abnormal_flag} panic={!patientView && current.is_panic} />
                  {current.is_amendment && <span className="badge">Amended</span>}
                  <span className="muted" style={{ fontSize: 12 }}>{current.released_at ? `Released ${fmt(current.released_at)}` : 'Not released'}</span>
                </div>
              </div>
            )}
            {older.length > 0 && (
              <details style={{ marginTop: 8, fontSize: 13.5 }}>
                <summary className="muted" style={{ cursor: 'pointer' }}>{older.length} earlier version{older.length > 1 ? 's' : ''}</summary>
                {older.map((v) => (
                  <div key={v.id} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--line)', justifyContent: 'space-between' }}>
                    <span className={v.state === 'SUPERSEDED' ? 'superseded' : ''}>v{v.version} · {v.summary}</span>
                    <span className="row"><Status s={v.state} /><span className="muted">{fmt(v.released_at || v.entered_at)}</span></span>
                  </div>
                ))}
                {current?.amendment_reason && <div className="muted">Amendment reason: {current.amendment_reason}</div>}
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}

export default function PatientHistory() {
  const { id } = useParams();
  const { data } = useApi(`/patients/${id}/history`);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{data ? data.patient.name : 'Patient'}</h1>
          <div className="muted">Complete test history{data?.patient.date_of_birth && ` · DOB ${data.patient.date_of_birth.slice(0, 10)}`}</div>
        </div>
      </div>
      <HistoryView patientId={id} />
    </>
  );
}
