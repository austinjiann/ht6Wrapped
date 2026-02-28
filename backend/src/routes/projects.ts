import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { env } from '../lib/env'
import { z } from 'zod'

export const projectsRoute = new Hono()

projectsRoute.get('/', async (c) => {
    const { data, error } = await supabase
        .from('projects')
        .select('id, name, repo_url')
        .order('name', { ascending: true })

    if (error) return c.json({ error: error.message }, 500)
    return c.json({ projects: data ?? [] })
})

const CreateProjectSchema = z.object({
    name: z.string().min(1),
    repoUrl: z.string().url(),
})

projectsRoute.post('/admin', async (c) => {
    const auth = c.req.header('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (token !== env.ADMIN_SECRET) return c.json({ error: 'Unauthorized' }, 401)
  
    const body = CreateProjectSchema.parse(await c.req.json())
  
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: body.name, repo_url: body.repoUrl })
      .select('id, name, repo_url')
      .single()
  
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ project: data }, 201)
})
