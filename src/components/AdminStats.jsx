import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, XCircle, Camera, Archive, IndianRupee, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { fetchPeriodStats } from '../lib/adminStats';
import { formatPrice } from '../lib/common';
import './AdminStats.css';

const PERIODS = ['day', 'week', 'month', 'all'];
const PERIOD_LABELS = { day: 'Daily', week: 'Weekly', month: 'Monthly', all: 'All time' };
const CURRENT_PREFIX = { day: 'Today', week: 'This week', month: 'This month' };

// Revenue is the one number that actually matters most day-to-day, so it
// gets its own full-width hero row instead of sitting as a fifth equal
// tile — the other four are operational counts, grouped together below it.
const HERO_CARD = {
  key: 'revenue', label: 'Revenue', sub: 'Amount collected this period', icon: IndianRupee, tone: 'info', format: formatPrice,
};

// `to` sends the admin straight to that filtered view on click — Overview
// stat cards double as shortcuts instead of just being read-only counts.
const CARDS = [
  { key: 'totalBookings', label: 'Total Bookings', sub: 'All bookings', icon: CalendarCheck, tone: 'accent', to: '/admin?tab=bookings&status=all' },
  { key: 'cancelled', label: 'Cancelled', sub: 'Bookings cancelled', icon: XCircle, tone: 'danger', to: '/admin?tab=bookings&status=cancelled' },
  { key: 'activeCameras', label: 'Active Cameras', sub: 'Currently in catalog', icon: Camera, tone: 'success', to: '/admin?tab=cameras&status=active' },
  { key: 'retiredCameras', label: 'Retired Cameras', sub: 'No longer available', icon: Archive, tone: 'neutral', to: '/admin?tab=cameras&status=retired' },
];

