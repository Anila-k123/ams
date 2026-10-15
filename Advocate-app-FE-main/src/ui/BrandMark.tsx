// The PactPro "P" mark (pillar + P), used wherever the app shows its own
// brand: sidebar (when the firm has no logo), sign-in page, homepage.
// Decorative next to the "PactPro" name, so it has no alt text.
import mark from '../assets/images/pactpro-mark.webp';

export default function BrandMark({ className = '' }: { className?: string }) {
  return <img className={`seal brand-mark${className ? ` ${className}` : ''}`} src={mark} alt="" aria-hidden="true" />;
}
