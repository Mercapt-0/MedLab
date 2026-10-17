import { useState } from 'react';
import { api } from '../../api';
import { ROLE_LABEL } from '../../auth';
import { ErrorMsg } from '../../components/bits';
import { useAction, useApi } from '../../hooks';

/** Staff account creation and escalation-rota flags (on-call physician, lab director). */
export default function Users() {
  const users = useApi('/users');
  const act = useAction();
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'technician' });
  const [msg, setMsg] = useState(null);

  const create = (e) => {
    e.preventDefault();
    act.run(async () => {
      const u = await api.post('/users', f);
      setMsg(`Created ${u.email}`);
      setF({ name: '', email: '', password: '', role: 'technician' });
      users.reload();
    });
  };
  const flag = (u, body) => act.run(async () => { await api.patch(`/users/${u.id}`, body); users.reload(); });

  return (
    <>
      <div className="page-head"><div><h1>Users &amp; on-call rota</h1><div className="muted">On-call physicians and lab directors receive escalated panic values.</div></div></div>
      <ErrorMsg error={act.error} />
      {msg && <div className="success" style={{ marginBottom: 12 }}>{msg}</div>}

      <form className="card row" onSubmit={create} style={{ alignItems: 'flex-end' }}>
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
        <label>Temp password<input type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
        <label>Role
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="technician">Technician</option><option value="physician">Physician</option><option value="lab_admin">Lab Administrator</option>
          </select>
        </label>
        <button className="primary" disabled={act.busy}>Create staff account</button>
      </form>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>On call</th><th>Lab director</th></tr></thead>
            <tbody>
              {(users.data || []).map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="muted">{u.email}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{u.role === 'physician' && <input type="checkbox" checked={u.is_on_call} onChange={() => flag(u, { isOnCall: !u.is_on_call })} />}</td>
                  <td>{u.role === 'lab_admin' && <input type="checkbox" checked={u.is_lab_director} onChange={() => flag(u, { isLabDirector: !u.is_lab_director })} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
