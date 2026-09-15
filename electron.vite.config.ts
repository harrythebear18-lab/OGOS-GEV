import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import terser from '@rollup/plugin-terser'

const isProd = process.env.NODE_ENV === 'production'

/**
 * Production build hardening:
 *   - Sourcemaps suppressed in production
 *   - Terser minification for main, preload, and renderer
 *   - Logging stripped from Core Engine paths in production
 *   - Environment gating via define (process.env.NODE_ENV)
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      },
    },
    build: {
      sourcemap: !isProd, // no sourcemaps in production
      minify: isProd ? 'terser' : false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          ...(isProd ? { plugins: [terser({ ...prodTerserOptions() })] } : {}),
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      sourcemap: !isProd,
      minify: isProd ? 'terser' : false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          ...(isProd ? { plugins: [terser({ ...prodTerserOptions() })] } : {}),
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
  },
  renderer: {
    root: 'src/renderer',
    publicDir: resolve(__dirname, 'public'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [react()],
    optimizeDeps: {
      include: [
        'cesium',
        'mersenne-twister',
        'urijs',
        'protobufjs',
        'earcut',
        'jsep',
        'dompurify',
        'grapheme-splitter',
        'topojson-client',
        'kdbush',
        'ktx-parse',
        'pako',
        'rbush',
      ],
    },
    build: {
      sourcemap: !isProd,
      minify: isProd ? 'terser' : false,
      terserOptions: isProd ? {
        ...prodTerserOptions(),
        // Keep class names and function names for Cesium/WebGPU reflection
        keep_classnames: true,
        keep_fnames: /^(register|unregister|init|dispatch|execute)$/,
      } : undefined,
      rollupOptions: {
        input: {
          globe: resolve(__dirname, 'src/renderer/globe/index.html'),
        },
        output: {
          ...(isProd ? { plugins: [terser({ ...prodTerserOptions() })] } : {}),
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
      // Production feature gating
      __PROD__: JSON.stringify(isProd),
      __CORE_OBFUSCATED__: JSON.stringify(isProd),
    },
  },
})

/**
 * Shared Terser options for production.
 *
 * Obfuscation is intentionally light — enough to raise the cost of
 * casual reverse engineering without destroying stack traces or
 * debuggability in production.
 */
function prodTerserOptions() {
  return {
    compress: {
      drop_console: ['log', 'info', 'warn', 'debug'],
      drop_debugger: true,
      passes: 2,
    },
    mangle: {
      properties: false, // avoid breaking Cesium property access
      reserved: ['cesium', 'Cesium', 'window', 'document'],
    },
    format: {
      comments: false,
      beautify: false,
    },
    keep_classnames: true,
    keep_fnames: true,
  }
}
