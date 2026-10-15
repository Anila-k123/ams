import { Link } from 'react-router-dom';
import '../ui/pages/auth.css';
import { Icon } from '../ui/kit';
import { ThemeToggle } from './Login';
import BrandLogo from '../ui/BrandLogo';

function Homepage() {
  return (
    <div className="home">
      <span className="tape-strand" aria-hidden="true" />
      <header className="home-top">
        <div className="pp-art-brand"><BrandLogo /></div>
        <div className="row">
          <ThemeToggle />
          <Link className="btn tape" to="/login">Sign in</Link>
        </div>
      </header>
      <main className="home-hero">
        <div className="rule" aria-hidden="true" />
        <h1>PactPro</h1>
        <p className="home-lead">Cases, hearings, cause lists, drafting and billing for your chambers, in one place.</p>
        {/* Self-registration is closed: accounts are created by a practice
            administrator in User Management. */}
        <Link className="btn tape home-cta" to="/login">Sign in<Icon name="chevron" size="sm" /></Link>
        <p className="home-note">Accounts are created by your firm administrator. Clients sign in from their invitation email.</p>
      </main>
      <footer className="pp-art-foot home-foot"><span>Advocate Management System</span><span>Madras High Court and subordinate courts</span></footer>
    </div>
  );
}
export default Homepage;
