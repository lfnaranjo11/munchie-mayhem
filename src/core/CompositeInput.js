/**
 * CompositeInput.js - merges several input sources behind the single
 * `getDirection(slot)` / `isReadyPressed(slot)` interface.
 *
 * Why bother instead of just picking one: hybrid devices are common and
 * annoying to detect perfectly (touchscreen laptops, tablets with
 * keyboards attached mid-session, a phone plugged into a Bluetooth
 * keyboard). Rather than trying to guess exactly right and locking the
 * player out of the input they actually have in their hands, we listen to
 * both and take whichever is currently being used. deviceProfile.js still
 * decides the *layout* questions (how many local players, whether to show
 * the joystick overlay); this only decides "who's actually pressing
 * something right now."
 *
 * Precedence: the first source reporting meaningful movement wins for
 * that frame. Sources are checked in the order given, so pass the
 * device's primary input first.
 */
export class CompositeInput {
  /** @param {Array<{getDirection: Function, isReadyPressed: Function}>} sources */
  constructor(sources) {
    this.sources = sources.filter(Boolean);
  }

  getDirection(slot) {
    for (const source of this.sources) {
      const dir = source.getDirection(slot);
      // Any non-trivial deflection means this source is the one in use.
      if (Math.hypot(dir.x, dir.y) > 0.01) return dir;
    }
    return { x: 0, y: 0 };
  }

  isReadyPressed(slot) {
    // Deliberately NOT short-circuiting with .some(): TouchInputManager's
    // isReadyPressed is a one-shot that resets its flag when read, so
    // every source must be polled each call or a pending tap could be
    // left stuck unconsumed.
    let pressed = false;
    for (const source of this.sources) {
      if (source.isReadyPressed(slot)) pressed = true;
    }
    return pressed;
  }
}
