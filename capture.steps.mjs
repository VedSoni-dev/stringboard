// Drives the real first run for tools/capture.mjs (README media, reel B-roll). Reel shots: the Enron board builds
// itself; a dossier opens; the board answers a question with the path lit; the timeline replays.
// Run against a production server (no dev badge), with a local model or a Claude key active:
//   node tools/capture.mjs http://localhost:4518 --steps apps/stringboard/capture.steps.mjs --out apps/stringboard/docs/media --video
export default async function ({ page, go, click, type, wait, shot }) {
  // 1. The sample board builds itself (no AI: the extraction ships with the sample).
  await go("/app?sample");
  await wait(9500);
  await shot("screen-1");

  // 2. Find a name, open the dossier.
  await type('input[aria-label="Ask the board a question"]', "fastow", { delay: 60 });
  await wait(500);
  await click("text=open dossier");
  await wait(1800);
  await shot("screen-2");

  // 3. Ask the board. The answer streams in and lights its path.
  await page.keyboard.press("Escape");
  await wait(600);
  await click('button:has-text("Who warned Ken Lay, and when?")');
  await page.locator('button:has-text("Stop")').waitFor({ state: "detached", timeout: 180000 }).catch(() => {});
  await wait(2500);
  await shot("screen-3");

  // 4. Replay the board through time.
  await page.keyboard.press("Escape");
  await wait(600);
  await click('button[aria-label="Replay the board through time"]');
  await wait(3600);
  await shot("screen-4");
  await wait(4200);

  // The landing, last: its hero is the same board building itself.
  await go("/");
  await wait(9000);
  await shot("cover", { cover: true });
  await shot("screen-5");
}
