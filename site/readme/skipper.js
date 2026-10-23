// The skipper, exactly as the report draws it: the renderer (site/readme.mjs) copies its markup out of src/ui/index.html
// into window.SKIPPER before the page loads, so a change to the mochi captain reaches the README's pictures too.
for (const el of document.querySelectorAll('svg.skipper')) el.innerHTML = (window.SKIPPER || '').replace(/^<svg[^>]*>|<\/svg>$/g, '');
