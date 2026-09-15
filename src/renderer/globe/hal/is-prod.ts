/**
 * Renderer-side production gating.
 *
 * Mirrors the main-process `is-prod.ts` so the HAL and plugins can
 * suppress debug logging and development-only assertions in
 * production builds.
 */

declare const __PROD__: boolean | undefined

export const isProdRenderer = typeof __PROD__ !== 'undefined' ? __PROD__ : false
export const isDevRenderer = !isProdRenderer

/**
 * Safe logger that drops non-error traffic in production.
 */
export const halLog = isProdRenderer
  ? {
      log: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: (...args: unknown[]) => console.error(...args),
    }
  : {
      log: (...args: unknown[]) => console.log(...args),
      info: (...args: unknown[]) => console.info(...args),
      warn: (...args: unknown[]) => console.warn(...args),
      debug: (...args: unknown[]) => console.debug(...args),
      error: (...args: unknown[]) => console.error(...args),
    }
