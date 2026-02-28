import { env } from '../lib/env'

export function parseRepoUrl(repoUrl: string) {
    const parts = new URL(repoUrl).pathname.split('/').filter(Boolean)
    
    if (parts.length < 2) throw new Error('Invalid GitHub repo URL')
    return { owner: parts[0], repo: parts[1] }
}

export async function getRepoMeta(owner: string, repo: string) {
    const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
            headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
        }
    )
    if (!res.ok) {
        throw new Error('GitHub Request Failed')
    }

    const data = await res.json()
    return {
        sizeKb: data.size,
    }
}

export async function getLanguages(owner: string, repo: string) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/languages`, {
        headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        },
    })
    if (!res.ok) {
        throw new Error(`GitHub Languages Request Failed: ${res.status} ${res.statusText}`)
    }

    return (await res.json()) as Record<string, number>
}
