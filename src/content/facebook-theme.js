// Read the page's actual background: Facebook's theme can differ from the OS.
function colorParts(value) {
  const match = value.match(/^rgba?\((.+)\)$/i) || value.match(/^color\(srgb\s+(.+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  const srgb = value.startsWith("color(");
  const rgb = parts.slice(0, 3).map((part) => parseFloat(part) * (part.endsWith("%") ? 2.55 : srgb ? 255 : 1));
  const alpha = parts[3] === undefined ? 1 : parseFloat(parts[3]) / (parts[3].endsWith("%") ? 100 : 1);
  return rgb.length === 3 && [...rgb, alpha].every(Number.isFinite) ? { rgb, alpha: Math.max(0, Math.min(1, alpha)) } : null;
}

export function detectFacebookTheme(post) {
  const rgb = [0, 0, 0];
  let remaining = 1;
  // Start outside the post so a colored post background doesn't change the UI theme.
  for (let node = post.parentElement; node; node = node.parentElement) {
    const color = colorParts(getComputedStyle(node).backgroundColor);
    if (!color) continue;
    for (let i = 0; i < 3; i++) rgb[i] += color.rgb[i] * color.alpha * remaining;
    remaining *= 1 - color.alpha;
    if (remaining < 0.01) break;
  }
  if (remaining > 0) {
    const scheme = getComputedStyle(document.documentElement).colorScheme.trim();
    const dark = scheme === "dark" || (scheme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    for (let i = 0; i < 3; i++) rgb[i] += (dark ? 24 : 255) * remaining;
  }
  return (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) < 140 ? "dark" : "light";
}

export function applyFacebookTheme(notice, post) {
  const theme = detectFacebookTheme(post);
  if (notice.getAttribute("data-phishguard-theme") !== theme) notice.setAttribute("data-phishguard-theme", theme);
}

export function watchFacebookTheme(getRecords) {
  let frame = 0;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const record of getRecords()) {
        if (record.notice?.isConnected && record.post.isConnected) applyFacebookTheme(record.notice, record.post);
      }
    });
  }
  const observer = new MutationObserver((mutations) => {
    // Observe only ancestors of posts, not the filter styles we add to posts.
    const records = [...getRecords()];
    if (mutations.some(({ target }) => records.some(({ post }) => target !== post && target.contains(post)))) schedule();
  });
  observer.observe(document, { subtree: true, attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-scheme", "data-mode"] });
  const preference = matchMedia("(prefers-color-scheme: dark)");
  preference.addEventListener("change", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("load", schedule, true);
  return () => {
    observer.disconnect(); cancelAnimationFrame(frame);
    preference.removeEventListener("change", schedule);
    window.removeEventListener("pageshow", schedule);
    document.removeEventListener("load", schedule, true);
  };
}
