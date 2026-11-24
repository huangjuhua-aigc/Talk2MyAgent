import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadFile } from '../bin/download.mjs'

test('downloads bounded ranges, checks integrity, rejects redirects and incomplete bytes, and never overwrites',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'a2a-skill-download-'))),bytes=Buffer.alloc(1100017,143),id=randomUUID()
  const etag=`"${createHash('sha256').update(bytes).digest('hex')}"`
  let mode='good', calls=0
  const server=createServer((req,res)=>{
    calls++;assert.equal(req.url,`/r/13800000001/a2a/files/${id}`);assert.equal(req.headers.authorization,'Bearer fixture-token')
    if(mode==='redirect'){res.writeHead(302,{location:'http://127.0.0.1:1/stolen'});res.end();return}
    if(req.method==='HEAD'){res.writeHead(200,{etag,'content-length':String(bytes.length)});res.end();return}
    const match=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range),start=Number(match[1]),end=Number(match[2])
    assert.equal(req.headers['if-range'],etag);assert.ok(end-start+1<=1024*1024)
    res.writeHead(206,{etag,'content-range':`bytes ${start}-${end}/${bytes.length}`})
    res.end(mode==='corrupt'?Buffer.alloc(end-start+1):mode==='short'?bytes.subarray(start,end):bytes.subarray(start,end+1))
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const endpoint=`http://127.0.0.1:${server.address().port}/r/13800000001/a2a`
  try{
    const target=join(root,'result.mp4')
    await downloadFile(endpoint,'fixture-token',id,target);assert.deepEqual(await readFile(target),bytes);assert.equal(calls,3)
    await assert.rejects(downloadFile(endpoint,'fixture-token',id,target),/already exists/);assert.equal(calls,3)
    for(mode of ['corrupt','short','redirect']){
      await assert.rejects(downloadFile(endpoint,'fixture-token',id,join(root,mode)))
      assert.deepEqual(await readdir(root),['result.mp4'])
    }
    await assert.rejects(downloadFile(endpoint,'fixture-token','../../admin',join(root,'bad')),/Invalid file ID/)
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}
})
