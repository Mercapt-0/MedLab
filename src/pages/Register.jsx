import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/bits';
import { AuthSide } from './Login';

export default function Register() {
  const { register } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', dateOfBirth: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(f);
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
          <h1>Create patient account</h1>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Staff accounts are created by a lab administrator.</p>
          <ErrorMsg error={error} />
          <label>Full name<input value={f.name} onChange={set('name')} required /></label>
          <label>Email<input type="email" value={f.email} onChange={set('email')} required /></label>
          <label>Date of birth<input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></label>
          <label>Password (8+ characters)<input type="password" value={f.password} onChange={set('password')} minLength={8} required /></label>
          <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <p className="muted" style={{ fontSize: 14 }}>Already registered? <Link to="/login">Sign in</Link></p>
        </form>
      </div>
    </div>
  );
}
