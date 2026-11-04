/** Replay UI checks through gstack browse and continuously capture its viewport. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
const exec = promisify(execFile)
const directory = process.env.A2A_UI_RECORDING_DIR || join(process.cwd(), 'qa-artifacts', '2026-10-31')
const browse = process.env.BROWSE_BIN || join(homedir(), '.agents/skills/gstack/browse/dist', process.platform === 'win32' ? 'browse.exe' : 'browse')
const demo = JSON.parse(await readFile(join(directory, 'demo.json'), 'utf8'))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const clean = value => value.split('\n').filter(line => !line.startsWith('--- BEGIN') && !line.startsWith('--- END')).join('\n').trim()
const command = async (...args) => clean((await exec(browse, args, { cwd: process.cwd(), windowsHide: true, timeout: 20000, maxBuffer: 1_000_000 })).stdout)
const checks = [], chapters = [], frames = []
const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message) }
const hasText = async text => assert((await command('text')).includes(text), text)
const button = text => `button:text-is("${text}")`
const click = async selector => { await command('click', selector); await wait(600) }
const until = async (text, limit = 16000) => {
  const deadline = Date.now()+limit
  while (Date.now()<deadline) { if ((await command('text')).includes(text)) { checks.push(text); return } await wait(300) }
  throw new Error(`UI did not reach: ${text}`)
}
await mkdir(join(directory,'frames'),{recursive:true})
await command('goto', demo.baseURL)
await command('viewport','1280x960')
await wait(700)
// Reset only this isolated demo's presentation before the recorded pass.
if (await command('is','visible','[aria-label="展开公网中继"]')==='true') await click('[aria-label="展开公网中继"]')
if (await command('is','visible',button('关闭公网发布'))==='true') { await click(button('关闭公网发布')); await until('已关闭') }
if (await command('is','visible','[aria-label="收起Agent 概览"]')==='true') await click('[aria-label="收起Agent 概览"]')
await command('js','window.scrollTo(0,0)')
await command('console','--clear')
const start = Date.now()
let recording = true, failure
const capture = (async () => {
  while(recording) {
    const file = `frames/${String(frames.length).padStart(6,'0')}.png`
    await command('screenshot','--viewport',join(directory,file))
    frames.push({file,time:(Date.now()-start)/1000})
    await wait(150)
  }
})()
async function chapter(label) {
  chapters.push({time:(Date.now()-start)/1000,label})
  console.log(label)
  await wait(1200)
}
try {
  await chapter('01 首页：独立访客沙箱与折叠状态（固定测试 Agent）')
  await click('[aria-label="展开Agent 概览"]')
  await hasText('空闲 30 秒暂停、10 分钟停止')
  await wait(2000)
  await click('[aria-label="收起Agent 概览"]')
  await command('reload'); await wait(800)
  assert(await command('is','visible','[aria-label="展开Agent 概览"]')==='true','折叠状态刷新后保留')

  await chapter('02 中继地址校验：错误地址禁止发布')
  await command('select','[aria-label="Relay 服务"]','custom')
  await command('fill','[aria-label="Relay host"]','https://relay.example.com/wrong-path')
  await wait(1400)
  assert(await command('is','disabled',button('开启公网发布'))==='true','错误中继地址禁止发布')
  await hasText('不需要路径')

  await chapter('03 发布到本地 Relay：http://127.0.0.1:8787')
  await command('fill','[aria-label="Relay host"]','http://127.0.0.1:8787')
  await click(button('开启公网发布'))
  await until('公网已上线')
  const relayUrl = await command('js', 'document.querySelector("[data-testid=relay-url]").textContent')
  assert(relayUrl.includes('127.0.0.1:8787/r/'),'访问地址使用本地 Relay 的 /r/ 路由')
  await wait(1500)
  await click(button('复制聊天邀请'))
  await until('--card-url')
  await command('scroll','[data-testid="relay-invitation"]')
  await wait(2200)
  assert((await command('text')).includes('A2A_PEER_'),'生成包含地址和凭据引用的完整邀请')
  await command('reload'); await until('公网已上线')
  assert(await command('js','document.querySelector("[data-testid=relay-url]").textContent')===relayUrl,'刷新后发布地址不变')
  await command('scroll','[aria-label="公网中继"]'); await wait(700)
  await click(button('关闭公网发布')); await until('已关闭')
  assert(await command('is','disabled',button('复制聊天邀请'))==='true','关闭发布后邀请按钮不可用')
  await wait(1500)
  await click(button('开启公网发布')); await until('公网已上线')
  assert(await command('js','document.querySelector("[data-testid=relay-url]").textContent')===relayUrl,'重新发布保留原访问地址')

  await chapter('04 公开简报：编辑保存、开关持久化')
  await click('[aria-label="收起公网中继"]')
  await command('scroll','[aria-label="公开简报"]'); await wait(700)
  await click(button('编辑简报'))
  await command('fill','[aria-label="编辑公开简报"]','## UI 测试简报\n\n- 本地 Relay 发布、关闭与重连已验证。\n- 每位访客独立沙箱，公共资料只读。\n- 空闲 30 秒暂停，10 分钟停止，私有文件保留。')
  await wait(1600)
  await click(button('保存简报')); await until('简报已保存')
  await click('[aria-label="自动更新简报"]')
  assert(await command('is','checked','[aria-label="自动更新简报"]')==='false','自动简报开关可以关闭')
  await command('reload'); await until('UI 测试简报')
  assert(await command('is','checked','[aria-label="自动更新简报"]')==='false','自动简报关闭状态刷新后保留')
  await command('scroll','[aria-label="公开简报"]'); await wait(1000)
  await click('[aria-label="自动更新简报"]')
  assert(await command('is','checked','[aria-label="自动更新简报"]')==='true','自动简报恢复开启')

  await chapter('05 配置向导：环境自动准备、地址与端口校验')
  await click(button('+ 新建 Agent'))
  await until('启动时自动准备',30000)
  await wait(1800)
  await click(button('继续 →'))
  await command('fill','input[value="my-agent"]','UI 演示 Agent')
  await click(button('下一步 →'))
  await click(button('下一步 →'))
  await command('click','[aria-label="局域网地址（自动检测本机 IP）"]')
  await command('fill','input[placeholder="192.168.1.10:3080"]','127.0.0.1:70000')
  await wait(1800)
  assert(await command('is','disabled',button('下一步 →'))==='true','非法端口禁止进入下一步')
  await command('fill','input[placeholder="192.168.1.10:3080"]','127.0.0.1:3080')
  assert(await command('is','enabled',button('下一步 →'))==='true','合法本机地址可进入下一步')
  await wait(1300)
  await click(button('下一步 →'))
  await wait(1200)
  await click(button('下一步 →'))
  await hasText('空闲 30 秒暂停、10 分钟停止')
  await wait(1800)
  await click(button('暂不配置，返回首页'))
  await click('[aria-label="展开公网中继"]')
  await command('js','window.scrollTo(0,0)')
  await until('公网已上线')
  await chapter('完成：本地中继保持在线，测试使用独立数据与固定回复')
  await wait(2500)
} catch(error) { failure=String(error); console.error(failure) }
finally {
  recording=false; await capture
  const end=(Date.now()-start)/1000
  const time = seconds => { const ms=Math.round(seconds*1000); return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}` }
  await writeFile(join(directory,'chapters.srt'),chapters.map((c,i)=>`${i+1}\n${time(c.time)} --> ${time(chapters[i+1]?.time ?? end)}\n本地 UI 测试 | ${c.label}\n`).join('\n'))
  await writeFile(join(directory,'frames.ffconcat'),'ffconcat version 1.0\n'+frames.map((f,i)=>`file '${f.file}'\nduration ${Math.max(0.04,(frames[i+1]?.time ?? end)-f.time).toFixed(3)}`).join('\n')+`\nfile '${frames.at(-1).file}'\n`)
  await writeFile(join(directory,'walkthrough.json'),JSON.stringify({checks,chapters,frames:frames.length,duration:end,failure,model:demo.model},null,2))
  console.log(JSON.stringify({checks:checks.length,frames:frames.length,duration:end,failure}))
}
if(failure) process.exitCode=1
