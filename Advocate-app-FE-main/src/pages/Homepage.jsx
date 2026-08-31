import {Link} from 'react-router-dom'
import hmlogo from '../assets/images/LOGO.png'
import '../assets/styles/Homepage.css'
function Homepage(){
return(
    <>
    <div id='homepage'>
        <div className="navbar container">
          <div className="navbar-branding">
            <div className="navbar-logo-wrap">
              <img src={hmlogo} alt="logo" className="navbar-logo" />
            </div>
            <div className="navbar-title-group">
              <span className="navbar-app-title">Advocate-App</span>
              <span className="navbar-app-sub">Practice Manager</span>
            </div>
          </div>
          <div className="navbar-links">
            <button className='btn btn-outline-secondary border'><Link to="/" className='navbar-brand'>HOME</Link></button>
            <button className="btn btn-outline-secondary border"><Link to="/login" className='navbar-brand'>Login</Link></button>
            <button className="btn btn-outline-secondary border"><Link to="/dashboard" className='navbar-brand'>Dashboard</Link></button>
          </div>
        </div>
        <div id='welcomebox' className="container-xl d-flex justify-content-center rounded text-center">
          <div>
          <h1 className="welcome-title">WELCOME</h1>
          <h1 className="main-title">ADVOCATE CASE MANAGEMENT SYSTEM</h1>
          <img src={hmlogo} alt="logo" />
          <h3 className="coder-text">CODER:CHILL-CODING</h3>
          <div className="premium-divider">────────◆────────</div>
          {/* Self-registration is closed - accounts are created by a practice
              administrator in User Management. The backend refuses
              /api/advocates/signup unless ALLOW_PUBLIC_SIGNUP is set, so
              offering the form here would only lead to a 403. */}
          <button id='loginbtn'><Link to='login'>LOGIN</Link></button><br />
          <span className="homepage-note">
            Accounts are created by your practice administrator.
          </span>
          </div>
        </div>
    </div>
          </>
)
}
export default Homepage