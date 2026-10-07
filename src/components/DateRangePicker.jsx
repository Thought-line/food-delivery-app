import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  WEEKDAYS,
  MONTH_NAMES,
  startOfDay,
  startOfMonth,
  addMonths,
  isSameDay,
  buildMonthGrid,
} from '../lib/calendarGrid';
import { toISODate } from '../lib/dateUtils';

const ACCENT = 'var(--accent)';
const ACCENT_SOFT = 'color-mix(in srgb, var(--accent) 18%, white)';
const ACCENT_GLOW = 'var(--accent-bg)';
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

// Optional per-day booked/available tinting (see `dayStatus` prop below) —
// same green/amber/red language as the admin's availability calendar
// (AvailabilityCalendar.jsx), just inline-styled to match this component's
// existing style rather than a class-based stylesheet.
const STATUS_BG = {
  available: 'var(--success-bg)',
  partial: 'var(--warning-bg)',
  full: 'var(--danger-bg)',
};
const STATUS_COLOR = {
  available: 'var(--success)',
  partial: 'var(--warning)',
  full: 'var(--danger)',
};

function formatShort(date) {
  if (!date) return '';
  return `${MONTH_NAMES[date.getMonth()].slice(0, 3)} ${date.getDate()}, ${date.getFullYear()}`;
}

// "1st Sep" — used by the compact navbar pill (variant="pill"), which has no
// room for a year and reads better with an ordinal day than formatShort's
// "Sep 1, 2026".
function ordinalSuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
function formatOrdinalShort(date) {
  if (!date) return '';
  const day = date.getDate();
  return `${day}${ordinalSuffix(day)} ${MONTH_NAMES[date.getMonth()].slice(0, 3)}`;
}

// Nights between start/end — deliberately exclusive (matches rentalDays.js,
// which is what CartPage.jsx actually bills against). The end date is the
// return day, not a day of use, so Aug 28 -> Aug 29 is 1 night, not 2 —
// showing "2 days" next to those exact dates would disagree with the price
// the booking is actually charged and risk a return-time dispute.
function nightsBetween(start, end) {
  if (!start || !end) return 0;
  return Math.round((startOfDay(end) - startOfDay(start)) / 86400000);
}

// One-time embedded stylesheet, scoped under .drp-root, that only handles
// what inline styles can't: hover/disabled/focus states, and neutralizing
// this app's global `button { ... }` reset (border/background/padding/etc.)
// so the picker looks identical regardless of the page it's dropped into.
// Every rule here is either class-scoped or class+pseudo, which already
// out-specifies the app's bare `button`/`button:hover` selectors, so this
// wins without needing !important.
const STYLE_TAG = `
  .drp-root { font-family: ${FONT}; }
  .drp-root button { all: unset; box-sizing: border-box; cursor: pointer; }
  .drp-root button:disabled { cursor: not-allowed; }
  .drp-root button:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 2px; }
  .drp-field:hover { border-color: ${ACCENT}; }
  .drp-nav:hover { background: #f2f3f6; }
  .drp-close:hover { background: #ececf1; }
  .drp-day:not(:disabled):hover { box-shadow: inset 0 0 0 1.5px ${ACCENT}; }
  .drp-continue:not(:disabled):hover { filter: brightness(1.05); }
  .drp-pill-field:hover { background: #f4f5f7; }
  .drp-pill-edit:hover { filter: brightness(1.25); }

  /* Custom tooltip for a day's exact units-left (replaces the native
     title-attribute tooltip with something that actually matches the
     picker's own look). Driven purely by data-tooltip + :hover — no JS
     state needed. */
  .drp-day[data-tooltip] { position: relative; }
  .drp-day[data-tooltip]::after,
  .drp-day[data-tooltip]::before {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s ease;
    pointer-events: none;
    z-index: 40;
  }
  .drp-day[data-tooltip]::after {
    content: attr(data-tooltip);
    bottom: calc(100% + 9px);
    padding: 5px 9px;
    border-radius: 7px;
    background: #1f2430;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    box-shadow: 0 6px 16px rgba(20,20,40,0.22);
  }
  .drp-day[data-tooltip]::before {
    content: '';
    bottom: calc(100% + 4px);
    border: 5px solid transparent;
    border-top-color: #1f2430;
  }
  .drp-day[data-tooltip]:not(:disabled):hover::after,
  .drp-day[data-tooltip]:not(:disabled):hover::before {
    opacity: 1;
    visibility: visible;
  }
`;

