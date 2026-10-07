import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, IndianRupee, TrendingUp, CalendarCheck } from 'lucide-react';
import { useAuth } from '../lib/useAuth';
import AdminTopbar from '../components/AdminTopbar';
import AdminSidebar from '../components/AdminSidebar';
import Loading from '../components/ui/Loading';
import StatusBadge from '../components/ui/StatusBadge';
import RevenueLineChart from '../components/RevenueLineChart';
// Not rendered here, but this page's KPI cards reuse its .admin-stat-card /
// .admin-stat-icon / .admin-stat-body classes verbatim — importing the CSS
// directly (rather than relying on it being pulled in transitively via
// AdminOverview elsewhere in the app) keeps that dependency explicit.
import '../components/AdminStats.css';
import { fetchPeriodStats } from '../lib/adminStats';
import {
  PERIODS,
  PERIOD_LABELS,
  CHART_TREND_COUNT,
  getPeriodWindow,
  getTrendWindow,
  shiftAnchor,
  getPreviousWindow,
  fetchRevenueBookings,
  fetchPeriodRevenueTotal,
  filterBookingsInWindow,
  bucketRevenue,
  bucketRevenueTrend,
  aggregateByCamera,
  aggregateByPaymentStatus,
  buildTransactionsCsv,
} from '../lib/revenueAnalytics';
import { formatPrice, friendlyErrorMessage } from '../lib/common';
import { formatDate, todayISO } from '../lib/dateUtils';
import './RevenueAnalyticsPage.css';

const STATUS_COLORS = { paid: 'var(--accent)', advance_paid: 'var(--info)', refunded: 'var(--warning)' };
const STATUS_LABELS = {
  paid: 'Paid in full',
  advance_paid: 'Advance paid',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
};

