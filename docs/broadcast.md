# The 24/7 broadcast

The circus streams live on the coin's pump.fun page, so the token page itself is the show.

## What viewers see

`https://<site>/live` is the stage in broadcast mode: no buttons, big round information, the shared chat scrolling on the right (site and pump.fun messages), and a bar with the prize, the tickets and the address of the site.

## Setup (once)

1. Install **OBS Studio** (free) on the PC that runs the show.
2. Add a **Browser** source: URL `https://<site>/live`, width 1920, height 1080, *Control audio via OBS* on.
3. Settings → Video: base and output resolution 1920×1080, 30 fps.
4. Start the **OBS Virtual Camera** (or use OBS's screen output), then open the coin page on pump.fun with the launch wallet and start a livestream, picking the OBS camera as the video source.

## Running it

- Leave OBS and the livestream open: the page updates itself, round after round.
- The Ringmaster already talks in the pump.fun chat (winners, Mega Pops, milestones), so the stream and the chat tell the same story.
- If the stream drops, start it again from the coin page: the game itself never depends on the stream.
