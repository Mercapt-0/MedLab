import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, tokenStore } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('medlab:logout', onLogout);
    if (!tokenStore.get()) {
      setLoading(false);
    } else {
      api.get('/auth/me').then((r) => setUser(r.user)).catch(() => tokenStore.set(null)).finally(() => setLoading(false));
    }
    return () => window.removeEventListener('medlab:logout', onLogout);
  }, []);

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  };

  const register = async (body) => {
    const r = await api.post('/auth/register', body);
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  };

  return <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const ROLE_LABEL = {
  physician: 'Physician',
  lab_admin: 'Lab Administrator',
  technician: 'Technician',
  patient: 'Patient',
};
