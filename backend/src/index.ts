import { Hono } from 'hono'
import { env } from './lib/env'
import { supabase } from './lib/supabase'
import { projectsRoute } from './routes/projects'
import { getRepoMeta, parseRepoUrl, getLanguages, getCodeFrequency, listCommits } from './services/github'

const app = new Hono()

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal Server Error', message: String(err) }, 500)
})

app.get('/', (c) => {
  return c.text('api running')
})

app.get('/ping', (c) => c.json({ ok: true }))


app.route('/projects', projectsRoute)

app.get('/github/meta', async (c) => {
  const repoUrl = c.req.query('repoUrl')

  if (!repoUrl) {
    return c.json({ error: 'Missing repoUrl' }, 400)
  }

  const { owner, repo } = parseRepoUrl(repoUrl)

  const meta = await getRepoMeta(owner, repo)

  return c.json({ owner, repo, meta })
})

app.get('/github/languages', async (c) => {
  const repoUrl = c.req.query('repoUrl')
  if (!repoUrl) {
    return c.json({ error: 'Missing repoUrl' }, 400)
  }
  const { owner, repo } = parseRepoUrl(repoUrl)
  const languages = await getLanguages(owner, repo)
  return c.json({ owner, repo, languages })
})

app.get('/github/commits', async (c) => {
  const repoUrl = c.req.query('repoUrl')
  const since = c.req.query('since')
  const until = c.req.query('until')
  if (!repoUrl || !since || !until) {
    return c.json({ error: 'Missing repoUrl, since, or until' }, 400)
  }

  try {
    const { owner, repo } = parseRepoUrl(repoUrl)
    const author = c.req.query('author')
    const commits = await listCommits(owner, repo, since, until, author || undefined)
    return c.json({ owner, repo, totalCommits: commits.length, commits })
  } catch (e) {
    console.error('commits error:', e)
    return c.json({ error: String(e) }, 500)
  }
})

app.get('/github/code-frequency', async (c) => {
  const repoUrl = c.req.query('repoUrl')
  if (!repoUrl) return c.json({ error: 'Missing repoUrl' }, 400)

  try {
    const { owner, repo } = parseRepoUrl(repoUrl)
    const totals = await getCodeFrequency(owner, repo)
    return c.json({ owner, repo, totals })
  } catch (e) {
    console.error('code-frequency error:', e)
    return c.json({ error: String(e) }, 500)
  }
})

export default {
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 120,
}
