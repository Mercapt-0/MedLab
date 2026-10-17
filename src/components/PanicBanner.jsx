import { Link } from 'react-router-dom';
import { useApi } from '../hooks';

export default function PanicBanner() {
  const { data } = useApi('/panic-alerts?status=OPEN', { interval: 10000 });
  if (!data || data.length === 0) return null;
  return (
    <div className="panic-banner" role="alert">
      <span><span className="pulse" />{data.length} unacknowledged panic value{data.length > 1 ? 's require' : ' requires'} attention</span>
      <Link to="/panic">Review now</Link>
    </div>
  );
}
