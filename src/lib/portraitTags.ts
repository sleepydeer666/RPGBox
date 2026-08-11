export function parsePortraitTags(value: string): string[] {
  return Array.from(new Set(value
    .split(/[、,，;；\n]+/u)
    .map((tag) => tag.trim())
    .filter(Boolean)))
}

export function formatPortraitTags(tags: string[]): string {
  return tags.join('，')
}
