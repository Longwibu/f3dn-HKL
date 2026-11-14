export const PRELOAD_POST_LIMIT = 30;

function renderedRect(element) {
  if (!element?.isConnected || !element.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/** Select the current DOM post and the following 29 posts without moving the page. */
export function selectFacebookPostWindow(entries, records, viewportHeight = globalThis.innerHeight) {
  const seen = new Set();
  const orderedEntries = entries.filter(({ post }) => {
    if (seen.has(post)) return false;
    seen.add(post);
    return true;
  }).sort((a, b) => {
    const position = a.post.compareDocumentPosition(b.post);
    if (position & 1) return 0; // Disconnected nodes have no meaningful DOM order.
    return position & 4 ? -1 : position & 2 ? 1 : 0;
  });
  const readingLine = Math.min(200, Math.max(80, (viewportHeight || 0) * 0.25));
  const rendered = [];
  for (let index = 0; index < orderedEntries.length; index++) {
    const post = orderedEntries[index].post;
    // A collapsed post is represented by its explanation. A silently hidden
    // post has no visible reading position and must not pull the anchor upward.
    const rect = renderedRect(post) || renderedRect(records.get(post)?.notice);
    if (rect) rendered.push({ index, post, rect });
  }
  const current = rendered.find(({ rect }) => rect.top <= readingLine && rect.bottom > readingLine)
    || rendered.find(({ rect }) => rect.bottom > 0 && rect.top < viewportHeight)
    || rendered.find(({ rect }) => rect.top > readingLine)
    || rendered.at(-1);
  return {
    entries: orderedEntries,
    window: new Set(current ? orderedEntries.slice(current.index, current.index + PRELOAD_POST_LIMIT).map(({ post }) => post) : []),
    currentPost: current?.post ?? null,
  };
}
