export function labelColor(label: string, alpha = 0.38): string {
  let hash = 0;
  for (const character of label) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsla(${hue}, 78%, 52%, ${alpha})`;
}
