/**
 * Production mode detection + logging gating.
 *
 * `isProd` is derived from both `NODE_ENV` and the absence of the
 * Vite dev-server URL. It gates development-only logging, devtools,
 * and debug features so the production build stays tight.
 */

export const isProd = process.env.NODE_ENV === 'production' && !process.env.ELECTRON_RENDERER_URL
export const isDev = !isProd

/**
 * Conditional logger that suppresses non-error logs in production.
 * Keeps errors for diagnostics but removes verbose info/warn.
 */
export const prodLog = isProd
  ? {
      log: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: console.error,
    }
  : {
      log: console.log,
      info: console.info,
      warn: console.warn,
      debug: console.debug,
      error: console.error,
    }
