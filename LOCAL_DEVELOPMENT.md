# Local Development Guide

## Quick Start (One Double-Click)

Run **`run-project.bat`** — it opens two command windows:

| Window | Service | URL |
|--------|---------|-----|
| 1 | Backend (Spring Boot) | http://localhost:8080 |
| 2 | Frontend (Vite) | http://localhost:5173 |

No manual steps needed. Close each window to stop the corresponding service.

---

## Starting Individually

### Backend

**Windows (double-click):** Run `run-backend-dev.bat` from `Advocate-app-BE-main/`.

**Windows PowerShell / CMD (manual):**
```
.\mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=dev"
```

**If Maven Wrapper is unavailable:**
```
mvn spring-boot:run "-Dspring-boot.run.profiles=dev"
```

> The profile argument **must be quoted** (`"-Dspring-boot.run.profiles=dev"`) for Windows PowerShell compatibility.

The script:
- Checks Java is installed
- Verifies Maven Wrapper (`mvnw.cmd`) exists
- Starts Spring Boot with the `dev` profile on port **8080**

### Frontend

Run from `Advocate-app-FE-main/`:

```
run-frontend.bat
```

The script:
- Checks Node.js and npm are installed
- Verifies `package.json` exists
- Runs `npm install` if `node_modules` is missing
- Starts Vite dev server on port **5173**

---

## Required Software

| Software | Version | Check |
|----------|---------|-------|
| Java | 21+ | `java -version` |
| Maven Wrapper | (bundled) | `Advocate-app-BE-main/mvnw.cmd` |
| Node.js | 18+ | `node -v` |
| npm | (bundled with Node) | `npm -v` |

---

## Ports Used

| Port | Service | Configurable |
|------|---------|-------------|
| 8080 | Spring Boot Backend | `server.port` in `application.properties` |
| 5173 | Vite Frontend Dev Server | `vite.config.js` |
| 3306 | MySQL (external dependency) | `spring.datasource.url` in `application-dev.properties` |

---

## Environment Variables

Set these before starting to override defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `http://localhost:8080` | Backend URL for the frontend API calls |
| `SPRING_DATASOURCE_URL` | `jdbc:mysql://localhost:3306/advocate` | Database connection string |
| `SPRING_DATASOURCE_USERNAME` | `root` | Database username |
| `SPRING_DATASOURCE_PASSWORD` | (empty) | Database password |

---

## Switching to Production

**Backend:**
```bash
.\mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=prod"
```
Or set environment variable: `SPRING_PROFILES_ACTIVE=prod`

**Frontend:**
```
set VITE_API_BASE=https://your-production-api.com
npm run build
```
Then serve the `dist/` folder with any static file server.

---

## Troubleshooting

| Symptom | Solution |
|---------|----------|
| `'java' is not recognized` | Install JDK 21+ and add it to your PATH |
| `'node' is not recognized` | Install Node.js 18+ from https://nodejs.org |
| `'npm' is not recognized` | Node.js includes npm — reinstall Node.js |
| `mvnw.cmd not found` | Run `mvn -N wrapper:wrapper -Dmaven=3.9.9` in the backend directory |
| `package.json not found` | Ensure you are in the frontend directory |
| Backend fails to connect to database | Verify MySQL is running and the credentials in `application-dev.properties` are correct |
| Frontend shows blank page / API calls fail | Check that the backend is running on port 8080, or set `VITE_API_BASE` to the correct backend URL |
| Port already in use | Change `server.port` in `application-dev.properties` or `VITE_API_BASE` accordingly |

---

## Project Structure

```
ADVOCATE ZIP/
├── Advocate-app-BE-main/       # Spring Boot backend
│   ├── mvnw.cmd
│   ├── pom.xml
│   ├── run-backend-dev.bat      # Backend launcher
│   └── src/
└── Advocate-app-FE-main/       # React + Vite frontend
    ├── package.json
    ├── run-frontend.bat          # Frontend launcher
    └── src/
├── run-project.bat              # Master launcher (both services)
└── LOCAL_DEVELOPMENT.md         # This file
```
