// Plain loading text, standing in for the `<p>Loading…</p>` that was
// hand-written on every page. Deliberately unstyled — each container's
// existing CSS (e.g. `.admin-panel > p:not(.error)`) still targets this
// the same way it targeted the literal <p> before, so nothing looks
// different, it's just written once now.
export default function Loading({ label = 'Loading…' }) {
  return <p>{label}</p>;
}
