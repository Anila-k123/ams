# ⚖️ Advocate Management System — Frontend

This is the **React 19 + Vite 7 frontend** for the Advocate Management System.

> 📘 **Full project documentation is available in the parent README**  
> [`../README.md`](../README.md)

## Quick Start

```bash
npm install
npm run dev
```

Or double-click `run-frontend.bat`.

**Prerequisites:** Node.js 18+, npm 9+

| Service | URL |
|---------|-----|
| Dev Server | http://localhost:5173 |

## Tech Stack

- React 19 · Vite 7 · React Router v7
- @stomp/stompjs (WebSocket) · axios · Recharts
- react-big-calendar · react-icons · date-fns

## Project Structure

```
src/
├── pages/         # 29 page components
├── components/    # 24 reusable components
├── contexts/      # 9 React contexts (theme, auth, permissions, WebSocket, etc.)
├── services/      # API service classes (Dashboard, Documents, RBAC, Reports)
├── hooks/         # Custom hooks (WebSocket listeners, pagination)
├── utils/         # Auth helpers, currency formatter
└── assets/        # Styles (33 CSS files), images
```

## Key Features

- 29 pages · 24 components · 9 context providers
- Dark/light theme · Responsive layout · Glassmorphism UI
- Real-time WebSocket updates (notifications, dashboard, activities)
- RBAC-gated routes and UI elements
- Global search (Ctrl+K) · Skeleton loading · Toast system

See the [parent README](../README.md) for architecture, deployment, and full feature documentation.
