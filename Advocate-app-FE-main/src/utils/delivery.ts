// Invitation email delivery states (firms/invitations.py).
export function deliveryLabel(status?: string | null): string {
  switch ((status || "PENDING").toUpperCase()) {
    case "SENT": return "email sent";
    case "FAILED": return "not delivered";
    case "CONSOLE": return "not emailed: printed in the server console (email is not set up)";
    default: return "email queued";
  }
}
