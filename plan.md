# Hack the 6ix Wrapped — Implementation Plan

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [GitHub API Integration](#2-github-api-integration)
3. [Database Schema](#3-database-schema)
4. [Backend Implementation](#4-backend-implementation)
5. [Frontend Implementation](#5-frontend-implementation)
6. [Types & Interfaces](#6-types--interfaces)
7. [Step-by-Step Build Order](#7-step-by-step-build-order)

---

## 1. Architecture Overview

```
Frontend (Next.js :3000)          Backend (Hono :3001)           External
┌─────────────────────┐     ┌──────────────────────────┐    ┌──────────────┐
│  /                  │────▶│  GET  /projects          │    │  GitHub API  │
│  (dropdown + input) │     │  POST /wrapped           │───▶│  (REST v3)   │
│                     │     │  GET  /wrapped/:shareId  │    └──────────────┘
│  /wrapped/[shareId] │────▶│  POST /admin/projects    │    ┌──────────────┐
│  (results display)  │     │                          │───▶│  Supabase    │
└─────────────────────┘     └──────────────────────────┘    │  (Postgres)  │
                                                            └──────────────┘
```

**Runtime:** Bun
**Backend:** Hono + TypeScript
**Frontend:** Next.js 16 (App Router) + TailwindCSS
**Database:** Supabase (hosted Postgres)
**Timezone:** `America/Toronto` (EST/EDT)

---

## 2. GitHub API Integration

### Endpoints Used

| Purpose | Endpoint | Notes |
|---------|----------|-------|
| List commits in window | `GET /repos/{owner}/{repo}/commits?since=&until=&per_page=100` | Paginate via `Link` header. Returns commit metadata + timestamps. |
| Get commit stats | `GET /repos/{owner}/{repo}/commits/{sha}` | Returns `stats.additions`, `stats.deletions`. **One call per commit.** |
| Get language breakdown | `GET /repos/{owner}/{repo}/languages` | Returns `{ "TypeScript": 45000, "CSS": 12000, ... }` (bytes). Single call, no pagination. |

### Rate Limits

- **Authenticated:** 5,000 requests/hour (using a server-side `GITHUB_TOKEN`)
- The `List commits` endpoint returns max **100 per page**
- Getting per-commit stats requires **1 API call per commit** (N+1 pattern)

### Pagination Strategy

For `GET /repos/{owner}/{repo}/commits`:

1. Set `per_page=100`, `since` and `until` to the time window bounds
2. Parse the `Link` response header for `rel="next"`
3. Loop until no `next` link remains
4. Collect all commit SHAs + timestamps from the list response

### Handling the N+1 Problem (Commit Stats)

Getting `lines_added` / `lines_deleted` requires fetching each commit individually. Strategy:

- After listing all commits, batch-fetch individual commits using `Promise.all` with a **concurrency limiter** (e.g., 10 concurrent requests)
- For a 72-hour hackathon window, expect ~50–300 commits — well within rate limits
- Sum `stats.additions` and `stats.deletions` across all fetched commits

### Parsing `owner/repo` from URL

The `repo_url` stored in the database will be a full GitHub URL like `https://github.com/owner/repo`. Parse it:

```ts
function parseRepoUrl(url: string): { owner: string; repo: string } {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return { owner: parts[0], repo: parts[1] };
}
```

### Auth Header

All GitHub API requests include:

```
Authorization: Bearer <GITHUB_TOKEN>
X-GitHub-Api-Version: 2022-11-28
Accept: application/vnd.github+json
```

---

## 3. Database Schema

### Table: `projects`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `name` | `text` | NOT NULL |
| `repo_url` | `text` | UNIQUE, NOT NULL |
| `created_at` | `timestamptz` | default `now()` |

### Table: `wrapped_stats`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` — this IS the shareId |
| `project_id` | `uuid` | FK → `projects.id`, NOT NULL |
| `display_name` | `text` | NOT NULL |
| `window_start` | `timestamptz` | NOT NULL |
| `window_end` | `timestamptz` | NOT NULL |
| `total_commits` | `integer` | NOT NULL |
| `first_commit_at` | `timestamptz` | nullable (null if 0 commits) |
| `peak_commit_hour_est` | `integer` | 0–23, nullable |
| `commit_hour_histogram_est` | `jsonb` | Array of 24 integers `[c0, c1, ..., c23]` |
| `hours_without_commits` | `integer` | nullable |
| `lines_added` | `integer` | NOT NULL, default 0 |
| `lines_deleted` | `integer` | NOT NULL, default 0 |
| `languages_bytes` | `jsonb` | `{ "TypeScript": 45000, ... }` |
| `languages_share` | `jsonb` | `{ "TypeScript": 0.78, ... }` (percentages) |
| `created_at` | `timestamptz` | default `now()` |

### SQL Migration

```sql
-- Run in Supabase SQL editor

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repo_url text unique not null,
  created_at timestamptz default now()
);

create table wrapped_stats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  display_name text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  total_commits integer not null default 0,
  first_commit_at timestamptz,
  peak_commit_hour_est integer,
  commit_hour_histogram_est jsonb not null default '[]',
  hours_without_commits integer,
  lines_added integer not null default 0,
  lines_deleted integer not null default 0,
  languages_bytes jsonb not null default '{}',
  languages_share jsonb not null default '{}',
  created_at timestamptz default now()
);

create index idx_wrapped_stats_project on wrapped_stats(project_id);
```

---

## 4. Backend Implementation

### File Structure

```
backend/src/
├── index.ts                 # Hono app, route mounting, CORS
├── routes/
│   ├── projects.ts          # GET /projects, POST /admin/projects
│   └── wrapped.ts           # POST /wrapped, GET /wrapped/:shareId
├── services/
│   ├── github.ts            # GitHub API client (list commits, get commit, get languages)
│   └── analytics.ts         # Compute stats from raw commit data
├── lib/
│   ├── supabase.ts          # Supabase client init
│   └── env.ts               # Environment variable validation
└── types.ts                 # Shared TypeScript types
```

### Route Details

#### `GET /projects`

```
Response 200:
{
  "projects": [
    { "id": "uuid", "name": "Cool Project", "repo_url": "https://github.com/..." }
  ]
}
```

Query: `SELECT id, name, repo_url FROM projects ORDER BY name`

#### `POST /wrapped`

```
Request body:
{
  "projectId": "uuid",
  "displayName": "Team Alpha",
  "windowHours": 72          // optional, default 72
}

Response 200:
{
  "shareId": "uuid",
  "stats": { ... full stats object }
}
```

Flow:
1. Validate input (projectId exists, displayName non-empty)
2. Look up project → get `repo_url`
3. Parse owner/repo from URL
4. Compute `window_end = now()`, `window_start = now() - windowHours`
5. Fetch commits from GitHub (paginated list)
6. Fetch individual commit stats (concurrent, limited to 10 at a time)
7. Fetch languages
8. Compute analytics (histogram, peak hour, etc.)
9. Insert row into `wrapped_stats`
10. Return shareId + stats

#### `GET /wrapped/:shareId`

```
Response 200:
{
  "shareId": "uuid",
  "displayName": "Team Alpha",
  "project": { "name": "...", "repo_url": "..." },
  "stats": {
    "totalCommits": 142,
    "firstCommitAt": "2025-01-18T02:34:00Z",
    "peakCommitHourEst": 14,
    "commitHourHistogramEst": [0, 0, 3, 1, ...],  // 24 entries
    "hoursWithoutCommits": 8,
    "linesAdded": 4521,
    "linesDeleted": 1230,
    "languagesBytes": { "TypeScript": 45000, "CSS": 12000 },
    "languagesShare": { "TypeScript": 0.78, "CSS": 0.22 }
  }
}
```

Query: join `wrapped_stats` with `projects` on `project_id`.

#### `POST /admin/projects`

```
Request body:
{
  "name": "Project Name",
  "repoUrl": "https://github.com/owner/repo"
}
```

Protected by a simple shared secret in `Authorization` header (`Bearer <ADMIN_SECRET>`).

### Services

#### `github.ts`

```ts
// Core functions:

async function listCommits(owner, repo, since, until): Promise<CommitListItem[]>
// Paginates through GET /repos/{owner}/{repo}/commits
// Returns: sha, commit.author.date, commit.message

async function getCommitStats(owner, repo, sha): Promise<{ additions: number; deletions: number }>
// Fetches GET /repos/{owner}/{repo}/commits/{sha}
// Returns: stats.additions, stats.deletions

async function getLanguages(owner, repo): Promise<Record<string, number>>
// Fetches GET /repos/{owner}/{repo}/languages
// Returns: { "TypeScript": 45000, ... }

async function fetchAllCommitStats(owner, repo, shas: string[]): Promise<{ totalAdded: number; totalDeleted: number }>
// Calls getCommitStats for each SHA with concurrency limit of 10
// Sums additions/deletions
```

#### `analytics.ts`

```ts
function computeStats(commits: CommitListItem[], commitStats, languages, windowStart, windowEnd): WrappedStats
// 1. Total commits = commits.length
// 2. First commit = min(commit.author.date)
// 3. Convert each timestamp to America/Toronto timezone
// 4. Build histogram: array of 24 zeros, increment bucket for each commit's hour
// 5. Peak hour = index of max value in histogram
// 6. Hours without commits = count of zero-valued buckets within the window
//    (only count hours that fall within window_start..window_end)
// 7. Lines added/deleted from commitStats
// 8. Language share = each language's bytes / total bytes
```

**Hours without commits calculation:**
- Generate all hour-slots between `window_start` and `window_end` (in EST)
- Count how many of those slots have zero commits in the histogram
- This is bounded by the window, not a fixed 24 hours

### Environment Variables

```
GITHUB_TOKEN=ghp_...          # GitHub personal access token (read-only, public repos)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # Service role key (bypasses RLS)
ADMIN_SECRET=some-secret      # For POST /admin/projects
PORT=3001
```

### Dependencies to Install

```
bun add @supabase/supabase-js date-fns date-fns-tz
```

(`date-fns-tz` for timezone-aware hour extraction, lightweight alternative to Luxon)

---

## 5. Frontend Implementation

### File Structure

```
frontend/app/
├── layout.tsx               # Root layout (fonts, metadata)
├── page.tsx                 # Home page: dropdown + name input
├── wrapped/
│   └── [shareId]/
│       └── page.tsx         # Results display page
├── globals.css              # TailwindCSS styles
└── lib/
    └── api.ts               # Fetch helpers for backend
```

### Pages

#### `/` — Home Page

- Fetch `GET /projects` on mount (client-side or server component)
- Searchable dropdown for project selection
- Text input for display name
- Submit button → `POST /wrapped` → redirect to `/wrapped/{shareId}`

#### `/wrapped/[shareId]` — Results Page

- Fetch `GET /wrapped/:shareId` on load (server component)
- Display all stats in a "Wrapped"-style card layout
- Shareable URL (just copy the browser URL)

### API Base URL

Use `NEXT_PUBLIC_API_URL=http://localhost:3001` (env var).

---

## 6. Types & Interfaces

```ts
// backend/src/types.ts

interface Project {
  id: string;
  name: string;
  repoUrl: string;
}

interface CommitListItem {
  sha: string;
  authorDate: string;   // ISO 8601
  message: string;
}

interface WrappedStats {
  totalCommits: number;
  firstCommitAt: string | null;
  peakCommitHourEst: number | null;
  commitHourHistogramEst: number[];  // length 24
  hoursWithoutCommits: number;
  linesAdded: number;
  linesDeleted: number;
  languagesBytes: Record<string, number>;
  languagesShare: Record<string, number>;
}

interface WrappedResult {
  shareId: string;
  displayName: string;
  project: Project;
  stats: WrappedStats;
}

interface CreateWrappedRequest {
  projectId: string;
  displayName: string;
  windowHours?: number;
}
```

---

## 7. Step-by-Step Build Order

### Phase 1: Database + Backend Foundation

1. **Set up Supabase project** — create tables via SQL migration above
2. **Environment config** — create `.env` in backend with all required vars, add `env.ts` validation
3. **Supabase client** — `lib/supabase.ts` initializing `@supabase/supabase-js`
4. **Types** — `types.ts` with all shared interfaces

### Phase 2: GitHub Service

5. **GitHub client** — `services/github.ts`
   - `listCommits()` with pagination (follow `Link` header)
   - `getCommitStats()` for single commit
   - `fetchAllCommitStats()` with concurrency limiter
   - `getLanguages()`
6. **Test manually** — hit a real repo to verify data shape

### Phase 3: Analytics + Routes

7. **Analytics service** — `services/analytics.ts`
   - Timestamp conversion to `America/Toronto`
   - Histogram computation
   - Peak hour, hours without commits
   - Language share calculation
8. **Projects routes** — `routes/projects.ts`
   - `GET /projects` (list all)
   - `POST /admin/projects` (seed new ones, auth-protected)
9. **Wrapped routes** — `routes/wrapped.ts`
   - `POST /wrapped` (full pipeline: validate → fetch → compute → store → return)
   - `GET /wrapped/:shareId` (read from DB)
10. **Wire routes into `index.ts`** — mount route groups, add CORS middleware

### Phase 4: Frontend

11. **API helpers** — `lib/api.ts` with typed fetch wrappers
12. **Home page** — project dropdown + display name input + submit
13. **Results page** — `/wrapped/[shareId]` displaying all stats
14. **Styling** — TailwindCSS layout, responsive design

### Phase 5: Polish

15. **Error handling** — meaningful error responses from backend, error states in frontend
16. **Caching** — optional dedup check (skip recompute if same project was wrapped within 5 min)
17. **Seed data** — add a few real repos via admin endpoint for demo
