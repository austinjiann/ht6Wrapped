import { env } from '../lib/env'

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
}

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

export interface CommitListItem {
    sha: string
    authorDate: string
    authorName: string
    authorEmail: string
    message: string
}

export async function listCommits(
    owner: string,
    repo: string,
    since: string,
    until: string,
    author?: string,
): Promise<CommitListItem[]> {
    const commits: CommitListItem[] = []
    let page = 1

    while (true) {
        const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`)
        url.searchParams.set('since', since)
        url.searchParams.set('until', until)
        url.searchParams.set('per_page', '100')
        url.searchParams.set('page', String(page))
        if (author) url.searchParams.set('author', author)

        const res = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        })

        if (!res.ok) {
            throw new Error(`GitHub listCommits failed: ${res.status} ${res.statusText}`)
        }

        const data = (await res.json()) as any[]

        if (data.length === 0) break

        for (const item of data) {
            commits.push({
                sha: item.sha,
                authorDate: item.commit.author.date,
                authorName: item.commit.author.name,
                authorEmail: item.commit.author.email,
                message: item.commit.message,
            })
        }

        if (data.length < 100) break
        page++
    }

    return commits
}

export async function getCodeFrequency(owner: string, repo: string) {
    const url = `https://api.github.com/repos/${owner}/${repo}/stats/code_frequency`
  
    for (let attempt = 0; attempt < 15; attempt++) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })

      if (res.status === 202) {
        await res.text()          // drain the body so the connection is released
        await sleep(5000)
        continue
      }
  
      if (!res.ok) {
        throw new Error(`GitHub code_frequency failed: ${res.status}`)
      }
  
      const weeks = (await res.json()) as [number, number, number][]
      let additions = 0
      let deletions = 0
  
      for (const [, add, del] of weeks) {
        additions += add
        deletions += Math.abs(del) 
      }
  
      return { additions, deletions }
    }
  
    throw new Error('GitHub code_frequency still 202 after retries')
  }
