// The PactPro logo (pillar-P wordmark) in place of the "PactPro" text in the
// sidebar, sign-in page and homepage header. Sized by height (CSS) so it stays
// low; shown on a white chip so the navy lettering stays readable on the dark
// panels and in dark mode.
import wordmark from '../assets/images/pactpro-wordmark.webp';

export default function BrandLogo({ className = '' }: { className?: string }) {
  return <img className={`brand-logo${className ? ` ${className}` : ''}`} src={wordmark} alt="PactPro" />;
}
