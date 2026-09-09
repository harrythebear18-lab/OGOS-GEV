const { spawn } = require('child_process')

delete process.env.ELECTRON_RUN_AS_NODE

const child = spawn('npx', ['electron-vite', 'preview'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})
