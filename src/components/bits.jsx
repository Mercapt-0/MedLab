// Small presentational components shared across pages.

const LABEL = {
  COLLECTION_REQUIRED: 'Collection required',
  IN_PROCESSING: 'In processing',
  RESULT_AVAILABLE: 'Result available',
  UNDER_REVIEW: 'Under review',
  IN_PROGRESS: 'In progress',
  ON_CALL: 'On-call',
};

export const Status = ({ s }) => <span className={`badge s-${s}`}>{LABEL[s] || s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}</span>;

export const Priority = ({ p }) => <span className={`badge ${p}`}>{p === 'stat' ? 'STAT' : 'Routine'}</span>;

export const Flag = ({ flag, panic }) => {
  if (panic) return <span className="flag P">PANIC</span>;
  if (!flag) return null;
  return <span className={`flag ${flag}`}>{flag === 'A' ? 'ABN' : flag}</span>;
};

const STEPS = ['COLLECTION_REQUIRED', 'COLLECTED', 'IN_PROCESSING', 'RESULT_AVAILABLE', 'UNDER_REVIEW', 'RELEASED'];
export function Pipeline({ status }) {
  if (status === 'CANCELLED') return <Status s="CANCELLED" />;
  const idx = STEPS.indexOf(status);
  return (
    <span className="pipeline" title={status}>
      {STEPS.map((s, i) => (
        <span key={s} className={`step ${i < idx || status === 'RELEASED' ? 'done' : i === idx ? 'now' : ''}`} />
      ))}
    </span>
  );
}

/** Render a result payload for any category. */
export function ResultValue({ category, data, unit, refLow, refHigh }) {
  if (!data) return <span className="muted">—</span>;
  if (category === 'quantitative') {
    const range = refLow != null || refHigh != null ? `ref ${refLow ?? ''}–${refHigh ?? ''}` : '';
    return (
      <span>
        <strong className="mono" style={{ fontSize: 15 }}>{data.value}</strong> {unit} <span className="muted" style={{ fontSize: 12 }}>{range}</span>
        {data.comment && <div className="muted" style={{ fontSize: 13 }}>{data.comment}</div>}
      </span>
    );
  }
  if (category === 'qualitative') {
    return (
      <span>
        <strong style={{ textTransform: 'capitalize' }}>{data.interpretation}</strong>
        {data.comment && <div className="muted" style={{ fontSize: 13 }}>{data.comment}</div>}
      </span>
    );
  }
  if (!data.growth) return <strong>No growth</strong>;
  return (
    <span>
      <strong><em>{data.organism}</em></strong>
      <table style={{ marginTop: 6, width: 'auto' }}>
        <tbody>
          {data.sensitivities.map((s) => (
            <tr key={s.antibiotic}>
              <td style={{ padding: '2px 12px 2px 0', border: 0 }}>{s.antibiotic}</td>
              <td style={{ padding: 2, border: 0 }} className="mono">{s.interpretation}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.comment && <div className="muted" style={{ fontSize: 13 }}>{data.comment}</div>}
    </span>
  );
}

export const ErrorMsg = ({ error }) => (error ? <div className="error">{typeof error === 'string' ? error : error.message}</div> : null);
