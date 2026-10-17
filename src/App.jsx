import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import NewOrder from './pages/physician/NewOrder';
import PanicAlerts from './pages/PanicAlerts';
import Catalogue from './pages/admin/Catalogue';
import Users from './pages/admin/Users';
import Turnaround from './pages/admin/Turnaround';
import MyResults from './pages/patient/MyResults';
import PatientHistory from './pages/PatientHistory';
import Notifications from './pages/Notifications';

const HOME = {
  physician: '/orders',
  lab_admin: '/orders',
  technician: '/orders',
  patient: '/my-results',
};

function Guard({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot">Loading MedLab…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={HOME[user.role]} replace /> : <Register />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/orders" element={<Guard roles={['physician', 'lab_admin', 'technician']}><Orders /></Guard>} />
        <Route path="/orders/new" element={<Guard roles={['physician']}><NewOrder /></Guard>} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/panic" element={<Guard roles={['physician', 'lab_admin']}><PanicAlerts /></Guard>} />
        <Route path="/catalogue" element={<Guard roles={['lab_admin']}><Catalogue /></Guard>} />
        <Route path="/users" element={<Guard roles={['lab_admin']}><Users /></Guard>} />
        <Route path="/reports/turnaround" element={<Guard roles={['lab_admin']}><Turnaround /></Guard>} />
        <Route path="/patients/:id" element={<Guard roles={['physician', 'lab_admin']}><PatientHistory /></Guard>} />
        <Route path="/my-results" element={<Guard roles={['patient']}><MyResults /></Guard>} />
        <Route path="/notifications" element={<Notifications />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}
