import { $ } from 'bun'

const host = Bun.env.YT_HOST,
  token = Bun.env.YT_TOKEN

if (!host || !token) {
  console.error('ERROR: YT_HOST and YT_TOKEN must be set in .env file.')
  process.exit(1)
}

await $`youtrack-workflow upload ./dist --host ${host} --token ${token}`

