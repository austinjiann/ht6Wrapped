import { Hono } from 'hono'
import { env } from './lib/env'
import { supabase } from './lib/supabase'
import { projectsRoute } from './routes/projects'
import { getRepoMeta, parseRepoUrl, getLanguages } from './services/github'

const app = new Hono()

app.get('/', (c) => {
  return c.text('api running')
})

const port = env.PORT

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

export default {
  port,
  fetch: app.fetch,
}

