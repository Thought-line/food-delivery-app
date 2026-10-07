import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './App.css';
import { AuthProvider } from './lib/AuthContext';
import { CartProvider } from './lib/CartContext';
import { WishlistProvider } from './lib/WishlistContext';
import { AuthGateProvider } from './lib/AuthGateProvider';
import { RentalRangeProvider } from './lib/RentalRangeProvider';
import { SearchUIProvider } from './lib/SearchUIProvider';
import { BookingNotificationsProvider } from './lib/BookingNotificationsProvider';
import { AdminNotificationsProvider } from './lib/AdminNotificationsProvider';
import { ReviewPromptProvider } from './lib/ReviewPromptProvider';
import { useAuth } from './lib/useAuth';
import { useAdminNotifications } from './lib/useAdminNotifications';
import Navbar from './components/Navbar';
import CartFeedback from './components/CartFeedback';
import BookingStatusToast from './components/BookingStatusToast';
import ReviewPromptCard from './components/ReviewPromptCard';
import ActionToast from './components/ui/ActionToast';
import CartDrawer from './components/CartDrawer';
import SearchDrawer from './components/SearchDrawer';
import RecommendationsDrawer from './components/RecommendationsDrawer';
import ProtectedRoute from './components/ProtectedRoute';
import Loading from './components/ui/Loading';
import LoginPage from './pages/LoginPage';
import AdminLoginPage from './pages/AdminLoginPage';
import SignupPage from './pages/SignupPage';
import ProductListPage from './pages/ProductListPage';
import CameraDetailsPage from './pages/CameraDetailsPage';
import TermsPage from './pages/TermsPage';
import BookingPage from './pages/BookingPage';
import CartPage from './pages/CartPage';
import MyBookingsPage from './pages/MyBookingsPage';
import ProfilePage from './pages/ProfilePage';
import WishlistPage from './pages/WishlistPage';
import AdminPage from './pages/AdminPage';
import RevenueAnalyticsPage from './pages/RevenueAnalyticsPage';
// React Router doesn't reset scroll position on navigation — most
// noticeable clicking between two /camera/:id pages (e.g. a "Similar
// Products" card), which reuses the same route/component so the browser
// just keeps whatever scroll position the previous camera's page was at.
// Renders nothing; just resets scroll to the top whenever the URL path
// changes. Mounted once inside AppRoutes below, alongside <Routes>.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// New-request toast for the admin — lives outside AdminPage so it keeps
// firing even while the admin is on the Manage Camera tab (AdminPage
// unmounts AdminPanel, and its subscription, when switching tabs).
function AdminRequestToast() {
  const { toast, closeToast } = useAdminNotifications();
  return <ActionToast toast={toast} onClose={closeToast} />;
}

// Wraps customer-facing pages with the navbar at the top

function AppLayout({ children }) {
  return (
    <div className="app">
      <Navbar />
      <CartFeedback />
      <CartDrawer />
      <SearchDrawer />
      <RecommendationsDrawer />
      <main className="app-main">{children}</main>
    </div>
  );
}
// The "/" route — admins get sent straight to the admin panel instead
// of seeing the customer camera list
function Home() {
  const { role } = useAuth();
  return role === 'admin' ? <Navigate to="/admin" replace /> : <ProductListPage />;
}
// All the app's URLs and which page/permissions each one needs
function AppRoutes() {
  
  const { loading } = useAuth(); // wait until we know if someone's logged in before showing any page
  if (loading) return <Loading />;
  return (
    <>
      <ScrollToTop />
      <Routes>
      {/* Login/signup have no navbar and don't need to be logged in */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      {/* Home + camera details are public — anyone can browse without an account */}
      <Route
        path="/"
        element={
          <AppLayout>
            <Home />
          </AppLayout>
        }
      />
      <Route
        path="/camera/:cameraId"
        element={
          <AppLayout>
            <CameraDetailsPage />
          </AppLayout>
        }
      />
      <Route
        path="/terms"
        element={
          <AppLayout>
            <TermsPage />
          </AppLayout>
        }
      />
      <Route
        path="/book/:cameraId"
        element={
          // role="customer" blocks admins from these customer-only pages
          <ProtectedRoute role="customer">
            <AppLayout>
              <BookingPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/cart"
        element={
          <ProtectedRoute role="customer">
            <AppLayout>
              <CartPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-bookings"
        element={
          <ProtectedRoute role="customer">
            <AppLayout>
              <MyBookingsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute role="customer">
            <AppLayout>
              <ProfilePage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/wishlist"
        element={
          <ProtectedRoute role="customer">
            <AppLayout>
              <WishlistPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          // Admin page has its own topbar/sidebar, so it skips AppLayout/Navbar
          <ProtectedRoute role="admin">
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/revenue"
        element={
          <ProtectedRoute role="admin">
            <RevenueAnalyticsPage />
          </ProtectedRoute>
        }
      />
      {/* Any unknown URL just goes back to the home page */}
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
// AuthProvider must wrap everything, since routes/pages need to know who's
// logged in. CartProvider sits inside it so the cart is shared app-wide too.
// WishlistProvider nests inside both — it needs useAuth() (whose wishlist)
// and useCart()'s showToast (failed-write feedback).
export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <RentalRangeProvider>
            <SearchUIProvider>
              <AuthGateProvider>
                {/* Above the routes, not inside AppLayout — every <Route>
                    renders its own AppLayout instance, so anything inside it
                    (and the realtime subscription this owns) would tear down
                    and reconnect on every navigation instead of staying live
                    across pages. Navbar's "My Bookings" badge and the toast
                    both read from the same provider, so they always agree. */}
                <BookingNotificationsProvider>
                  <AdminNotificationsProvider>
                    <ReviewPromptProvider>
                      <AppRoutes />
                      <BookingStatusToast />
                      <ReviewPromptCard />
                      <AdminRequestToast />
                    </ReviewPromptProvider>
                  </AdminNotificationsProvider>
                </BookingNotificationsProvider>
              </AuthGateProvider>
            </SearchUIProvider>
          </RentalRangeProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}