// Donut via a stroked circle per segment (no charting library in this
// project — same hand-rolled-SVG convention as RevenueLineChart.jsx). A 2px
// gap shaved off each segment's dash length keeps adjacent slices visually
// separated without drawing a border (the dataviz "surface gap" mechanic).
function RevenueDonut({ segments }) {
  const size = 180;
  const r = 70;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * r;
  // Each segment's starting offset is the sum of every earlier segment's
  // percentage — computed functionally (no mutated outer variable) so this
  // stays safe under React's compiler-driven memoization.
  const arcs = segments.map((seg, i) => ({
    ...seg,
    startPct: segments.slice(0, i).reduce((sum, s) => sum + s.pct, 0),
  }));

  return (
    <div className="revenue-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Revenue breakdown by payment type">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={strokeWidth} />
        {arcs.map((seg) => {
          const rawDash = (seg.pct / 100) * circumference;
          const dash = Math.max(0, rawDash - 2);
          const dashoffset = -((seg.startPct / 100) * circumference);
          return (
            <circle
              key={seg.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={STATUS_COLORS[seg.key] ?? 'var(--text-muted)'}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={dashoffset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
        })}
      </svg>
      <div className="revenue-donut-legend">
        {segments.map((seg) => (
          <div key={seg.key} className="revenue-donut-legend-row">
            <span className="revenue-donut-swatch" style={{ background: STATUS_COLORS[seg.key] ?? 'var(--text-muted)' }} />
            <span className="revenue-donut-legend-label">{seg.label}</span>
            <span className="revenue-donut-legend-value">{formatPrice(seg.revenue)}</span>
            <span className="revenue-donut-legend-pct">{seg.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RevenueAnalyticsPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const [period, setPeriod] = useState('month');
  const [anchor, setAnchor] = useState(todayISO());
  const [bookings, setBookings] = useState([]);
  const [chartPoints, setChartPoints] = useState([]);
  const [previousTotal, setPreviousTotal] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAllCameras, setShowAllCameras] = useState(false);

  const periodWindow = useMemo(() => getPeriodWindow(period, anchor), [period, anchor]);

  // Total Revenue is deliberately all-time and independent of the period
  // filter — reuses the same admin_period_stats RPC the Overview card
  // already calls, so this number always matches what the admin clicked
  // through from.
  useEffect(() => {
    fetchPeriodStats('all', 0)
      .then((data) => setTotalRevenue(Number(data.revenue ?? 0)))
      .catch(() => {}); // non-fatal — that one card just shows a dash
  }, []);

  // 'day' shows one day broken into its 24 hours; week/month/year instead
  // compare several *whole* periods against each other (e.g. Weekly = the
  // last 8 weeks' totals, not one week's 7 days) — so those three fetch a
  // wider combined range up front, then narrow it back down to just the
  // current period for the KPI/camera/breakdown/transactions sections below
  // the chart, which still describe a single selected period.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const isTrend = period !== 'day';
    const trendCount = CHART_TREND_COUNT[period];
    const fetchWindow = isTrend ? getTrendWindow(period, anchor, trendCount) : periodWindow;

    Promise.all([fetchRevenueBookings(fetchWindow), fetchPeriodRevenueTotal(getPreviousWindow(period, anchor))])
      .then(([rows, prevTotal]) => {
        if (cancelled) return;
        setBookings(isTrend ? filterBookingsInWindow(rows, periodWindow) : rows);
        setChartPoints(isTrend ? bucketRevenueTrend(rows, period, anchor, trendCount) : bucketRevenue(rows, period, periodWindow));
        setPreviousTotal(prevTotal);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyErrorMessage(err, 'Could not load revenue data.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, anchor]);

  function changePeriod(p) {
    if (p === period) return;
    setPeriod(p);
    setAnchor(todayISO());
    setShowAllCameras(false);
  }

  function step(dir) {
    setAnchor((a) => shiftAnchor(period, a, dir));
    setShowAllCameras(false);
  }

  function selectSidebarTab(id) {
    navigate(id === 'overview' ? '/admin' : `/admin?tab=${id}`);
  }

  const periodRevenue = useMemo(() => bookings.reduce((s, b) => s + Number(b.amount_paid || 0), 0), [bookings]);
  const completedBookings = bookings.length;
  const deltaPct = previousTotal > 0 ? ((periodRevenue - previousTotal) / previousTotal) * 100 : null;

  const cameraBreakdown = useMemo(() => aggregateByCamera(bookings), [bookings]);
  const CAMERA_PREVIEW_COUNT = 5;
  const visibleCameras = showAllCameras ? cameraBreakdown : cameraBreakdown.slice(0, CAMERA_PREVIEW_COUNT);
  const hiddenCameraCount = cameraBreakdown.length - visibleCameras.length;
  const paymentBreakdown = useMemo(() => aggregateByPaymentStatus(bookings), [bookings]);
  const recentTransactions = bookings.slice(0, 15);

  function handleExport() {
    const csv = buildTransactionsCsv(bookings);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-${periodWindow.startISO}-to-${periodWindow.endISO}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Separate from the camera/breakdown/transactions sections (which key off
  // `bookings.length`, the current period only): the trend chart
  // (week/month/year) can have real data to show even when the *current*
  // period has none — e.g. this week is empty but the last 8 weeks aren't.
  const chartIsEmpty = !loading && chartPoints.every((p) => p.revenue === 0);

  return (
    <div className="admin-shell">
      <AdminTopbar onLogout={signOut} />
      <div className="admin-shell-body">
        <AdminSidebar activeTab="overview" onSelect={selectSidebarTab} />
        <div className="admin-shell-canvas">
          <div className="revenue-page">
            <div className="revenue-page-head">
              <div>
                <h2>Revenue Analytics</h2>
                <p className="revenue-page-subtitle">Track rental income and understand your business performance.</p>
              </div>

              <div className="admin-stats-controls">
                <div className="admin-stats-date-nav">
                  <button type="button" aria-label="Previous period" onClick={() => step(-1)}>
                    <ChevronLeft size={16} />
                  </button>
                  <span className="admin-stats-range-label">{periodWindow.label}</span>
                  <button type="button" aria-label="Next period" onClick={() => step(1)}>
                    <ChevronRight size={16} />
                  </button>
                </div>

                <div className="admin-stats-segmented" role="tablist" aria-label="Period">
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="tab"
                      aria-selected={period === p}
                      className={period === p ? 'is-active' : ''}
                      onClick={() => changePeriod(p)}
                    >
                      {PERIOD_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && <p className="error" role="alert">{error}</p>}

            <div className="revenue-kpi-grid">
              <div className="admin-stat-card is-info">
                <span className="admin-stat-icon is-info">
                  <IndianRupee size={20} strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="admin-stat-body">
                  <span className="admin-stat-label">Total Revenue</span>
                  <span className="admin-stat-value">{totalRevenue == null ? '—' : formatPrice(totalRevenue)}</span>
                  <span className="admin-stat-sub">All-time collected</span>
                </div>
              </div>

              <div className="admin-stat-card is-accent">
                <span className="admin-stat-icon is-accent">
                  <TrendingUp size={20} strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="admin-stat-body">
                  <span className="admin-stat-label">This Period</span>
                  <span className="admin-stat-value">{loading ? '—' : formatPrice(periodRevenue)}</span>
                  {!loading && deltaPct != null ? (
                    <span className={`revenue-delta ${deltaPct >= 0 ? 'is-up' : 'is-down'}`}>
                      {deltaPct >= 0 ? '+' : ''}
                      {deltaPct.toFixed(1)}% vs last period
                    </span>
                  ) : (
                    <span className="admin-stat-sub">Revenue for {periodWindow.label}</span>
                  )}
                </div>
              </div>

              <div className="admin-stat-card is-success">
                <span className="admin-stat-icon is-success">
                  <CalendarCheck size={20} strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="admin-stat-body">
                  <span className="admin-stat-label">Completed Bookings</span>
                  <span className="admin-stat-value">{loading ? '—' : completedBookings}</span>
                  <span className="admin-stat-sub">Paid bookings this period</span>
                </div>
              </div>

            </div>

            <section className="revenue-card">
              <h3>Revenue Overview</h3>
              {loading ? (
                <Loading />
              ) : chartIsEmpty ? (
                <p className="hint revenue-empty">No revenue recorded for this period.</p>
              ) : (
                <RevenueLineChart points={chartPoints} loading={loading} />
              )}
            </section>

            <div className="revenue-two-col">
              <section className="revenue-card">
                <h3>Revenue by Camera</h3>
                {loading ? (
                  <Loading />
                ) : cameraBreakdown.length === 0 ? (
                  <p className="hint">No revenue recorded for this period.</p>
                ) : (
                  <>
                  <ul className="revenue-camera-list">
                    {visibleCameras.map((c) => (
                      <li key={c.cameraId} className="revenue-camera-row">
                        {c.photo ? (
                          <img src={c.photo} alt={c.name} className="revenue-camera-thumb" />
                        ) : (
                          <div className="revenue-camera-thumb revenue-camera-thumb-empty" />
                        )}
                        <div className="revenue-camera-info">
                          <div className="revenue-camera-top">
                            <span className="revenue-camera-name">{c.name}</span>
                            <span className="revenue-camera-amount">{formatPrice(c.revenue)}</span>
                          </div>
                          <div className="revenue-camera-bar-track">
                            <div className="revenue-camera-bar-fill" style={{ width: `${c.pctOfTotal}%` }} />
                          </div>
                          <div className="revenue-camera-bottom">
                            <span>
                              {c.bookingCount} booking{c.bookingCount === 1 ? '' : 's'}
                            </span>
                            <span>{c.pctOfTotal.toFixed(1)}% of revenue</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {cameraBreakdown.length > CAMERA_PREVIEW_COUNT && (
                    <button type="button" className="revenue-camera-toggle" onClick={() => setShowAllCameras((v) => !v)}>
                      {showAllCameras ? 'Show less' : `Show ${hiddenCameraCount} more camera${hiddenCameraCount === 1 ? '' : 's'}`}
                    </button>
                  )}
                  </>
                )}
              </section>

              <section className="revenue-card">
                <h3>Revenue Breakdown</h3>
                {loading ? (
                  <Loading />
                ) : paymentBreakdown.length === 0 ? (
                  <p className="hint">No revenue recorded for this period.</p>
                ) : (
                  <RevenueDonut segments={paymentBreakdown} />
                )}
              </section>
            </div>

            <section className="revenue-card">
              <div className="revenue-transactions-head">
                <h3>Recent Transactions</h3>
                <button type="button" className="revenue-export-btn" onClick={handleExport} disabled={bookings.length === 0}>
                  <Download size={15} /> Export Report
                </button>
              </div>
              {loading ? (
                <Loading />
              ) : recentTransactions.length === 0 ? (
                <p className="hint">No transactions in this period.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Booking ID</th>
                        <th>Camera</th>
                        <th>Customer</th>
                        <th>Rental Period</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTransactions.map((b) => (
                        <tr key={b.id}>
                          <td>{b.id.slice(0, 8).toUpperCase()}</td>
                          <td>{b.cameras?.name ?? 'Unknown camera'}</td>
                          <td>{b.customer_name || '—'}</td>
                          <td>
                            {formatDate(b.start_date)} → {formatDate(b.end_date)}
                          </td>
                          <td>{formatPrice(b.amount_paid)}</td>
                          <td>
                            <StatusBadge status={b.payment_status} label={STATUS_LABELS[b.payment_status]} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
