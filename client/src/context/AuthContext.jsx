import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, dataOf, setUnauthorizedHandler } from '../services/api';
import { closeSocket } from '../services/socket';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('vcc_token'));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));

  const logout = useCallback(() => {
    localStorage.removeItem('vcc_token');
    setToken(null);
    setUser(null);
    closeSocket();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.get('/auth/me').then((r) => setUser(dataOf(r)?.user || dataOf(r))).catch(() => logout()).finally(() => setLoading(false));
  }, [token, logout]);

  const login = async (email, password) => {
    const result = dataOf(await api.post('/auth/login', { email, password }));
    localStorage.setItem('vcc_token', result.token);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  };

  const value = useMemo(() => ({ token, user, loading, login, logout, setUser }), [token, user, loading, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
