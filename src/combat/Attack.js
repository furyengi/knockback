// One swing. Phases: windup -> active -> recovery -> done.
// `hit` is the set of target ids already struck by THIS swing, which is what
// guarantees a single attack can only ever hurt each target once.
let nextAttackId = 1;

export const PHASE = { WINDUP: 'windup', ACTIVE: 'active', RECOVERY: 'recovery', DONE: 'done' };

export class Attack {
  constructor(def, extra = {}) {
    this.id = nextAttackId++;
    this.def = def;
    this.kind = def.kind;
    this.phase = def.windup > 0 ? PHASE.WINDUP : PHASE.ACTIVE;
    this.phaseTime = 0;
    this.time = 0;
    this.hit = new Set();
    this.chainIndex = extra.chainIndex || 1;
    this.finisher = !!extra.finisher;
    this.side = extra.side || 1; // which hand
    this.interrupted = false;
  }

  get duration() {
    return this.def.windup + this.def.active + this.def.recovery;
  }

  get phaseLength() {
    switch (this.phase) {
      case PHASE.WINDUP:
        return this.def.windup;
      case PHASE.ACTIVE:
        return this.def.active;
      case PHASE.RECOVERY:
        return this.def.recovery;
      default:
        return 0;
    }
  }

  /** Normalised progress through the current phase, 0..1. */
  get progress() {
    const len = this.phaseLength;
    return len > 0 ? Math.min(1, this.phaseTime / len) : 1;
  }

  get done() {
    return this.phase === PHASE.DONE;
  }

  /** Advance by dt. Returns the phase we entered during this call, or null. */
  update(dt) {
    let entered = null;
    this.time += dt;
    this.phaseTime += dt;
    // A while-loop so a long frame can cross more than one boundary.
    for (let guard = 0; guard < 3; guard++) {
      const len = this.phaseLength;
      if (this.phase === PHASE.DONE || this.phaseTime < len) break;
      this.phaseTime -= len;
      this.phase =
        this.phase === PHASE.WINDUP ? PHASE.ACTIVE : this.phase === PHASE.ACTIVE ? PHASE.RECOVERY : PHASE.DONE;
      entered = this.phase;
    }
    return entered;
  }

  canHit(targetId) {
    return this.phase === PHASE.ACTIVE && !this.hit.has(targetId);
  }

  markHit(targetId) {
    this.hit.add(targetId);
  }
}
