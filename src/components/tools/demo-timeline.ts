// Visible playback time; hidden tabs and offscreen demos pause the clock.
export const DEMO_INVITATION_START = 33_000;
export const DEMO_INVITATION_DURATION = 15_000;
export const DEMO_DURATION = DEMO_INVITATION_START + DEMO_INVITATION_DURATION;

export function getDemoStage(time: number) {
  const ms = time % DEMO_DURATION;
  return ms < 3500 ? 'intro'
    : ms < 10500 ? 'prompt'
    : ms < 18500 ? 'building'
    : ms < 21500 ? 'ready'
    : ms < DEMO_INVITATION_START ? 'app'
    : 'cta';
}
