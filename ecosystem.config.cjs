const path = require('node:path');
const fs = require('node:fs');

const envPath = path.join(__dirname, '.env');
const envValues = fs.existsSync(envPath)
  ? fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .reduce((accumulator, line) => {
        if (!line || line.trim().startsWith('#')) {
          return accumulator;
        }

        const separator = line.indexOf('=');

        if (separator === -1) {
          return accumulator;
        }

        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1);

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        accumulator[key] = value;
        return accumulator;
      }, {})
  : {};

module.exports = {
  apps: [
    {
      name: 'medvedsson-api',
      cwd: __dirname,
      script: 'pnpm',
      args: 'start:api',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'medvedsson-pwa',
      cwd: __dirname,
      script: 'pnpm',
      args: 'start:pwa',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        ADMIN_PASSWORD: envValues.ADMIN_PASSWORD,
        SESSION_SECRET: envValues.SESSION_SECRET,
        SESSION_TTL_HOURS: envValues.SESSION_TTL_HOURS,
        API_BASE_URL: envValues.API_BASE_URL,
        NEXT_PUBLIC_API_BASE_URL: envValues.NEXT_PUBLIC_API_BASE_URL
      }
    }
  ]
};