// Animates a number from wherever it last landed to `target` — used so a
// stat visibly counts up/down instead of just snapping to the new figure,
// both on first load and whenever the period/offset changes. Inactive
// (loading, or a non-numeric value) just snaps straight to target.
function useCountUp(target, active, duration = 700) {
  const [display, setDisplay] = useState(active ? 0 : target);
  const prevRef = useRef(active ? 0 : target);

  useEffect(() => {
    if (!active) {
      setDisplay(target);
      prevRef.current = target;
      return undefined;
    }
    const start = prevRef.current;
    const startTime = performance.now();
    let raf;
    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - (1 - progress) ** 3; // ease-out cubic
      setDisplay(start + (target - start) * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = target;
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active, duration]);

  return display;
}

// One card — pulled out from the CARDS.map loop specifically so useCountUp
// (a hook) can be called once per card, cleanly, instead of inside a loop.
// Icon sits to the LEFT of the label/value/sub stack (a "list row" feel)
// rather than stacked above it; `hero` just scales everything up for the
// single featured Revenue row. `to`/`onClick`, when given, make the whole
// card a real <button> (navigating or running the handler) — a native
// button instead of a div with a manual onKeyDown gets Enter/Space and
// focus-visible for free, same reasoning TabGroup.jsx already uses for its
// own clickable tiles.
function StatCard({ index, label, sub, icon: Icon, tone, format, rawValue, loading, fading, hero = false, to, onClick }) {
  const navigate = useNavigate();
  const isNumeric = typeof rawValue === 'number';
  const animated = useCountUp(isNumeric ? rawValue : 0, isNumeric && !loading);
  const display = loading || rawValue == null
    ? '—'
    : isNumeric
      ? (format ? format(Math.round(animated)) : Math.round(animated))
      : rawValue;

  const isClickable = Boolean(to || onClick);
  const Tag = isClickable ? 'button' : 'div';

  return (
    <Tag
      type={isClickable ? 'button' : undefined}
      className={`admin-stat-card is-${tone}${hero ? ' admin-stat-card-hero' : ''}${isClickable ? ' is-clickable' : ''}`}
      style={{ animationDelay: `${index * 70}ms` }}
      onClick={to ? () => navigate(to) : onClick}
    >
      <span className={`admin-stat-icon is-${tone}`}>
        <Icon size={hero ? 26 : 20} strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="admin-stat-body">
        <span className="admin-stat-label">{label}</span>
        <span className={`admin-stat-value${fading ? ' is-fading' : ''}`}>{display}</span>
        <span className="admin-stat-sub">{sub}</span>
      </div>
    </Tag>
  );
}

// Self-contained: owns its own period/offset selection, fetch, realtime
// refresh and loading/error state — AdminPanel just renders <AdminStats />.
export default function AdminStats() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('all');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fading, setFading] = useState(false);

  async function load(p, o) {
    const startedAt = Date.now();
    try {
      const result = await fetchPeriodStats(p, o);
      // Enforce a minimum visible fade — a same-region query can resolve
      // in a few ms, which would make the "fade" invisible otherwise.
      const elapsed = Date.now() - startedAt;
      if (elapsed < 150) await new Promise((resolve) => setTimeout(resolve, 150 - elapsed));
      setData(result);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load stats.');
    } finally {
      setLoading(false);
      setFading(false);
    }
  }

  useEffect(() => {
    load(period, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, offset]);

  // Keep counts live when a booking changes, same as the table below it.
  useEffect(() => {
    const channel = supabase
      .channel('admin-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => load(period, offset))
      .subscribe();
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, offset]);

  function changePeriod(p) {
    if (p === period) return;
    setFading(true);
    setPeriod(p);
    setOffset(0);
  }

  function step(dir) {
    const next = offset + dir;
    if (next > 0) return;
    setFading(true);
    setOffset(next);
  }

  // shortLabel falls back to label — keeps this readable (not literally
  // "undefined") even against a DB that hasn't run the migration adding it.
  const shortLabel = data ? data.shortLabel ?? data.label : '—';

  // "Today, 15 Sep 2026" for the current day/week/month; the full
  // weekday/range form for anything stepped back to. The nav pill always
  // uses the compact shortLabel (no weekday, no "(to date)").
  const showingText = !data
    ? '—'
    : period === 'all' || offset !== 0
      ? data.label
      : `${CURRENT_PREFIX[period]}, ${shortLabel}`;

  return (
    <div className="admin-stats-wrap">
      <div className="admin-stats-head">
        <div className="admin-stats-head-copy">
          <p className="admin-stats-subtitle">Quick summary of your rental activity</p>
          <p className="admin-stats-showing">
            Showing: <strong>{showingText}</strong>
          </p>
        </div>

        <div className="admin-stats-controls">
          {period !== 'all' && (
            <div className="admin-stats-date-nav">
              <button type="button" aria-label="Previous period" onClick={() => step(-1)}>
                <ChevronLeft size={16} />
              </button>
              <span className="admin-stats-range-label">{shortLabel}</span>
              <button type="button" aria-label="Next period" disabled={offset >= 0} onClick={() => step(1)}>
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          <div className="admin-stats-segmented" role="tablist" aria-label="Time range">
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

      {error ? (
        <p className="admin-stats-error" role="alert">Couldn't load the summary stats.</p>
      ) : (
        // One bento grid: Revenue sits as a tall card spanning both rows on
        // the left (see .admin-stat-card-hero's grid-row/column in
        // AdminStats.css), the other four fill a 2x2 block beside it —
        // instead of Revenue sitting in its own full-width row on top.
        <div className="admin-stats-grid">
          <StatCard
            hero
            index={0}
            label={HERO_CARD.label}
            sub={HERO_CARD.sub}
            icon={HERO_CARD.icon}
            tone={HERO_CARD.tone}
            format={HERO_CARD.format}
            rawValue={data ? data[HERO_CARD.key] : null}
            loading={loading}
            fading={fading}
            onClick={() => navigate('/admin/revenue')}
          />
          {CARDS.map(({ key, label, sub, icon, tone, format, to }, index) => (
            <StatCard
              key={key}
              index={index + 1}
              label={label}
              sub={sub}
              icon={icon}
              tone={tone}
              format={format}
              to={to}
              rawValue={data ? data[key] : null}
              loading={loading}
              fading={fading}
            />
          ))}
        </div>
      )}
    </div>
  );
}
