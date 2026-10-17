import { useState } from 'react';
import { qs } from '../../api';
import { ErrorMsg, Priority } from '../../components/bits';
import { useApi } from '../../hooks';

/** R-18 / US-13: turnaround-time performance by test type and priority. */
export default function Turnaround() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [applied, setApplied] = useState({});
  const { data, error } = useApi(`/reports/turnaround${qs(applied)}`);

  return (
    <>
      <div className="page-head">
        <div><h1>Turnaround time</h1><div className="muted">Order placed → result released, against each test's target.</div></div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(range); }} style={{ alignItems: 'flex-end' }}>
          <label>From<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label>To<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button className="primary">Apply</button>
        </form>
      </div>
      <ErrorMsg error={error} />
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Test</th><th>Priority</th><th style={{ textAlign: 'right' }}>Completed</th><th style={{ textAlign: 'right' }}>Avg (h)</th>
                <th style={{ textAlign: 'right' }}>Median (h)</th><th style={{ textAlign: 'right' }}>Max (h)</th><th style={{ textAlign: 'right' }}>Target (h)</th><th>Within target</th></tr>
            </thead>
            <tbody>
              {data && data.length === 0 && <tr><td colSpan={8} className="empty">No released results in this range.</td></tr>}
              {(data || []).map((r) => {
                const pct = Number(r.pct_within_target);
                const color = pct >= 90 ? 'var(--ok)' : pct >= 70 ? 'var(--warn)' : 'var(--panic)';
                return (
                  <tr key={`${r.code}-${r.priority}`}>
                    <td>{r.name} <span className="mono muted">{r.code}</span></td>
                    <td><Priority p={r.priority} /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.completed}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.avg_hours}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.median_hours}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.max_hours}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.target_hours}</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <div style={{ width: 90, height: 6, background: '#e5e8e5', borderRadius: 3 }}>
                          <div style={{ width: `${pct}%`, height: 6, background: color, borderRadius: 3 }} />
                        </div>
                        <span className="mono" style={{ color }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
