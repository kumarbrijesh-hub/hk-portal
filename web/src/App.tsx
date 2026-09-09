import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './state/AppContext';
import { Login } from './pages/Login';
import { LiveTracker } from './pages/LiveTracker';
import { ActiveDisruptions } from './pages/ActiveDisruptions';

function Shell() {
  const { booting, user, config, logout } = useApp();

  if (booting) return <p className="loading" style={{ paddingTop: 60 }}>Loading…</p>;
  if (!user) return <Login />;
  if (!config) return <p className="loading" style={{ paddingTop: 60 }}>Loading configuration…</p>;

  const [first, ...rest] = config.brand.appName.split(' ');

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">{first} <em>{rest.join(' ')}</em></span>
        <nav className="nav">
          <NavLink to="/tracker" className={({ isActive }) => (isActive ? 'active' : '')}>Live Tracker</NavLink>
          <NavLink to="/active" className={({ isActive }) => (isActive ? 'active' : '')}>Live Active Disruption</NavLink>
        </nav>
        <div className="topbar-right">
          <span className="who">
            <strong>{user.name}</strong>
            {user.email}
          </span>
          <button type="button" className="small" onClick={() => void logout()}>Sign out</button>
        </div>
      </header>

      <Routes>
        <Route path="/tracker" element={<LiveTracker />} />
        <Route path="/active" element={<ActiveDisruptions />} />
        <Route path="*" element={<Navigate to="/tracker" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
