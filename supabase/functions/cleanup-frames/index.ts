// Supabase Edge Function: cleanup-frames
//
// Deletes objects from the `livewatch-frames` bucket older than RETENTION_DAYS
// using the Storage API (so underlying S3 bytes are actually freed, unlike
// a raw DELETE against storage.objects).
//
// Deploy:
//   supabase functions deploy cleanup-frames
//
// Schedule:
//   Dashboard → Edge Functions → cleanup-frames → Schedules → `0 3 * * *`

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RETENTION_DAYS = 60
const BUCKET = 'livewatch-frames'
const PAGE_SIZE = 1000

interface CleanupResult {
  deleted: number
  scanned: number
  cutoff: string
}

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

async function listAllObjects(
  supabase: ReturnType<typeof createClient>,
  prefix = '',
): Promise<{ name: string; created_at: string | null }[]> {
  const all: { name: string; created_at: string | null }[] = []
  let offset = 0
  // Recursive listing: Supabase list() is non-recursive, so we walk folders.
  // For simplicity we rely on the known path pattern `frames/{date}/{sessionId}/*.jpg`
  // and list one level at a time.
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw error
    if (!data || data.length === 0) break
    for (const entry of data) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name
      // If it's a folder (no id) recurse; files have an id.
      if ((entry as any).id == null) {
        const nested = await listAllObjects(supabase, entryPath)
        all.push(...nested)
      } else {
        all.push({
          name: entryPath,
          created_at: (entry as any).created_at ?? null,
        })
      }
    }
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return all
}

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    })

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const objects = await listAllObjects(supabase)
    const toDelete = objects
      .filter((o) => o.created_at !== null && new Date(o.created_at) < cutoff)
      .map((o) => o.name)

    let deleted = 0
    // Batch deletes to avoid oversized requests.
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100)
      const { error } = await supabase.storage.from(BUCKET).remove(batch)
      if (error) {
        console.error('remove error', error)
        continue
      }
      deleted += batch.length
    }

    const result: CleanupResult = {
      deleted,
      scanned: objects.length,
      cutoff: cutoff.toISOString(),
    }
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
