import { useAuth } from '../../auth';
import { HistoryView } from '../PatientHistory';

/** US-11: patient views and downloads their own released results. */
export default function MyResults() {
  const { user } = useAuth();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My results</h1>
          <div className="muted">Results appear here once your physician has reviewed and released them.</div>
        </div>
      </div>
      <HistoryView patientId={user.id} patientView />
    </>
  );
}
