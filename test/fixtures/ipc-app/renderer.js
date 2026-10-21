// INERT TEST FIXTURE. Never run.
document.querySelector('a').addEventListener('click', e => { e.preventDefault(); window.notes.openLink(e.target.href); });
window.notes.read('today.md').then(t => { document.querySelector('pre').textContent = t; });