function DateField({ label, value, placeholder, active, onClick }) {
  return (
    <button
      type="button"
      className="drp-field"
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 20px',
        borderRadius: 12,
        border: `1.5px solid ${active ? ACCENT : '#e4e6ec'}`,
        background: '#ffffff',
        boxShadow: active ? `0 0 0 4px ${ACCENT_GLOW}` : 'none',
        textAlign: 'left',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <Calendar size={16} color={active ? ACCENT : '#9aa1b0'} style={{ flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: 0.3, textTransform: 'uppercase' }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: value ? '#1f2430' : '#b7bbc7',
            whiteSpace: 'nowrap',
          }}
        >
          {value ? formatShort(value) : placeholder}
        </span>
      </span>
    </button>
  );
}

// Compact single-pill trigger (variant="pill") — one bordered capsule with
// both dates inline and a dark "Edit" button, for docking inside the navbar
// instead of taking the full-size two-field layout's width. `compact` (see
// DateRangePicker's own prop) shrinks it further for narrow containers like
// a cart row or the booking form card, which have nowhere near the navbar's
// width to spare.
function PillField({ label, value, active, onClick, compact }) {
  return (
    <button
      type="button"
      className="drp-pill-field"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 5 : 8,
        padding: compact ? '5px 8px' : '8px 12px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      <Calendar size={compact ? 12 : 15} color={active ? ACCENT : '#9aa1b0'} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: compact ? 11.5 : 13, color: '#6b7280' }}>
        {value ? (
          <>
            {label}: <strong style={{ color: '#1f2430', fontWeight: 700 }}>{value}</strong>
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
}

// Renders one month. `previewEnd` is the currently-hovered candidate end
// date (null once an end date is actually confirmed, or while picking a
// start date) — used only to preview the range highlight in real time.
function MonthGrid({
  viewDate, today, startDate, endDate, previewEnd,
  onDayClick, onDayHover, showPrev, showNext, onPrev, onNext, compact, dayStatus, dayAvailable,
}) {
  const cells = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const rangeEnd = endDate ?? previewEnd;
  const monthWidth = compact ? 196 : 232;
  const cellSize = compact ? 26 : 32;
  const rowHeight = compact ? 30 : 36;

  return (
    <div style={{ width: monthWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 8 : 14, padding: '0 2px' }}>
        {showPrev ? (
          <button
            type="button"
            className="drp-nav"
            onClick={onPrev}
            aria-label="Previous month"
            style={compact ? navBtnStyleCompact : navBtnStyle}
          >
            <ChevronLeft size={compact ? 14 : 16} color="#6b7280" />
          </button>
        ) : (
          <span style={{ width: compact ? 22 : 28, height: compact ? 22 : 28, display: 'block' }} />
        )}

        <span style={{ fontSize: compact ? 12 : 13.5, fontWeight: 700, color: '#1f2430' }}>
          {compact ? MONTH_NAMES[viewDate.getMonth()].slice(0, 3) : MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
        </span>

        {showNext ? (
          <button
            type="button"
            className="drp-nav"
            onClick={onNext}
            aria-label="Next month"
            style={compact ? navBtnStyleCompact : navBtnStyle}
          >
            <ChevronRight size={compact ? 14 : 16} color="#6b7280" />
          </button>
        ) : (
          <span style={{ width: compact ? 22 : 28, height: compact ? 22 : 28, display: 'block' }} />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {WEEKDAYS.map((wd) => (
          <div key={wd} style={{ textAlign: 'center', fontSize: compact ? 10 : 11, fontWeight: 700, color: '#adb2c0', padding: compact ? '2px 0 6px' : '4px 0 8px' }}>
            {wd}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map(({ date, inMonth }) => {
          const isPast = date < today;
          const iso = toISODate(date);
          const status = dayStatus?.(iso);
          // Exact units-left tooltip — the color alone only says "tight" vs
          // "plenty"; hovering shows the real number the request would have
          // to fit under, same info the row-level "X of Y available" hint
          // below shows for the range as a whole, just per day.
          const available = dayAvailable?.(iso);
          // A fully-booked day can't be picked as a start/end point either —
          // the server would reject it anyway (same stock trigger a real
          // booking hits), this just catches it before the admin/customer
          // gets that far. Adjacent-month padding days otherwise stay
          // visually dimmed (opacity below) but clickable — no need to
          // navigate months first just to pick a date that's already visible.
          const disabled = isPast || status === 'full';
          const isStart = isSameDay(date, startDate);
          const isEnd = isSameDay(date, endDate);
          const isPreviewEnd = !endDate && isSameDay(date, previewEnd);
          const isEndpoint = isStart || isEnd || isPreviewEnd;
          const isBetween = Boolean(startDate) && Boolean(rangeEnd) && date > startDate && date < rangeEnd;
          const isToday = inMonth && isSameDay(date, today);

          return (
            <div
              key={date.toISOString()}
              onMouseEnter={() => !disabled && onDayHover(date)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: rowHeight,
                // Flat, square fill for the exclusive in-between days only —
                // no rounding, so consecutive days visually connect.
                background: isBetween ? ACCENT_SOFT : 'transparent',
              }}
            >
              <button
                type="button"
                className="drp-day"
                disabled={disabled}
                onClick={() => onDayClick(date)}
                data-tooltip={available !== undefined ? `${available} available` : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: cellSize,
                  height: cellSize,
                  borderRadius: '50%',
                  border: isToday && !isEndpoint ? '1.5px solid #9aa1b0' : 'none',
                  background: isEndpoint ? ACCENT : status ? STATUS_BG[status] : 'transparent',
                  color: isEndpoint ? '#ffffff' : isPast ? '#c7cbd6' : status ? STATUS_COLOR[status] : '#3a3f4d',
                  fontWeight: isEndpoint ? 700 : 500,
                  fontSize: compact ? 11.5 : 13,
                  opacity: !inMonth ? 0.4 : 1,
                }}
              >
                {date.getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const navBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: '50%',
};

const navBtnStyleCompact = { ...navBtnStyle, width: 22, height: 22 };

export default function DateRangePicker({
  onChange,
  initialStart = null,
  initialEnd = null,
  // 'fields' = the original two-box layout (BookingForm/CameraDetailsPage).
  // 'pill' = one compact capsule with both dates + an Edit button, sized to
  // fit inline in the navbar (see Navbar.jsx).
  variant = 'fields',
  // Shrinks the calendar popup itself to a single, smaller month instead of
  // the normal two-month spread — for tight spots like one cart row's own
  // picker (see CartPage.jsx), where a full-size two-month calendar would
  // dwarf the row it belongs to. Independent of `variant`, which only
  // changes the trigger.
  compact = false,
  // Pill variant's "Edit" button: orange (--accent) instead of the default
  // dark pill. Off by default so the navbar keeps its original look; the
  // cart's per-item picker (CartPage.jsx) opts in.
  editAccent = false,
  // Optional per-day booked/available tinting for a specific camera —
  // (isoDate) => 'available' | 'partial' | 'full' | undefined. Left
  // undefined by default (e.g. the navbar's picker, which isn't scoped to
  // one camera), in which case every day renders exactly as before.
  dayStatus,
  // Optional (isoDate) => number — exact units left that day, shown as a
  // hover tooltip alongside the dayStatus tint. Same undefined-by-default
  // deal as dayStatus.
  dayAvailable,
}) {
  // Committed selection — what the fields and the summary line display.
  // Only changes when Continue is clicked.
  const [committedStart, setCommittedStart] = useState(initialStart);
  const [committedEnd, setCommittedEnd] = useState(initialEnd);
  // Draft selection — what the popup itself is editing while open. Re-seeded
  // from the committed values every time the popup opens, so an edit that's
  // abandoned (closed via X/outside-click instead of Continue) never leaks
  // into the fields.
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [step, setStep] = useState('start'); // which date the next day-click sets
  const [isOpen, setIsOpen] = useState(false);
  const [hoverDate, setHoverDate] = useState(null);
  const [viewDate, setViewDate] = useState(() => startOfMonth(initialStart ?? new Date()));

  // Keeps the committed display in sync with a range change that happens
  // from OUTSIDE this component — e.g. RentalRangeProvider clearing the
  // navbar's picker on logout. `committedStart`/`committedEnd` are normally
  // "owned" by this component (only handleContinue below changes them), so
  // without this they'd otherwise stay stuck on whatever they were seeded
  // with at mount, ignoring any later prop change. Compares actual date
  // values rather than object identity, since `initialStart`/`initialEnd`
  // are freshly-constructed Date objects on every parent render even when
  // nothing really changed — this only touches the committed display, never
  // an in-progress pick inside an open popup.
  useEffect(() => {
    setCommittedStart((prev) => (prev?.getTime() !== initialStart?.getTime() ? initialStart : prev));
    setCommittedEnd((prev) => (prev?.getTime() !== initialEnd?.getTime() ? initialEnd : prev));
  }, [initialStart, initialEnd]);

  const containerRef = useRef(null);
  const popupRef = useRef(null);
  const today = startOfDay(new Date());

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return undefined;
    function handleClickOutside(e) {
      if (!containerRef.current?.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // When the calendar opens, make sure the whole popup is on screen — if it
  // would render below the fold, smooth-scroll just enough to bring it into
  // view so the user never has to hunt for it.
  useEffect(() => {
    if (!isOpen) return undefined;
    const frame = requestAnimationFrame(() => {
      popupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  function handleFieldClick(field) {
    if (isOpen && step === field) {
      setIsOpen(false);
      return;
    }
    if (!isOpen) {
      setStartDate(committedStart);
      setEndDate(committedEnd);
      setViewDate(startOfMonth(committedStart ?? new Date()));
    }
    setStep(field);
    setIsOpen(true);
  }

  // The pill's single "Edit" button — just toggles the same popup the fields
  // open, defaulting to the start step when opening fresh.
  function toggleOpen() {
    if (isOpen) setIsOpen(false);
    else handleFieldClick('start');
  }

  function handleDayClick(date) {
    if (step === 'end' && startDate && date > startDate) {
      setEndDate(date);
      setStep('start');
      setHoverDate(null);
      return;
    }
    setStartDate(date);
    if (!endDate || date >= endDate) setEndDate(null);
    setStep('end');
    setHoverDate(null);
  }

  function handleContinue() {
    if (!startDate || !endDate) return;
    setCommittedStart(startDate);
    setCommittedEnd(endDate);
    onChange?.(startDate, endDate);
    setIsOpen(false);
  }

  const canContinue = Boolean(startDate && endDate);
  // Only preview a range while actively choosing the end date, and only
  // forward of the start — hovering backward would become a new start on
  // click, so there's nothing meaningful to preview there.
  const previewEnd = startDate && !endDate && hoverDate && hoverDate > startDate ? hoverDate : null;
  const hasCommittedRange = Boolean(committedStart && committedEnd);
  const nights = nightsBetween(committedStart, committedEnd);

  return (
    <div
      ref={containerRef}
      className="drp-root"
      style={{
        position: 'relative',
        width: variant === 'pill' ? 'auto' : '100%',
        maxWidth: variant === 'pill' ? (compact ? '100%' : 'none') : 900,
        // Flex items default to min-width: auto, which floors their size at
        // their content's unwrapped width — exactly what was pushing the
        // compact pill past its container (a narrow cart row / the booking
        // form card) and getting clipped by the ancestor's overflow:hidden.
        // This lets it actually shrink so flexWrap below can wrap instead.
        minWidth: compact ? 0 : undefined,
        margin: variant === 'pill' ? 0 : '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <style>{STYLE_TAG}</style>

      {variant === 'pill' ? (
        <div
          style={{
            display: 'flex',
            flexWrap: compact ? 'wrap' : 'nowrap',
            alignItems: 'center',
            justifyContent: compact ? 'center' : 'flex-start',
            gap: compact ? 4 : 2,
            maxWidth: '100%',
            boxSizing: 'border-box',
            padding: compact ? '4px 4px 4px 6px' : '6px 6px 6px 8px',
            borderRadius: compact ? 14 : 999,
            border: '1.5px solid #e4e6ec',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(20,18,26,0.1)',
          }}
        >
          <PillField
            label={compact ? 'Start' : 'Start Date'}
            value={committedStart ? formatOrdinalShort(committedStart) : null}
            active={isOpen && step === 'start'}
            onClick={() => handleFieldClick('start')}
            compact={compact}
          />
          <span style={{ width: 1, height: compact ? 14 : 20, background: '#e4e6ec', flexShrink: 0 }} />
          <PillField
            label={compact ? 'End' : 'End Date'}
            value={committedEnd ? formatOrdinalShort(committedEnd) : null}
            active={isOpen && step === 'end'}
            onClick={() => handleFieldClick('end')}
            compact={compact}
          />
          <button
            type="button"
            className="drp-pill-edit"
            onClick={toggleOpen}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: compact ? 4 : 6,
              marginLeft: compact ? 0 : 4,
              padding: compact ? '6px 10px' : '9px 16px',
              borderRadius: 999,
              background: editAccent ? ACCENT : '#171826',
              color: '#ffffff',
              fontSize: compact ? 11.5 : 13,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            <Calendar size={compact ? 11 : 13} />
            Edit
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 460 }}>
            <DateField
              label="Start date"
              value={committedStart}
              placeholder="Add date"
              active={isOpen && step === 'start'}
              onClick={() => handleFieldClick('start')}
            />
            <DateField
              label="End date"
              value={committedEnd}
              placeholder="Add date"
              active={isOpen && step === 'end'}
              onClick={() => handleFieldClick('end')}
            />
          </div>

          {hasCommittedRange && (
            <div style={{ marginTop: 10, fontSize: 13.5, fontWeight: 700, color: ACCENT, textAlign: 'center' }}>
              {formatShort(committedStart)} → {formatShort(committedEnd)} · {nights} day{nights === 1 ? '' : 's'}
            </div>
          )}
        </>
      )}

      {isOpen && (
        <div
          ref={popupRef}
          onMouseLeave={() => setHoverDate(null)}
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            background: '#ffffff',
            borderRadius: 16,
            boxShadow: '0 12px 40px rgba(20,20,40,0.16)',
            // Extra top padding clears the X button (top:14, 28px tall) so
            // it sits above the month rows instead of overlapping the right
            // calendar's own next-month chevron and blocking it.
            padding: compact ? '38px 14px 14px' : '46px 22px 18px',
            maxWidth: 'calc(100vw - 32px)',
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            className="drp-close"
            onClick={() => setIsOpen(false)}
            aria-label="Close"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'absolute',
              top: 14,
              right: 14,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#f4f5f7',
            }}
          >
            <X size={15} color="#6b7280" />
          </button>

          <div style={{ display: 'flex', gap: 24 }}>
            {compact ? (
              <MonthGrid
                viewDate={viewDate}
                today={today}
                startDate={startDate}
                endDate={endDate}
                previewEnd={previewEnd}
                onDayClick={handleDayClick}
                onDayHover={setHoverDate}
                showPrev
                showNext
                onPrev={() => setViewDate((d) => addMonths(d, -1))}
                onNext={() => setViewDate((d) => addMonths(d, 1))}
                compact
                dayStatus={dayStatus}
                dayAvailable={dayAvailable}
              />
            ) : (
              <>
                <MonthGrid
                  viewDate={viewDate}
                  today={today}
                  startDate={startDate}
                  endDate={endDate}
                  previewEnd={previewEnd}
                  onDayClick={handleDayClick}
                  onDayHover={setHoverDate}
                  showPrev
                  showNext={false}
                  onPrev={() => setViewDate((d) => addMonths(d, -1))}
                  dayStatus={dayStatus}
                  dayAvailable={dayAvailable}
                />
                <MonthGrid
                  viewDate={addMonths(viewDate, 1)}
                  today={today}
                  startDate={startDate}
                  endDate={endDate}
                  previewEnd={previewEnd}
                  onDayClick={handleDayClick}
                  onDayHover={setHoverDate}
                  showPrev={false}
                  showNext
                  onNext={() => setViewDate((d) => addMonths(d, 1))}
                  dayStatus={dayStatus}
                  dayAvailable={dayAvailable}
                />
              </>
            )}
          </div>

          {startDate && !endDate && (
            <div style={{ marginTop: compact ? 8 : 12, fontSize: compact ? 11 : 12.5, fontWeight: 600, color: '#9aa1b0', textAlign: 'center' }}>
              Pick an end date to continue
            </div>
          )}

          <button
            type="button"
            className="drp-continue"
            disabled={!canContinue}
            onClick={handleContinue}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: compact ? 12 : 18,
              width: '100%',
              padding: compact ? '9px 14px' : '12px 16px',
              borderRadius: compact ? 10 : 12,
              fontSize: compact ? 12.5 : 14,
              fontWeight: 700,
              color: canContinue ? '#ffffff' : 'var(--text-muted)',
              background: canContinue ? ACCENT : ACCENT_GLOW,
              transition: 'filter 0.15s ease',
            }}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
