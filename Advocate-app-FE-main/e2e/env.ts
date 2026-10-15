// Shared settings for the browser E2E run (docs/E2E.md).
//
// Everything runs against its OWN servers and database, never the working
// instance: backend :8090 on database `pactpro_e2e`, frontend :5180, a local
// stand-in for the AI provider on :8099, emails written as files into
// e2e/.mail (nothing is sent), uploads into e2e/.uploads. Real AI keys are
// blanked and the court scraper points at a closed port, so no test can reach
// an outside service.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const FE_DIR = path.resolve(here, '..')
export const BE_DIR = path.resolve(FE_DIR, '..', 'Advocate-app-BE-Django')
export const PYTHON = path.join(BE_DIR, 'venv', 'Scripts', 'python.exe')
export const MAIL_DIR = path.join(here, '.mail')
export const UPLOAD_DIR = path.join(here, '.uploads')
export const STATE_FILE = path.join(here, '.state', 'state.json')

export const API = 'http://127.0.0.1:8090'
export const APP = 'http://localhost:5180'
export const LLM_STUB = 'http://127.0.0.1:8099'
export const E2E_DB = 'pactpro_e2e'

export const backendEnv: Record<string, string> = {
  DB_NAME: E2E_DB,
  TENANCY_MODE: 'firm',
  // E2E firms are synthetic: they may use the unapproved example plans (docs/SUBSCRIPTIONS.md).
  SUBSCRIPTION_TEST_PLANS: 'True',
  TENANCY_COLUMNS: 'True',
  DEBUG: 'True',
  ALLOWED_HOSTS: 'localhost,127.0.0.1',
  CORS_ORIGINS: `${APP},http://127.0.0.1:5180`,
  CLIENT_APP_URL: APP,
  PUBLIC_BASE_URL: API,
  MAIL_BACKEND: 'django.core.mail.backends.filebased.EmailBackend',
  MAIL_FILE_PATH: MAIL_DIR,
  DOCUMENT_UPLOAD_DIR: UPLOAD_DIR,
  COURT_API_BASE: 'http://127.0.0.1:9',          // closed port: court features answer 503
  // Assistant (Lisa): OpenAI-compatible local stand-in, no real keys.
  LLM_PROVIDER: 'local',
  LLM_BASE_URL: LLM_STUB,
  LLM_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '',
  // Drafting: same stand-in; every external key blanked.
  DRAFTING_LLM_ACTIVE: 'local',
  DRAFTING_LLM_PROVIDER: 'openai',
  DRAFTING_LLM_BASE_URL: LLM_STUB,
  DRAFTING_LLM_API_KEY: 'stub',
  DRAFTING_OPENAI_API_KEY: '', DRAFTING_GEMINI_API_KEY: '', DRAFTING_ANTHROPIC_API_KEY: '',
  DRAFTING_SARVAM_API_KEY: '', DRAFTING_GOOGLE_TRANSLATE_API_KEY: '',
  DRAFTING_JOB_RUNNER: 'thread',
  SUMMARY_ENABLED: 'False',
  PYTHONIOENCODING: 'utf-8',
}
