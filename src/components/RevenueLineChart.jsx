import { useState } from 'react';
import { formatPrice } from '../lib/common';
import './RevenueLineChart.css';

const CHART_W = 800;
const CHART_H = 220;
const MARGIN = { top: 16, right: 20, bottom: 30, left: 72 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

// Rounds a max value up to a "nice" 1/2/5 × 10^n ceiling so y-axis ticks
// land on clean numbers instead of an arbitrary fraction of the real max.
function niceMax(value) {
  if (value <= 0) return 100;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const fraction = value / base;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * base;
}

// Single-series revenue-over-time line + area chart — no charting library is
// installed in this project, so this hand-rolls SVG the same way
// RevenueTrendModal.jsx (a bar-chart sibling) already established: fixed
// viewBox + responsive width, niceMax axis rounding, gridlines, per-point
// hover/focus hit targets, and a percentage-positioned HTML tooltip.
export default function RevenueLineChart({ points, loading }) {
  const [activeIndex, setActiveIndex] = useState(null);

  const n = points?.length ?? 0;
  const maxRevenue = n ? niceMax(Math.max(...points.map((p) => p.revenue), 1)) : 100;
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (maxRevenue / tickCount) * i);

  const stepX = n > 1 ? PLOT_W / (n - 1) : 0;
  const xAt = (i) => MARGIN.left + (n > 1 ? i * stepX : PLOT_W / 2);
  const yAt = (revenue) => MARGIN.top + PLOT_H - (revenue / maxRevenue) * PLOT_H;

  const linePath = points?.length
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(p.revenue)}`).join(' ')
    : '';
  const areaPath = points?.length
    ? `${linePath} L${xAt(n - 1)},${MARGIN.top + PLOT_H} L${xAt(0)},${MARGIN.top + PLOT_H} Z`
    : '';

  // Each x-axis label needs roughly 44px to read without touching its
  // neighbor — skip every Nth tick once there isn't room, same fix
  // RevenueTrendModal.jsx uses for its own dense daily axis.
  const labelStep = n && PLOT_W / n < 44 ? Math.ceil(44 / (PLOT_W / n)) : 1;
  const bandW = n ? PLOT_W / n : 0;

  return (
    <div className="revenue-chart-wrap">
      <svg
        className="revenue-chart-svg"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label="Revenue over time"
        style={{ opacity: loading ? 0.4 : 1 }}
      >
        {ticks.map((t) => {
          const y = yAt(t);
          return (
            <g key={t}>
              <line x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={y} y2={y} className="revenue-chart-gridline" />
              <text x={MARGIN.left - 10} y={y} className="revenue-chart-tick-label" textAnchor="end" dy="0.32em">
                {formatPrice(Math.round(t))}
              </text>
            </g>
          );
        })}

        {n > 0 && (
          <>
            <path d={areaPath} className="revenue-chart-area" />
            <path d={linePath} className="revenue-chart-line" />
          </>
        )}

        {points?.map((p, i) => {
          const bandX = MARGIN.left + i * bandW - (n > 1 ? bandW / 2 : 0);
          const isActive = activeIndex === i;
          return (
            <g key={p.label + i}>
              {isActive && (
                <line
                  x1={xAt(i)} x2={xAt(i)}
                  y1={MARGIN.top} y2={MARGIN.top + PLOT_H}
                  className="revenue-chart-crosshair"
                />
              )}
              <circle
                cx={xAt(i)} cy={yAt(p.revenue)} r={isActive ? 5 : 4}
                className={`revenue-chart-dot${isActive ? ' is-active' : ''}`}
              />
              <rect
                x={Math.max(MARGIN.left, bandX)}
                y={MARGIN.top}
                width={n > 1 ? bandW : PLOT_W}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${p.label}: ${formatPrice(p.revenue)}`}
                onPointerEnter={() => setActiveIndex(i)}
                onPointerLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex(null)}
              />
              {(i % labelStep === 0 || i === n - 1) && (
                <text x={xAt(i)} y={CHART_H - MARGIN.bottom + 16} className="revenue-chart-x-label" textAnchor="middle">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {activeIndex != null && points?.[activeIndex] && (
        <div
          className="revenue-chart-tooltip"
          style={{
            left: `${(xAt(activeIndex) / CHART_W) * 100}%`,
            top: `${(yAt(points[activeIndex].revenue) / CHART_H) * 100}%`,
          }}
        >
          <strong>{formatPrice(points[activeIndex].revenue)}</strong>
          <span>{points[activeIndex].label}</span>
        </div>
      )}

      {/* Same data as the chart, for screen readers and anyone who wants
          exact figures without hovering. */}
      <table className="revenue-chart-table sr-only">
        <caption>Revenue over time</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {points?.map((p, i) => (
            <tr key={p.label + i}>
              <td>{p.label}</td>
              <td>{formatPrice(p.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
