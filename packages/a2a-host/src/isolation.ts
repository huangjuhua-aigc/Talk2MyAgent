import { cp, lstat, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import { assertPrivateDirectory } from '@talk2myagent/a2a-connector'
import { agentWorkspacesPath, dshHome, hostHome } from './paths.ts'
import type { AgentRecord } from './files.ts'

const within = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
async function inventory(root: string): Promise<string> {
  const rows: string[] = []
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw new Error('旧访客目录含链接，请先处理链接再迁移')
    if (stat.isDirectory()) {
      rows.push(`d:${relative(root, path)}`)
      for (const name of (await readdir(path)).sort()) await visit(join(path, name))
    } else if (stat.isFile()) {
      const hash = createHash('sha256')
      for await (const bytes of createReadStream(path)) hash.update(bytes)
      rows.push(`f:${relative(root, path)}:${hash.digest('hex')}`)
    } else { throw new Error('旧访客目录包含不支持迁移的特殊文件') }
  }
  await visit(root)
  return JSON.stringify(rows)
}

/** Called with the agent stopped. Copy/verify before removing cross-volume sources. */
export async function prepareAgentWorkspaces(record: AgentRecord): Promise<string[]> {
  const roots = [record.config.isolation.workspaceRoot, ...Object.values(record.config.isolation.peerWorkspaces)]
  for (const privatePath of [hostHome(), dshHome()]) await assertPrivateDirectory(privatePath, roots)
  const sourceRoot = await realpath(record.config.isolation.workspaceRoot)
  const privateRoot = agentWorkspacesPath(record.id)
  await mkdir(privateRoot, { recursive: true, mode: 0o700 })
  const destinationRoot = await realpath(privateRoot)
  if (within(sourceRoot, destinationRoot) || within(destinationRoot, sourceRoot) || sourceRoot === destinationRoot) throw new Error('私有工作区必须位于公共资料目录之外')
  const moved: string[] = []
  for (const peer of record.config.peers) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(peer.name) || peer.name === 'owner') throw new Error('Invalid visitor name')
    const source = join(sourceRoot, peer.name), destination = join(destinationRoot, peer.name)
    let exists = true
    try { await lstat(source) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') exists = false; else throw e }
    if (exists) {
      const sourceStat = await lstat(source)
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`旧访客路径不是普通目录，停止迁移：${source}`)
      try { await lstat(destination); throw new Error(`新旧访客目录同时存在，不自动覆盖：${peer.name}`) }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
      const before = await inventory(source)
      const staging = join(destinationRoot, `.migrate-${peer.name}-${randomUUID()}`)
      await cp(source, staging, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
      if (await inventory(staging) !== before || await inventory(source) !== before) throw new Error('迁移期间文件发生变化；原文件保留，请检查私有目录中的迁移副本')
      await rename(staging, destination)
      if (!within(sourceRoot, await realpath(source)) || !within(destinationRoot, await realpath(destination))) throw new Error('Unsafe migration path')
      await writeFile(join(destinationRoot, `.migration-${peer.name}.json`), JSON.stringify({ source, destination, verifiedAt: new Date().toISOString() }), { mode: 0o600 })
      await rm(source, { recursive: true })
      moved.push(peer.name)
    } else {
      await mkdir(destination, { recursive: true, mode: 0o700 })
    }
    if (!within(destinationRoot, await realpath(destination)) || (await lstat(destination)).isSymbolicLink()) throw new Error('Private visitor directory escaped its parent')
  }
  return moved
}
