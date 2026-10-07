// Generic "list of items, one active, click to switch" control — covers
// both the admin sidebar's nav list and the bookings filter tabs, which
// were previously two hand-written .map() blocks doing the same thing.
// `items` accepts either plain strings or { id, label, badge } objects —
// `badge`, when a positive number, renders a small count pill after the
// label (e.g. how many new booking requests are waiting).
export default function TabGroup({
  as: Wrapper = 'div',
  className,
  items,
  activeId,
  onSelect,
  itemClassName,
  activeClassName = 'active',
}) {
  return (
    <Wrapper className={className}>
      {items.map((item) => {
        const id = typeof item === 'string' ? item : item.id;
        const label = typeof item === 'string' ? item : item.label;
        const badge = typeof item === 'string' ? null : item.badge;
        const isActive = id === activeId;
        const classes = [itemClassName, isActive ? activeClassName : ''].filter(Boolean).join(' ');
        return (
          <button key={id} type="button" className={classes || undefined} onClick={() => onSelect(id)}>
            {label}
            {badge > 0 && <span className="tab-group-badge">{badge}</span>}
          </button>
        );
      })}
    </Wrapper>
  );
}
