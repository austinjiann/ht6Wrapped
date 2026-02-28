import { z } from 'zod'

const EnvSchema = z.object({
    PORT: z.coerce.number().default(3001),
    GITHUB_TOKEN: z.string(),
    SUPABASE_URL: z.string(),
    SUPABASE_SERVICE_KEY: z.string(),
    ADMIN_SECRET: z.string(),
})

export const env = EnvSchema.parse(process.env)