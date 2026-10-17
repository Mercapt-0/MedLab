import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../../api';
import { ErrorMsg } from '../../components/bits';
import { useAction, useApi } from '../../hooks';

/** US-02: physician places an order (single tests and/or panels, routine or STAT). */
export default function NewOrder() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const patients = useApi(`/users${qs({ role: 'patient', q })}`);
  const tests = useApi('/catalogue/tests');
  const panels = useApi('/catalogue/panels');
  const [patientId, setPatientId] = useState('');
  const [priority, setPriority] = useState('routine');
  const [testIds, setTestIds] = useState([]);
  const [panelIds, setPanelIds] = useState([]);
  const [notes, setNotes] = useState('');
  const act = useAction();

  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const grouped = useMemo(() => {
    const g = {};
    (tests.data || []).forEach((t) => { (g[t.category] = g[t.category] || []).push(t); });
    return g;
  }, [tests.data]);

  const count = testIds.length + (panels.data || []).filter((p) => panelIds.includes(p.id)).reduce((s, p) => s + p.tests.length, 0);

  const submit = (e) => {
    e.preventDefault();
    act.run(async () => {
      const o = await api.post('/orders', { patientId: Number(patientId), priority, testIds, panelIds, notes });
      navigate(`/orders/${o.id}`);
    });
  };

  return (
    <form onSubmit={submit}>
      <div className="page-head">
        <div><h1>New lab order</h1><div className="muted">Select a patient, tests or panels, and priority.</div></div>
      </div>
      <ErrorMsg error={act.error} />

      <div className="grid-2">
        <div className="card stack">
          <h2>1 · Patient</h2>
          <input placeholder="Search patients by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <select size={6} value={patientId} onChange={(e) => setPatientId(e.target.value)} required>
            {(patients.data || []).map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.email}{p.date_of_birth ? ` · DOB ${p.date_of_birth.slice(0, 10)}` : ''}</option>
            ))}
          </select>
        </div>
        <div className="card stack">
          <h2>2 · Priority</h2>
          <div className="row">
            <label className="check"><input type="radio" checked={priority === 'routine'} onChange={() => setPriority('routine')} /> Routine</label>
            <label className="check"><input type="radio" checked={priority === 'stat'} onChange={() => setPriority('stat')} /> <strong style={{ color: 'var(--panic)' }}>STAT</strong></label>
          </div>
          <label>Clinical notes (optional)<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
      </div>

      <div className="card">
        <h2>3 · Panels</h2>
        <div className="grid-3">
          {(panels.data || []).map((p) => (
            <label key={p.id} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={panelIds.includes(p.id)} onChange={() => toggle(panelIds, setPanelIds, p.id)} />
              <span>{p.name} <span className="mono muted">{p.code}</span>
                <div className="muted" style={{ fontSize: 12 }}>{p.tests.map((t) => t.code).join(', ')}</div>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>4 · Individual tests</h2>
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} style={{ marginBottom: 12 }}>
            <h3 style={{ textTransform: 'capitalize' }} className="muted">{cat}</h3>
            <div className="grid-3">
              {list.map((t) => (
                <label key={t.id} className="check">
                  <input type="checkbox" checked={testIds.includes(t.id)} onChange={() => toggle(testIds, setTestIds, t.id)} />
                  <span>{t.name} <span className="mono muted">{t.code}</span></span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <span className="muted">{count} test{count === 1 ? '' : 's'} selected</span>
        <button className="primary" disabled={act.busy || !patientId || count === 0}>{act.busy ? 'Placing…' : 'Place order'}</button>
      </div>
    </form>
  );
}
