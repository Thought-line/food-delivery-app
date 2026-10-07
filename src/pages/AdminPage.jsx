import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import AdminSidebar from '../components/AdminSidebar';
import AdminTopbar from '../components/AdminTopbar';
import AdminOverview from '../components/AdminOverview';
import AdminPanel from '../components/AdminPanel';
import CameraManager from '../components/CameraManager';
// The admin shell otherwise has no surface for the shared cart-context toast
// (AdminPanel/CameraManager each own a separate, page-local useActionToast()
// instead) — mounted here so something survives the redirect from
// AdminLoginPage.jsx to actually show its "Successfully logged in" toast.
// Admins never touch the cart itself, so this never shows anything else.
import CartFeedback from '../components/CartFeedback';
import './AdminPage.css';
// The three tabs shown in the admin sidebar
const TAB_IDS = ['overview', 'bookings', 'cameras'];
// This page has three views: Overview (stats), Booking Management, and
// Manage Camera. We remember which one is open by putting it in the page's
// web address, like mysite.com/admin?tab=cameras, instead of just in memory.
// That way, if the admin refreshes the page or goes back, the same tab stays open.

export default function AdminPage() {
  const { signOut } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab'); // read the tab name from the web address
  // A stat card on Overview can deep-link straight into a filtered view
  // (e.g. ?tab=bookings&status=cancelled) — passed through as-is; each tab
  // validates it against its own filter list rather than trusting this.
  const requestedStatus = searchParams.get('status');

  // If the address doesn't say a tab, or says something we don't recognize,
  // just show "overview" instead.
  const tab = TAB_IDS.includes(requestedTab) ? requestedTab : 'overview';

  // Runs when the admin clicks a tab in the sidebar
  function selectTab(id) {
    // Overview is the normal starting tab, so we don't bother adding
    // it to the address bar — any other tab does.
    setSearchParams(id === 'overview' ? {} : { tab: id });
  }
  return (
    <div className="admin-shell">
      <CartFeedback />
      <AdminTopbar onLogout={signOut} />
      <div className="admin-shell-body">
        <AdminSidebar activeTab={tab} onSelect={selectTab} />
        <div className="admin-shell-canvas">
          {/* Show one screen at a time, based on which tab is open */}
          {tab === 'overview' && <AdminOverview />}
          {tab === 'bookings' && <AdminPanel initialFilter={requestedStatus} />}
          {tab === 'cameras' && <CameraManager initialFilter={requestedStatus} />}
        </div>
      </div>
    </div>
  );
}




