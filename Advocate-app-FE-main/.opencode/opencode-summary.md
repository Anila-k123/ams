# anchored-summary

## Goal
- Implement production-grade password validation, global loading system, calendar navigation fixes, Calendar→Hearings merge, Forgot Password with Email OTP, and a centralized global UX feedback (loader + toast) system across the entire application.

## Constraints & Preferences
- Do NOT break existing login/signup authentication.
- Calendar and Hearings both opened the same screen — merge into a single Hearings module.
- Forgot Password OTP: 6-digit, 10-minute expiry, SHA-256 hashed (not plaintext), rate-limited (5/hr), generic server responses (no email enumeration).
- Global loader: 200ms delay to avoid flash, always hide in `finally`, ref-counted for concurrent operations.
- Toast system: success/error/warning/info auto-dismiss 4s, top-right, slide+fade, no browser `alert()`.
- All existing `alert()` calls must be replaced with the global toast.

## Progress
### Done
- **Password validation (frontend + backend)**: `SignupRequestDTO.java` — added `@Pattern` regex `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@#$%^&*!?_+=-])[A-Za-z\\d@#$%^&*!?_+=-]{8,32}$`. `AdvocateController.java` — added `@ExceptionHandler(MethodArgumentNotValidException.class)` returning `{error: message}` with HTTP 400. `Signup.jsx` — live checklist (5 rules), password strength bar (Weak/Medium/Strong), Show/Hide toggle, submit disabled until valid. `Signup.css` — styles for checklist, strength bar, toggle button.
- **Calendar white buttons fix**: `CalendarPage.css:37` — changed hardcoded `color: #fff` → `color: var(--text-primary)` (invisible text in light theme). Added `.active-view` class with `--btn-primary-bg` gradient. `CalendarPage.jsx` — added active class conditional to Week/Month/Agenda buttons.
- **Sidebar navigation bugs**: Bug 1 — Hearings NavLink pointed to `/dashboard/calendar` (same URL as Calendar), making distinct active states impossible; added `end` prop to Calendar NavLink, changed Hearings to `/dashboard/hearings` with `isActive` function. Bug 2 — no `/dashboard/hearings` route existed; added `<Route path="/hearings" element={<HearingsPage />} />` in Dashboard nested routes.
- **Calendar→Hearings merge**: Renamed `CalendarPage.jsx` → `HearingsPage.jsx`, `CalendarPage.css` → `HearingsPage.css`. Removed Calendar sidebar item. Changed all 5 `/dashboard/calendar` nav URLs → `/dashboard/hearings`. Changed `/calendar` route to `<Navigate to="/dashboard/hearings" replace />`. Updated App.jsx (removed standalone `/calendar` route), ChatbotWidget.jsx, AssistantContext.jsx, AssistantInput.jsx. Backend: updated AssistantService.java (5 URLs) and EventPublishingAspect.java.
- **Forgot Password with Email OTP**: Backend — created `PasswordResetOtp` entity (`password_reset_otp` table: id, advocateId, email, hashedOtp, expiresAt, used, createdAt), `PasswordResetOtpRepository`, `PasswordResetService` (SecureRandom 6-digit OTP, SHA-256 hashing, 5/hr rate limit, JavaMailSender delivery), 3 DTOs (`ForgotPasswordRequest`, `VerifyOtpRequest`, `ResetPasswordRequest` with password pattern validation), `AuthController` (3 POST endpoints + validation handler). Email — added `otpEmail()` method to `EmailTemplateService` (red-themed card, centered 36px OTP, expiry warning, "ignore if not requested" note). Frontend — created `ForgotPassword.jsx` (email input → generic success → navigate to verify), `VerifyOtp.jsx` (6-digit boxed input with auto-advance), `ResetPassword.jsx` (new password with strength bar + checklist + confirm match), `ForgotPassword.css` (glass card, OTP boxes, strength styles). Added 3 routes to App.jsx (`/forgot-password`, `/verify-otp`, `/reset-password`). Added "Forgot Password?" link to Login.jsx. Backend + frontend both build clean.
- **Global UX Feedback System** — Infrastructure:
  - `LoadingContext.jsx`: Added `showLoader(message?)`, `hideLoader()` with ref-counting and 200ms delay.
  - `ToastContext.jsx`: `ToastProvider` with `success`, `error`, `warning`, `info`, `dismiss`. Uses timed auto-dismiss (4s default) + manual close.
  - `GlobalToast.jsx`: Renders active toasts from context. Each toast has enter/exit animation, close button, type-based styling.
  - `Toast.css`: Updated for global container (`.toast-container`) with slide-in/fade-out animations.
  - `main.jsx`: Wrapped with `<ToastProvider>`, added `<GlobalToast />`.
  - Replaced all 25 `alert()` calls with global toast in Login, Signup, ForgotPassword, ResetPassword, InvoicesPanel, Expenses, AnalyticsPage, NotificationsCenter.
  - Removed local toast state and `<Toast>` component from Cases.jsx and HearingsPage.jsx.
- **Frontend build passes with zero errors.**

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Toast system uses a queue with unique IDs — multiple toasts can stack simultaneously, each auto-dismisses independently.
- Global loader uses ref-counting (`countRef`) — concurrent API calls keep the loader visible until the last one finishes.
- 200ms delay uses `setTimeout` cleared in `finally` — operations under 200ms never flash the loader.
- Each toast auto-dismisses after 4 seconds, but also has a manual close button (X).
- Toast types (success/error/warning/info) are distinguished by left border color, icon emoji, and background tint.
- Toast styles are separate from LoadingContext styles — `GlobalToast.css` contains only toast animations and positioning.
- `showLoader()`/`hideLoader()` API provides imperative control for pages that don't use the declarative `withLoading()` wrapper.
- Existing `withLoading()` calls are preserved — the new `showLoader()`/`hideLoader()` are additive, not breaking.

## Next Steps
(none — current phase complete)

## Critical Context
- `LoadingContext` now exposes both imperative (`showLoader`/`hideLoader`) and declarative (`withLoading`) APIs — both use the same ref-counted state.
- `ToastContext` stores an array of toast objects `{id, type, message}`. Each toast on creation starts a 4-second auto-dismiss timer. Manual close calls `removeToast(id)` immediately.
- `GlobalToast` reads `toasts` array and maps each to a `<div className="toast toast-{type} toast-enter">`. Dismiss sets `exiting=true` → `toast-exit` class → 250ms delay → `dismiss(id)`.
- `GlobalLoader.css` and `GlobalLoader.jsx` already handle the `visible` class-based fade transition — no changes needed.

## Relevant Files
- `src/contexts/LoadingContext.jsx` — LoadingProvider, useLoading
- `src/contexts/ToastContext.jsx` — ToastProvider, useToast
- `src/components/GlobalToast.jsx` — toast renderer
- `src/assets/styles/Toast.css` — toast styles
- `src/main.jsx` — providers and global components
- `src/pages/Login.jsx` — login with toast
- `src/pages/Signup.jsx` — signup with toast + password validation
- `src/pages/ForgotPassword.jsx` — forgot password with toast
- `src/pages/ResetPassword.jsx` — reset password with toast
- `src/pages/InvoicesPanel.jsx` — invoices with toast
- `src/pages/Expenses.jsx` — expenses with toast
- `src/pages/AnalyticsPage.jsx` — analytics with toast
- `src/pages/NotificationsCenter.jsx` — notifications with toast
- `src/pages/Cases.jsx` — cases with global toast (local removed)
- `src/pages/HearingsPage.jsx` — hearings with global toast (local removed)
