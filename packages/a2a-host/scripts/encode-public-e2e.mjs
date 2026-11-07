/** Encode the actual timestamped browse frames. Requires ffmpeg on PATH. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
const out = resolve(process.env.A2A_REAL_REPORT || 'qa-artifacts/public-access-e2e')
const walk = JSON.parse(await readFile(join(out, 'walkthrough.json'), 'utf8'))
if (!walk.frames) throw new Error('No frames recorded')
const stamp = n => { const ms = Math.round(n * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}` }
await writeFile(join(out, 'chapters.srt'), walk.chapters.map((chapter, i) => `${i + 1}\n${stamp(chapter.time)} --> ${stamp(walk.chapters[i + 1]?.time ?? walk.duration)}\n${chapter.title}\n`).join('\n'))
await promisify(execFile)('ffmpeg', ['-y', '-v', 'warning', '-safe', '0', '-f', 'concat', '-i', 'frames.ffconcat',
  '-i', 'chapters.srt', '-map', '0:v:0', '-map', '1:s:0', '-vf',
  'scale=1280:960:force_original_aspect_ratio=decrease,pad=1280:960:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=15',
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:s', 'mov_text',
  '-metadata:s:s:0', 'language=zho', '-movflags', '+faststart', 'public-visitors-e2e.mp4'],
{ cwd: out, windowsHide: true, maxBuffer: 2_000_000 })
console.log(join(out, 'public-visitors-e2e.mp4'))
if (!walk.failure && walk.chapters.length === 9) {
  // A separate clearly labelled edit removes waits; the continuous recording remains intact.
  const tails = [Infinity, 5, 8, 8, 12, 10, 14, 18, Infinity]
  const clips = walk.chapters.map((chapter, i) => {
    const end = walk.chapters[i + 1]?.time ?? walk.duration
    return { title: chapter.title, start: Math.max(chapter.time, end - tails[i]), end }
  })
  const filters = clips.map((clip, i) => `[0:v]trim=start=${clip.start}:end=${clip.end},setpts=PTS-STARTPTS[v${i}]`)
  filters.push(clips.map((_, i) => `[v${i}]`).join('') + `concat=n=${clips.length}:v=1:a=0[out]`)
  await promisify(execFile)('ffmpeg', ['-y', '-v', 'warning', '-i', 'public-visitors-e2e.mp4',
    '-filter_complex', filters.join(';'), '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast',
    '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'public-visitors-highlights.mp4'],
  { cwd: out, windowsHide: true, maxBuffer: 2_000_000 })
  await writeFile(join(out, 'highlights.json'), JSON.stringify({ edit: '仅剪去等待和环境准备，未加速；完整录屏另存 public-visitors-e2e.mp4', clips }, null, 2))
  console.log(join(out, 'public-visitors-highlights.mp4'))
}
