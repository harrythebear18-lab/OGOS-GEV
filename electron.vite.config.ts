import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

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
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
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
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
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
      rollupOptions: {
        input: {
          globe: resolve(__dirname, 'src/renderer/globe/index.html'),
        },
      },
    },
  },
})
