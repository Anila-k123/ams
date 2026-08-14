import { useState } from "react";

export default function LoadingButton({
  children,
  loadingText,
  onClick,
  disabled,
  className = "",
  ...props
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e) => {
    if (loading || disabled || !onClick) return;
    setLoading(true);
    try {
      await onClick(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={className}
      disabled={loading || disabled}
      onClick={handleClick}
      {...props}
    >
      {loading ? loadingText || children : children}
    </button>
  );
}
