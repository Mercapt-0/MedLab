import { useState } from 'react';
import { api } from '../../api';
import { ErrorMsg } from '../../components/bits';
import { useAction, useApi } from '../../hooks';

const EMPTY = { code: '', name: '', category: 'quantitative', unit: '', refLow: '', refHigh: '', panicLow: '', panicHigh: '', panicOnPositive: false, tatHours: 24, statTatHours: 2 };

/** R-04: lab administrator manages tests, reference ranges, TAT targets, and panels. */
export default function Catalogue() {
  const tests = useApi('/catalogue/tests?all=true');
  const panels = useApi('/catalogue/panels');
  const [f, setF] = useState(EMPTY);
  const [panel, setPanel] = useState({ code: '', name: '', testIds: [] });
  const act = useAction();
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const addTest = (e) => {
    e.preventDefault();
    act.run(async () => {
      const t = await api.post('/catalogue/tests', f);
      setMsg(`Added ${t.code}`);
      setF(EMPTY);
      tests.reload();
    });
  };
  const addPanel = (e) => {
    e.preventDefault();
    act.run(async () => {
      const p = await api.post('/catalogue/panels', panel);
      setMsg(`Added panel ${p.code}`);
      setPanel({ code: '', name: '', testIds: [] });
      panels.reload();
    });
  };
  const toggleActive = (t) => act.run(async () => { await api.patch(`/catalogue/tests/${t.id}`, { active: !t.active }); tests.reload(); });

  return (
    <>
      <div className="page-head"><div><h1>Test catalogue</h1><div className="muted">Reference ranges, panic thresholds and turnaround targets.</div></div></div>
      <ErrorMsg error={act.error} />
      {msg && <div className="success" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Reference</th><th>Panic</th><th>TAT (routine / STAT)</th><th></th></tr></thead>
            <tbody>
              {(tests.data || []).map((t) => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                  <td className="mono">{t.code}</td>
                  <td>{t.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{t.category}</td>
                  <td className="mono" style={{ fontSize: 13 }}>{t.category === 'quantitative' ? `${t.ref_low ?? ''}–${t.ref_high ?? ''} ${t.unit || ''}` : '—'}</td>
                  <td className="mono" style={{ fontSize: 13 }}>{t.category === 'quantitative' ? `≤${t.panic_low ?? '–'} / ≥${t.panic_high ?? '–'}` : t.panic_on_positive ? 'Positive' : '—'}</td>
                  <td className="mono" style={{ fontSize: 13 }}>{t.tat_hours}h / {t.stat_tat_hours}h</td>
                  <td><button className="small" onClick={() => toggleActive(t)}>{t.active ? 'Deactivate' : 'Activate'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <form className="card stack" onSubmit={addTest}>
          <h2>Add test</h2>
          <div className="grid-3">
            <label>Code<input value={f.code} onChange={set('code')} required /></label>
            <label style={{ gridColumn: 'span 2' }}>Name<input value={f.name} onChange={set('name')} required /></label>
          </div>
          <div className="grid-3">
            <label>Category
              <select value={f.category} onChange={set('category')}>
                <option value="quantitative">Quantitative</option><option value="qualitative">Qualitative</option><option value="culture">Culture</option>
              </select>
            </label>
            <label>TAT routine (h)<input type="number" step="any" value={f.tatHours} onChange={set('tatHours')} /></label>
            <label>TAT STAT (h)<input type="number" step="any" value={f.statTatHours} onChange={set('statTatHours')} /></label>
          </div>
          {f.category === 'quantitative' ? (
            <>
              <div className="grid-3">
                <label>Unit<input value={f.unit} onChange={set('unit')} /></label>
                <label>Ref low<input type="number" step="any" value={f.refLow} onChange={set('refLow')} /></label>
                <label>Ref high<input type="number" step="any" value={f.refHigh} onChange={set('refHigh')} /></label>
              </div>
              <div className="grid-3">
                <span />
                <label>Panic low<input type="number" step="any" value={f.panicLow} onChange={set('panicLow')} /></label>
                <label>Panic high<input type="number" step="any" value={f.panicHigh} onChange={set('panicHigh')} /></label>
              </div>
            </>
          ) : (
            <label className="check"><input type="checkbox" checked={f.panicOnPositive} onChange={set('panicOnPositive')} /> Positive result is a panic value</label>
          )}
          <div><button className="primary" disabled={act.busy}>Add test</button></div>
        </form>

        <form className="card stack" onSubmit={addPanel}>
          <h2>Panels</h2>
          {(panels.data || []).map((p) => (
            <div key={p.id} style={{ fontSize: 14 }}>
              <strong>{p.name}</strong> <span className="mono muted">{p.code}</span>
              <div className="muted mono" style={{ fontSize: 12 }}>{p.tests.map((t) => t.code).join(', ')}</div>
            </div>
          ))}
          <h3 style={{ marginTop: 8 }}>New panel</h3>
          <div className="grid-2">
            <label>Code<input value={panel.code} onChange={(e) => setPanel({ ...panel, code: e.target.value })} required /></label>
            <label>Name<input value={panel.name} onChange={(e) => setPanel({ ...panel, name: e.target.value })} required /></label>
          </div>
          <label>Component tests (2+; Ctrl/Cmd-click)
            <select multiple size={6} value={panel.testIds.map(String)}
              onChange={(e) => setPanel({ ...panel, testIds: [...e.target.selectedOptions].map((o) => Number(o.value)) })}>
              {(tests.data || []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select>
          </label>
          <div><button className="primary" disabled={act.busy}>Add panel</button></div>
        </form>
      </div>
    </>
  );
}
