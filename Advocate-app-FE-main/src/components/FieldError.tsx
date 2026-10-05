// The message under a form field: a format error (red) or a warning (amber),
// e.g. a GSTIN registered in a different state. Rules: utils/validators.ts.
export default function FieldError({ error, warning }: { error?: string; warning?: string }) {
  if (error) return <small className="field-error" role="alert">{error}</small>;
  if (warning) return <small className="field-warning">{warning}</small>;
  return null;
}
