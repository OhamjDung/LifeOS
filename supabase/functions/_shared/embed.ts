// Jina embeddings (1024-d, matches note_chunks.embedding) + cosine similarity.
// Shared by fn-process-braindump (task dedup) and fn-chat (dedup + note search).

export async function jinaEmbed(inputs: string[], task: 'retrieval.passage' | 'retrieval.query' = 'retrieval.passage'): Promise<number[][]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('JINA_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'jina-embeddings-v3', input: inputs, task, dimensions: 1024 }),
  })
  const json = await res.json()
  if (!res.ok || !json.data) {
    throw new Error(`Jina embeddings failed (${res.status}): ${JSON.stringify(json)}`)
  }
  return json.data.map((d: { embedding: number[] }) => d.embedding)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0)
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0))
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0))
  return dot / (magA * magB)
}
