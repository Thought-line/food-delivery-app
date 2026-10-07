export default function AuthField({
  legend,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  errorPrefix = '',
  endSlot,
}) {
  const hasError = Array.isArray(error) ? error.length > 0 : Boolean(error);

  return (
    <div className="auth-field-group">
      <fieldset className={`auth-field${hasError ? ' has-error' : ''}`}>
        <legend>{legend}</legend>
        <div className="auth-field-input">
          <input
            type={type}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            placeholder={placeholder}
          />
          {endSlot}
          {hasError && (
            <span className="auth-field-icon" aria-hidden="true">
              !
            </span>
          )}
        </div>
      </fieldset>
      {hasError &&
        (Array.isArray(error) ? (
          <ul className="field-checklist">
            {error.map((rule) => (
              <li key={rule} className="field-error">
                * {rule}
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-error">
            {errorPrefix}
            {error}
          </p>
        ))}
    </div>
  );
}
