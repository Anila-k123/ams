import {jwtDecode} from "jwt-decode";

/**
 * ✅ Checks if a JWT token is expired
 */
export function isTokenExpired(token) {
  if (!token) return true;
  try {
    const decoded = jwtDecode(token);
    const currentTime = Date.now() / 1000; // seconds
    return decoded.exp < currentTime;
  } catch (error) {
    console.error("Token decode error:", error);
    return true;
  }
}

/**
 * ✅ Logs the user out and redirects to login (with alert modal)
 */
export function logoutAndRedirect(showAlert = true) {
  // Optional user-friendly alert
  if (showAlert) {
    // Create modal element dynamically
    const modal = document.createElement("div");
    modal.innerHTML = `
      <div style="
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(0,0,0,0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
      ">
        <div style="
          background-color: #fff;
          border-radius: 12px;
          padding: 24px;
          width: 360px;
          text-align: center;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          font-family: 'Segoe UI', sans-serif;
        ">
          <h2 style="color: #d32f2f;">⚠️ Session Expired</h2>
          <p style="margin: 12px 0; font-size: 15px; color: #333;">
            Your session has expired. Please log in again to continue.
          </p>
          <button id="okBtn" style="
            background-color: #1976d2;
            color: white;
            border: none;
            padding: 8px 18px;
            border-radius: 8px;
            font-size: 15px;
            cursor: pointer;
          ">
            OK
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const okBtn = modal.querySelector("#okBtn");
    okBtn.onclick = () => {
      document.body.removeChild(modal);
      performLogout();
    };
  } else {
    performLogout();
  }
}

// Helper function — clear storage & redirect
function performLogout() {
  localStorage.removeItem("token");
  localStorage.removeItem("email");
  window.location.href = "/login";
}
