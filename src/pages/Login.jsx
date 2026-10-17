import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/bits';

const DEMO = [
  ['Physician', 'physician@medlab.test'],
  ['On-call physician', 'oncall@medlab.test'],
  ['Lab admin', 'admin@medlab.test'],
  ['Lab director', 'director@medlab.test'],
  ['Technician', 'tech@medlab.test'],
  ['Patient', 'patient@medlab.test'],
];

export function AuthSide() {
  return (
    <div className="auth-side">
      <div className="brand" style={{ padding: 0 }}><span className="brand-mark">M</span> MedLab</div>
      <div>
        <h1>Every lab order, from requisition to released result.</h1>
        <p>Physicians order, technicians process, results are reviewed before release, and panic values escalate automatically until someone acknowledges them.</p>
      </div>
      <p style={{ fontSize: 12 }}>CSE 5324 course project · simulated data only · not for clinical use</p>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <AuthSide />
      <div className="auth-form">
        <form onSubmit={submit} className="stack">
          <h1>Sign in</h1>
          <p className="muted" style={{ marginTop: 0 }}>Use your MedLab account.</p>
          <ErrorMsg error={error} />
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="muted" style={{ fontSize: 14 }}>New patient? <Link to="/register">Create an account</Link></p>
          <div className="card" style={{ padding: 12, marginTop: 8 }}>
            <h3>Demo accounts</h3>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>Password for all: <span className="mono">Password123!</span></p>
            <div className="demo-grid">
              {DEMO.map(([label, em]) => (
                <button type="button" key={em} onClick={() => { setEmail(em); setPassword('Password123!'); }}>{label}</button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
