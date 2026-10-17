import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, useAuth } from '../auth';
import NotificationBell from './NotificationBell';
import PanicBanner from './PanicBanner';

const NAV = {
  physician: [
    ['/orders', 'My Orders'],
    ['/orders/new', 'New Order'],
    ['/panic', 'Panic Alerts'],
    ['/notifications', 'Notifications'],
  ],
  lab_admin: [
    ['/orders', 'Order Queue'],
    ['/catalogue', 'Test Catalogue'],
    ['/users', 'Users & On-call'],
    ['/reports/turnaround', 'Turnaround Report'],
    ['/panic', 'Panic Monitor'],
    ['/notifications', 'Notifications'],
  ],
  technician: [
    ['/orders', 'My Worklist'],
    ['/notifications', 'Notifications'],
  ],
  patient: [
    ['/my-results', 'My Results'],
    ['/notifications', 'Notifications'],
  ],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">M</span> MedLab</div>
        <nav className="nav">
          {NAV[user.role].map(([to, label]) => (
            <NavLink key={to} to={to} end>{label}</NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="whoami">
          <div>{user.name}</div>
          <div className="role">
            {ROLE_LABEL[user.role]}
            {user.is_on_call && ' · On call'}
            {user.is_lab_director && ' · Lab Director'}
          </div>
        </div>
      </aside>
      <div className="main">
        {['physician', 'lab_admin'].includes(user.role) && <PanicBanner />}
        <header className="topbar">
          <NotificationBell />
          <button className="small" onClick={() => { logout(); navigate('/login'); }}>Sign out</button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
