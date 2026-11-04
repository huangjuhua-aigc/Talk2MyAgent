/** Real UI recording via gstack browse; model replies come from the live DSH process. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
const exec = promisify(execFile)
const out = process.env.A2A_REAL_REPORT || 'D:/code/dsh-a2a/qa-artifacts/2026-10-31-real-chain'
const info = JSON.parse(await readFile(join(out,'info.json'),'utf8'))
const bin = join(homedir(),'.agents/skills/gstack/browse/dist/browse.exe')
const cwd = 'D:/code/dsh-a2a'
const cmd = async (...args) => (await exec(bin,args,{cwd,windowsHide:true,timeout:20000,maxBuffer:1_000_000})).stdout
const wait = ms => new Promise(r=>setTimeout(r,ms))
const checks=[], chapters=[], frames=[]
const assert = (ok,message) => {if(!ok)throw new Error(message);checks.push(message)}
const until = async (text) => {const deadline=Date.now()+20000;while(Date.now()<deadline){if((await cmd('text')).includes(text))return;await wait(300)}throw new Error('UI missing '+text)}
await mkdir(join(out,'frames'),{recursive:true})
await cmd('goto',info.baseURL);await cmd('viewport','1280x960');await until('公网已上线')
for (const label of ['Agent 概览','公网中继','公开简报','来访记录']) {
  if ((await cmd('is','visible',`[aria-label="展开${label}"]`)).trim()==='true') await cmd('click',`[aria-label="展开${label}"]`)
}
await cmd('console','--clear')
const start=Date.now();let recording=true,failure
const capture=(async()=>{while(recording){const file=`frames/${String(frames.length).padStart(6,'0')}.png`;await cmd('screenshot','--viewport',join(out,file));frames.push({file,time:(Date.now()-start)/1000});await wait(150)}})()
async function chapter(text){chapters.push({time:(Date.now()-start)/1000,text});console.log(text);await wait(1500)}
try {
  await chapter('真实 DeepSeek Agent：本地服务就绪后，中继上线')
  const text=await cmd('text');assert(text.includes('deepseek-flash'),'页面展示真实模型');assert(text.includes('空闲 30 秒暂停'),'页面展示沙箱生命周期')
  const address=await cmd('js','document.querySelector("[data-testid=relay-url]").textContent')
  assert(address.includes('127.0.0.1:8787/r/'),'访问地址来自本地 Relay')
  await cmd('click','[aria-label="收起Agent 概览"]');await cmd('reload');await wait(600)
  assert((await cmd('is','visible','[aria-label="展开Agent 概览"]')).trim()==='true','折叠状态刷新保留')
  await chapter('关闭与重新发布：地址保持不变')
  await cmd('click','button:text-is("关闭公网发布")');await until('已关闭')
  assert((await cmd('is','disabled','button:text-is("复制聊天邀请")')).trim()==='true','离线时不能复制邀请')
  await cmd('click','button:text-is("开启公网发布")');await until('公网已上线')
  assert(await cmd('js','document.querySelector("[data-testid=relay-url]").textContent')===address,'重新发布保留访问路径')
  await chapter('通过 A2A 技能查询实测任务：验证重启后私有文件仍在')
  await exec(process.execPath,['--import','tsx','scripts/real-chain-check.ts','task','alice','alice-restart'],{cwd:'D:/code/Talk2MyAgent/packages/a2a-host',windowsHide:true,timeout:100000})
  await cmd('click','[aria-label="收起公网中继"]');await cmd('click','[aria-label="收起公开简报"]')
  await cmd('scroll','[aria-label="来访记录"]');await wait(3000)
  await cmd('js','window.scrollTo(0,document.body.scrollHeight)')
  await until('generated inside the real Alice sandbox; persisted on its owned disk')
  await chapter('真实模型答复：随机校验码、越界拒绝、生成文件持久化')
  await wait(4000)
  await exec(process.execPath,['--import','tsx','scripts/real-chain-check.ts','task','alice','alice-restart'],{cwd:'D:/code/Talk2MyAgent/packages/a2a-host',windowsHide:true,timeout:100000})
  checks.push('真实 A2A 回复验证公共及私有随机校验码、算式和生成文件')
  await cmd('screenshot',join(out,'real-conversations.png'))
  await cmd('viewport','390x844');await cmd('js','window.scrollTo(0,0)');await chapter('手机宽度：真实记录与中继控制')
  assert((await cmd('js','document.documentElement.scrollWidth <= window.innerWidth')).trim()==='true','手机页面无横向溢出')
  await cmd('screenshot','--viewport',join(out,'mobile.png'))
  await cmd('viewport','1280x960');await cmd('click','[aria-label="展开Agent 概览"]');await cmd('click','[aria-label="展开公网中继"]');await cmd('js','window.scrollTo(0,0)')
  await chapter('测试完成：真实 Agent 与本地 Relay 保持在线')
  await cmd('screenshot','--viewport',join(out,'real-overview.png'))
  assert(!(await cmd('console')).includes('[error]'),'浏览器无控制台错误')
}catch(e){failure=String(e);console.error(failure)}finally{
  recording=false;await capture;const end=(Date.now()-start)/1000
  await writeFile(join(out,'frames.ffconcat'),'ffconcat version 1.0\n'+frames.map((f,i)=>`file '${f.file}'\nduration ${Math.max(.04,(frames[i+1]?.time??end)-f.time).toFixed(3)}`).join('\n')+`\nfile '${frames.at(-1).file}'\n`)
  await writeFile(join(out,'walkthrough.json'),JSON.stringify({model:info.model,checks,chapters,duration:end,frames:frames.length,failure},null,2))
  console.log(JSON.stringify({checks:checks.length,duration:end,frames:frames.length,failure}))
}
if(failure)process.exitCode=1
