// Facebook changes wrappers between accounts. Prefer semantic story markers, then
// bounded card structure; never use the whole main/feed as a post.
export const MESSAGE_SELECTOR = '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"]';
export const POST_SELECTOR = '[data-pagelet^="FeedUnit"], [data-ad-rendering-role="story"], [role="article"], [aria-posinset]';
export const EXCLUDED_SELECTOR = '[role="dialog"], [role="log"], [contenteditable="true"], textarea, input, form, [data-pagelet*="Chat"], [data-pagelet*="Messenger"], [data-testid*="comment" i], [aria-label^="Comment" i], [aria-label^="Bình luận"], [data-phishguard-notice]';
const PERMALINK_SELECTOR = 'a[href*="/posts/"], a[href*="story_fbid="], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/photo/?fbid="], a[href*="/photo.php?fbid="]';
const ACTION_SELECTOR = '[role="button"], button';
const SCOPE_SELECTOR = '[role="main"], main, [role="feed"]';
const MAX_TEXT_LENGTH = 6000;

function query(root, selector) {
  const list = [...root.querySelectorAll(selector)];
  if (root.nodeType === 1 && root.matches(selector)) list.unshift(root);
  return list;
}

function excluded(node) {
  return Boolean(node.closest(EXCLUDED_SELECTOR));
}

function isBounded(post) {
  return post?.nodeType === 1 && !excluded(post)
    && !post.matches('html, body, main, [role="main"], [role="feed"], [role="navigation"], [role="complementary"]')
    && !post.querySelector('[role="feed"], [role="main"], main');
}

function topMessageNodes(post) {
  const messages = query(post, MESSAGE_SELECTOR).filter((node) => !excluded(node));
  return messages.filter((node) => !messages.some((other) => other !== node && other.contains(node)));
}

function hasCardControls(post, message) {
  return [...post.querySelectorAll(ACTION_SELECTOR)].some((control) => {
    if (control.closest('[role="dialog"], [role="log"], form, [data-pagelet*="Chat"]') || message?.contains(control)) return false;
    // A header's overflow/follow button alone does not identify a complete post.
    const label = `${control.getAttribute("aria-label") || ""} ${control.textContent || ""}`;
    return /(?:\blike\b|\bcomment\b|\bshare\b|thích|bình luận|chia sẻ)/iu.test(label);
  });
}

function isIndependentCard(post) {
  if (!isBounded(post)) return false;
  const units = [...post.querySelectorAll('[data-pagelet^="FeedUnit"], [data-ad-rendering-role="story"]')]
    .filter((node) => !excluded(node));
  // Two sibling stories mean we have climbed into a list wrapper.
  return !units.some((node, index) => units.slice(index + 1).some((other) => !node.contains(other) && !other.contains(node)));
}

function cardForMessage(message) {
  if (excluded(message)) return null;
  const semantic = message.closest(POST_SELECTOR);
  if (isIndependentCard(semantic)) return semantic;
  let ancestor = message.parentElement;
  for (let depth = 0; ancestor && depth < 10; depth++, ancestor = ancestor.parentElement) {
    if (ancestor.matches(SCOPE_SELECTOR) || !isBounded(ancestor)) break;
    if (!isIndependentCard(ancestor)) break;
    if (ancestor.querySelector(PERMALINK_SELECTOR) && hasCardControls(ancestor, message)) return ancestor;
    // Feed children are stable units on layouts without role=article.
    if (ancestor.parentElement?.matches('[role="feed"]') && topMessageNodes(ancestor).length === 1) return ancestor;
  }
  return null;
}

function collectText(node, fallback = false, post = node) {
  const document = node.ownerDocument;
  const filter = document.defaultView.NodeFilter;
  const walker = document.createTreeWalker(node, filter.SHOW_TEXT, {
    acceptNode(text) {
      const parent = text.parentElement;
      if (!parent || excluded(parent) || parent.closest('button, [role="button"], script, style, time, abbr, [hidden], [aria-hidden="true"]')) return filter.FILTER_REJECT;
      const nestedArticle = parent.closest('[role="article"]');
      if (fallback && nestedArticle && nestedArticle !== post && post.contains(nestedArticle)
        && !nestedArticle.querySelector(MESSAGE_SELECTOR)) return filter.FILTER_REJECT;
      if (fallback && parent.closest('h1, h2, h3, h4, h5, h6, [role="heading"], nav')) return filter.FILTER_REJECT;
      if (fallback && parent.closest(PERMALINK_SELECTOR)) return filter.FILTER_REJECT;
      return filter.FILTER_ACCEPT;
    },
  });
  const chunks = [];
  let count = 0;
  while (walker.nextNode() && count < MAX_TEXT_LENGTH) {
    const text = walker.currentNode.textContent;
    chunks.push(text); count += text.length;
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

export function readFacebookPost(post) {
  if (!isBounded(post)) return '';
  // Read text nodes of the actual post container directly. Story markers help
  // find the card, but are not required to read its text or link-preview copy.
  return collectText(post, true, post);
}

export function discoverFacebookPosts(root = document) {
  const candidates = new Set();
  for (const node of query(root, POST_SELECTOR)) {
    if (!isIndependentCard(node)) continue;
    const explicit = node.matches('[data-pagelet^="FeedUnit"], [data-ad-rendering-role="story"]');
    const scoped = node.closest(SCOPE_SELECTOR);
    if (!explicit && !scoped) continue;
    // A role=article inside a story is commonly a comment. Its text is never
    // independently read unless it has an actual story-message marker.
    const parentPost = node.parentElement?.closest(POST_SELECTOR);
    if (parentPost && !node.matches('[data-pagelet^="FeedUnit"], [data-ad-rendering-role="story"]')
      && !node.querySelector(MESSAGE_SELECTOR)) continue;
    if (node.hasAttribute('aria-posinset') && !node.closest('[role="feed"]') && !explicit && !node.matches('[role="article"]')) continue;
    candidates.add(node);
  }
  for (const message of query(root, MESSAGE_SELECTOR)) {
    const post = cardForMessage(message);
    if (post) candidates.add(post);
  }
  for (const feed of query(root, '[role="feed"]')) {
    for (const child of feed.children) {
      if (!isIndependentCard(child) || child.matches('[role="status"], [role="progressbar"]')) continue;
      const messages = topMessageNodes(child);
      if (messages.length === 1 || (child.querySelector(PERMALINK_SELECTOR) && hasCardControls(child)
        && !child.querySelector(POST_SELECTOR))) candidates.add(child);
    }
  }
  // Some variants have no feed/article attributes at all. A permalink plus a
  // separate action row and a content block provides a bounded structural card.
  for (const link of query(root, PERMALINK_SELECTOR)) {
    if (excluded(link) || !link.closest(SCOPE_SELECTOR)) continue;
    let node = link.parentElement;
    for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
      if (!isBounded(node) || !isIndependentCard(node)) break;
      if (node.querySelector('div[dir="auto"], p, [data-ad-comet-preview]') && hasCardControls(node)) {
        const messages = topMessageNodes(node);
        if (messages.length <= 1) candidates.add(node);
        break;
      }
    }
  }
  const items = [...candidates];
  // Select an enclosing single card once, keeping shared quoted stories together.
  return items.filter((post) => !items.some((other) => other !== post && other.contains(post)))
    .map((post) => ({ post, text: readFacebookPost(post) }));
}

export function getExtractionDiagnostics(root = document) {
  return { messageMarkers: query(root, MESSAGE_SELECTOR).filter((node) => !excluded(node)).length,
    postMarkers: query(root, POST_SELECTOR).filter((node) => !excluded(node)).length };
}
