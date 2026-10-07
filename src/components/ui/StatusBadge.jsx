// Pill showing a booking/camera status, styled by the existing
// `.status-badge.status-<status>` rules (see AdminPanel.css / MyBookingsPage.css).
// `label` defaults to the raw status text; pass a friendlier one (e.g. from
// a STATUS_LABELS map) where the UI wants that instead.
export default function StatusBadge({ status, label }) {
  return <span className={`status-badge status-${status}`}>{label ?? status}</span>;
}
