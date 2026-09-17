import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export type Caller = { kind: 'service' } | { kind: 'user'; userId: string }

// Decode a JWT payload without verifying — safe here only because the functions
// gateway (verify_jwt: true) already rejected any token with a bad signature.
function jwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload?.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

// Who is calling a queue-style function (pg_cron with the service key, or a signed-in user)?
// The env SUPABASE_SERVICE_ROLE_KEY may be a different format (sb_secret_… vs legacy JWT)
// from what pg_cron sends, so string equality alone is not enough — also accept a
// gateway-verified JWT whose role claim is service_role.
export async function resolveCaller(req: Request, admin: SupabaseClient): Promise<Caller | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return { kind: 'service' }
  if (jwtRole(token) === 'service_role') return { kind: 'service' }
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) return null
  return { kind: 'user', userId: user.id }
}
