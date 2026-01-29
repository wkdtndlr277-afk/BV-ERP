module.exports = {
  apps: [
    {
      name: 'haccp-erp',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=haccp-erp-production --local --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
