#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { configure, setEnabled, status, command, assertPrivateDirectory } from './manager.mjs'
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  state: { type: 'string' }, relay: { type: 'string' }, rpc: { type: 'string' }, card: { type: 'string' },
  name: { type: 'string', default: 'A2A Agent' }, 'shared-root': { type: 'string', multiple: true }, 'allow-loopback-http': { type: 'boolean', default: false } } })
try {
  if (!values.state) throw new Error('Usage: a2a-connector publish|stop|status|shutdown --state <private-dir> [--relay <https-origin> --rpc <local-http-url> --card <local-card-url> --shared-root <data-dir>]')
  const dir = resolve(values.state), verb = positionals[0]
  if (verb === 'publish') {
    if (!values.relay || !values.rpc || !values.card || !values['shared-root']?.length) throw new Error('publish requires --relay, --rpc, --card and --shared-root (repeat for every authorized visitor root)')
    await assertPrivateDirectory(dir, values['shared-root'])
    await configure(dir, { relayOrigin: values.relay, localRpcUrl: values.rpc, localCardUrl: values.card, displayName: values.name, allowHttp: values['allow-loopback-http'] })
    console.log(JSON.stringify(await setEnabled(dir, true), null, 2))
  } else if (verb === 'stop') console.log(JSON.stringify(await setEnabled(dir, false), null, 2))
  else if (verb === 'status') console.log(JSON.stringify(await status(dir), null, 2))
  else if (verb === 'shutdown') console.log(JSON.stringify(await command(dir, 'shutdown'), null, 2))
  else throw new Error('Unknown command')
} catch (e) { console.error(e.message); process.exitCode = 1 }
