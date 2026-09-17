export function chunkText(text: string): string[] {
  // Fixed-size windows preserve sentence tails and bound even unbroken paragraphs.
  const chunks: string[] = []
  for (let start = 0; start < text.length; start += 1000) {
    chunks.push(text.slice(start, start + 1200))
    if (start + 1200 >= text.length) break
  }
  return chunks.length ? chunks : [text]
}

