import { useState } from 'react';

/**
 * Category-specific result entry (R-09). Mirrors the backend's polymorphic
 * ResultType classes: quantitative / qualitative / culture each get their own fields.
 */
export default function ResultForm({ item, initial, onSubmit, busy, submitLabel = 'Save result', requireReason = false }) {
  const [value, setValue] = useState(initial?.value ?? '');
  const [interpretation, setInterpretation] = useState(initial?.interpretation ?? 'negative');
  const [growth, setGrowth] = useState(initial?.growth ?? false);
  const [organism, setOrganism] = useState(initial?.organism ?? '');
  const [sens, setSens] = useState(initial?.sensitivities ?? [{ antibiotic: '', interpretation: 'S' }]);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [reason, setReason] = useState('');

  const build = () => {
    const c = comment.trim() ? { comment: comment.trim() } : {};
    if (item.category === 'quantitative') return { value: value === '' ? '' : Number(value), ...c };
    if (item.category === 'qualitative') return { interpretation, ...c };
    if (!growth) return { growth: false, ...c };
    return { growth: true, organism, sensitivities: sens.filter((s) => s.antibiotic.trim()), ...c };
  };

  const submit = (e) => {
    e.preventDefault();
    onSubmit(build(), reason);
  };

  const updateSens = (i, k, v) => setSens(sens.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  return (
    <form onSubmit={submit} className="result-box stack">
      {item.category === 'quantitative' && (
        <label>
          Value {item.unit && <span className="muted">({item.unit}; ref {item.ref_low ?? '?'}–{item.ref_high ?? '?'})</span>}
          <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required style={{ maxWidth: 200 }} />
        </label>
      )}
      {item.category === 'qualitative' && (
        <div className="row">
          {['negative', 'positive', 'indeterminate'].map((v) => (
            <label key={v} className="check">
              <input type="radio" name={`q-${item.id}`} checked={interpretation === v} onChange={() => setInterpretation(v)} />
              <span style={{ textTransform: 'capitalize' }}>{v}</span>
            </label>
          ))}
        </div>
      )}
      {item.category === 'culture' && (
        <>
          <div className="row">
            <label className="check"><input type="radio" checked={!growth} onChange={() => setGrowth(false)} /> No growth</label>
            <label className="check"><input type="radio" checked={growth} onChange={() => setGrowth(true)} /> Growth</label>
          </div>
          {growth && (
            <>
              <label>Organism<input value={organism} onChange={(e) => setOrganism(e.target.value)} required placeholder="e.g. Escherichia coli" /></label>
              <div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Antibiotic sensitivities</div>
                {sens.map((s, i) => (
                  <div className="row" key={i} style={{ marginBottom: 6 }}>
                    <input value={s.antibiotic} placeholder="Antibiotic" onChange={(e) => updateSens(i, 'antibiotic', e.target.value)} />
                    <select value={s.interpretation} onChange={(e) => updateSens(i, 'interpretation', e.target.value)}>
                      <option value="S">S - Susceptible</option><option value="I">I - Intermediate</option><option value="R">R - Resistant</option>
                    </select>
                    {sens.length > 1 && <button type="button" className="small" onClick={() => setSens(sens.filter((_, j) => j !== i))}>Remove</button>}
                  </div>
                ))}
                <button type="button" className="small" onClick={() => setSens([...sens, { antibiotic: '', interpretation: 'S' }])}>+ Add antibiotic</button>
              </div>
            </>
          )}
        </>
      )}
      <label>Comment (optional)<input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      {requireReason && <label>Reason for amendment<input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>}
      <div><button className="primary small" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
    </form>
  );
}
