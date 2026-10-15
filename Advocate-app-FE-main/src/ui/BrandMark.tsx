// The PactPro pillar-P mark (white pillar, red P, transparent) for the
// collapsed sidebar rail when the firm has no logo of its own.
// Decorative next to the "PactPro" name, so it has no alt text.
import mark from '../assets/images/pactpro-mark-light.webp';

export default function BrandMark({ className = '' }: { className?: string }) {
  return <img className={`seal brand-mark${className ? ` ${className}` : ''}`} src={mark} alt="" aria-hidden="true" />;
}
