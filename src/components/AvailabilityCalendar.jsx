import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WEEKDAYS, MONTH_NAMES, buildMonthGrid, isSameDay, startOfDay } from '../lib/calendarGrid';
import { toISODate } from '../lib/dateUtils';
import './AvailabilityCalendar.css';

// Inline month calendar for the admin's "View availability" modal — two jobs
// at once: (1) tints each day by how booked it is (`dayStatus`), and (2) lets
// the admin click-start/click-end to pick a range to block. Same click-click
// range-selection model DateRangePicker's MonthGrid already uses, just always
// visible instead of behind a popup trigger — reuses the same grid math from
// lib/calendarGrid.js rather than a second implementation.
export default function AvailabilityCalendar({
  viewDate,
  onPrevMonth,
  onNextMonth,
  dayStatus, // (isoDate) => 'available' | 'partial' | 'full' | undefined
  dayAvailable, // (isoDate) => number | undefined — exact units left, shown as a hover tooltip
  selectedStart,
  selectedEnd,
  onSelectStart,
  onSelectEnd,
  minDate, // dates before this are disabled — defaults to today
}) {
  const today = startOfDay(new Date());
  const min = minDate ? startOfDay(minDate) : today;
  const cells = useMemo(() => buildMonthGrid(viewDate), [viewDate]);

  // A fully-booked day (already paid/held by someone, in full or advance —
  // "full" here means zero units left, see statusFromCounts in
  // CameraAvailabilityModal.jsx) can't be picked as a start or end point.
  // The server would reject it anyway (the same stock trigger a real booking
  // hits), but catching it here means the admin never gets that far.
  function isDayDisabled(date) {
    if (date < min) return true;
    return dayStatus?.(toISODate(date)) === 'full';
  }

  function handleDayClick(date) {
    if (isDayDisabled(date)) return;
    // Fresh pick, a completed range already picked, or clicking at/before the
    // current start all restart the selection at this day — matches
    // DateRangePicker's own handleDayClick behavior.
    if (!selectedStart || (selectedStart && selectedEnd) || date <= selectedStart) {
      onSelectStart(date);
      onSelectEnd(null);
      return;
    }
    onSelectEnd(date);
  }

  return (
    <div className="avail-cal">
      <div className="avail-cal-header">
        <button type="button" className="avail-cal-nav" onClick={onPrevMonth} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span className="avail-cal-title">
          {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
        </span>
        <button type="button" className="avail-cal-nav" onClick={onNextMonth} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="avail-cal-grid avail-cal-weekdays">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="avail-cal-weekday">{wd}</div>
        ))}
      </div>

      <div className="avail-cal-grid">
        {cells.map(({ date, inMonth }) => {
          const iso = toISODate(date);
          const status = dayStatus?.(iso);
          const disabled = isDayDisabled(date);
          const isStart = isSameDay(date, selectedStart);
          const isEnd = isSameDay(date, selectedEnd);
          const isEndpoint = isStart || isEnd;
          const isBetween = Boolean(selectedStart) && Boolean(selectedEnd) && date > selectedStart && date < selectedEnd;
          const isToday = inMonth && isSameDay(date, today);

          return (
            <div
              key={date.toISOString()}
              className={`avail-cal-cell${isBetween ? ' avail-cal-cell-between' : ''}`}
            >
              <button
                type="button"
                className={[
                  'avail-cal-day',
                  status ? `avail-cal-day-${status}` : '',
                  isEndpoint ? 'avail-cal-day-selected' : '',
                  isToday && !isEndpoint ? 'avail-cal-day-today' : '',
                  !inMonth ? 'avail-cal-day-out' : '',
                ].filter(Boolean).join(' ')}
                disabled={disabled}
                onClick={() => handleDayClick(date)}
                data-tooltip={dayAvailable?.(iso) !== undefined ? `${dayAvailable(iso)} available` : undefined}
              >
                {date.getDate()}
              </button>
            </div>
          );
        })}
      </div>

      <div className="avail-cal-legend">
        <span className="avail-cal-legend-item">
          <span className="avail-cal-dot avail-cal-dot-available" /> Available
        </span>
        <span className="avail-cal-legend-item">
          <span className="avail-cal-dot avail-cal-dot-partial" /> Partly booked
        </span>
        <span className="avail-cal-legend-item">
          <span className="avail-cal-dot avail-cal-dot-full" /> Fully booked
        </span>
      </div>
    </div>
  );
}
