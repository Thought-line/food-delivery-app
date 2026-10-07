// Thin wrapper around <button>. The app's buttons are styled globally by
// element/attribute selectors (see index.css), so by default this changes
// nothing visually — it exists so call sites share one component instead
// of hand-writing <button> everywhere, and can opt into a `variant` class
// if a future style needs one.
export default function Button({ variant, className, ...rest }) {
  const classes = [variant && `btn-${variant}`, className].filter(Boolean).join(' ');
  return <button className={classes || undefined} {...rest} />;
}

