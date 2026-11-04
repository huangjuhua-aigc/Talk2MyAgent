/** Trusted test harness only; never adds execution tools to the public Agent. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const out = process.env['A2A_REAL_REPORT'] ?? 'D:/code/dsh-a2a/qa-artifacts/2026-10-31-real-chain'
const info = JSON.parse(await readFile(join(out,'info.json'),'utf8'))
const before = await readFile(join(info.publicRoot,'verification.txt'),'utf8')
process.env['MSB_HOME'] = join(info.sandboxHome,'state')
process.env['MSB_BACKEND'] = 'local'
const sdk = await import(pathToFileURL(join(info.sandboxHome,'sdk-0.7.11-win32-x64/node_modules/microsandbox/dist/index.js')).href)
const record = JSON.parse(await readFile(join(info.host,'workspaces',info.agentId,'.microsandbox/alice/record.json'),'utf8'))
const h = await sdk.Sandbox.get(record.name)
const wasPaused = h.status === 'paused'
if (wasPaused) await h.resume()
assert(['paused','running'].includes(h.status))
const sandbox = await h.connect()
try {
  const code = `import pathlib,os,json
assert os.getuid()==1000
p=pathlib.Path('/source/verification.txt')
denied=[]
for label,fn in [('overwrite',lambda:p.write_text('BAD')),('append',lambda:p.open('a')),('delete',lambda:p.unlink()),('rename',lambda:p.rename('/source/moved.txt')),('create',lambda:pathlib.Path('/source/new.txt').write_text('BAD'))]:
 try: fn()
 except OSError: denied.append(label)
assert len(denied)==5,denied
p=pathlib.Path('/work/crud.txt');p.write_text('first');p.write_text('updated');assert p.read_text()=='updated';p=p.rename('/work/renamed.txt');p.unlink();assert not p.exists()
assert not pathlib.Path('/work/../bob/private.txt').exists()
assert not pathlib.Path('/backend/chat.txt').exists()
assert not pathlib.Path('/mnt/c/Users').exists()
assert not os.getenv('DEEPSEEK_API_KEY')
pathlib.Path('/work/generated.txt').write_text('generated inside the real Alice sandbox; persisted on its owned disk')
print(json.dumps({'uid':os.getuid(),'publicMutationsDenied':denied,'privateCrud':True,'otherVisitorAbsent':True,'hostFilesAbsent':True,'modelCredentialAbsent':True,'generatedFile':'/work/generated.txt'}))`
  const execution = await sandbox.execStreamWith('python3',(b:any)=>b.args(['-I','-c',code]).user('1000:1000').timeout(10000))
  let text = '', exitCode
  for await (const e of execution) { if(e.kind==='stdout'||e.kind==='stderr')text+=Buffer.from(e.data).toString();if(e.kind==='exited')exitCode=e.code }
  assert.equal(exitCode,0,text)
  assert.equal(await readFile(join(info.publicRoot,'verification.txt'),'utf8'),before)
  const result = {at:new Date().toISOString(),sandbox:record.name,...JSON.parse(text),hostPublicFileUnchanged:true}
  await writeFile(join(out,'isolation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
} finally { if(wasPaused) await sandbox.pause() }
