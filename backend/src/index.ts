import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.post('/api/echo-body', async (c) => {
  const body = await c.req.json()
  return c.json(body)
})

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001

export default {
  port,
  fetch: app.fetch,
}
