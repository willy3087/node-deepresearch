export function extractThinkContent(content: string): string {
  const regex = /<think>([\s\S]*?)<\/think>/i;
  const match = content.match(regex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return content.trim();
} 