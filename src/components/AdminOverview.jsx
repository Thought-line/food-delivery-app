import AdminStats from './AdminStats';
import './AdminOverview.css';

// Just the stats summary — booking management now lives on its own sidebar
// tab (AdminPanel.jsx), so this page has nothing else on it.
export default function AdminOverview() {
  return (
    <div className="admin-overview">
      <div className="admin-overview-header">
        <h2>Admin Overview</h2>
      </div>
      <AdminStats />
    </div>
  );
}
