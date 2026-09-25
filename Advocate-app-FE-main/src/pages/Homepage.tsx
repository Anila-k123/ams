import { useNavigate } from 'react-router-dom';
import { Button } from 'primereact/button';
import hmlogo from '../assets/images/LOGO.png';
import '../assets/styles/Homepage.css';

function Homepage() {
  const navigate = useNavigate();
  return (
    <div id="homepage">
      <div id="welcomebox" className="flex justify-content-center text-center">
        <div>
          <h1 className="main-title">AMS</h1>
          <img src={hmlogo} alt="logo" />
          <div className="premium-divider">────────◆────────</div>
          {/* Self-registration is closed: accounts are created by a practice
              administrator in User Management. */}
          <Button id="loginbtn" label="LOGIN" onClick={() => navigate('/login')} />
        </div>
      </div>
    </div>
  );
}
export default Homepage;
