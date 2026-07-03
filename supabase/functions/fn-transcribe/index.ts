import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return err('Method not allowed', 405)

  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (!groqKey) return err('GROQ_API_KEY not configured', 500)
  const openai = new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: groqKey })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return err('Unauthorized', 401)

  let formData: FormData
  try {
    formData = await req.formData()
  } catch (e) {
    return err('Invalid form data')
  }

  const audio = formData.get('audio') as File | null
  if (!audio) return err('Missing audio')

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'whisper-large-v3-turbo',
      response_format: 'json',
    })
    return new Response(JSON.stringify({ text: transcription.text }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('Whisper error:', e?.message ?? e)
    return err(`Transcription failed: ${e?.message ?? 'unknown'}`, 500)
  }
})
