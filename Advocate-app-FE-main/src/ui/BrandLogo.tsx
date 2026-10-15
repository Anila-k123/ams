// The PactPro logo (pillar-P wordmark) in place of the "PactPro" text.
// Two versions:
// - default: the original navy-and-red logo on a white chip (public home page);
// - onDark: the white-and-red version, transparent, straight on the app's dark
//   sidebar (inside the app, after sign-in).
// The sign-in pages use their own full logo (pages/Login.tsx).
import wordmark from '../assets/images/pactpro-wordmark.webp';
import wordmarkLight from '../assets/images/pactpro-logo-light.webp';

export default function BrandLogo({ className = '', onDark = false }: { className?: string; onDark?: boolean }) {
  const cls = `brand-logo${onDark ? ' on-dark' : ''}${className ? ` ${className}` : ''}`;
  return <img className={cls} src={onDark ? wordmarkLight : wordmark} alt="PactPro" />;
}
