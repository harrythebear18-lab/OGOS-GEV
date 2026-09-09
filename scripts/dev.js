const { spawn } = require('child_process')

// Ensure Electron runs as Electron, not as Node
delete process.env.ELECTRON_RUN_AS_NODE

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})
