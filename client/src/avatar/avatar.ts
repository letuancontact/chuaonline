import { Euler, MathUtils, Quaternion, Sphere, Vector3, type SkinnedMesh } from "three";
import { MOVE_SPEED, type Pose } from "@santinh/shared";
import type { MonkModel } from "./monk-model.ts";
import {
  HELLO_SECONDS,
  POSES,
  STRIDE_LENGTH,
  createBoneRotations,
  type BoneRotations,
  type PoseContext,
} from "./poses.ts";
import { BONE_NAMES, JOINT } from "./rig.ts";

export type GestureKind = "bowGreet" | "kinhHanh" | "gardenSit" | "blessing";

export const BLEND_SECONDS = 0.25;
/** Nodding off / waking up is slower than a pose change. */
export const SLEEP_BLEND_SECONDS = 1.2;
/** Duration of one rhythmic mallet strike onto the woodblock (seconds). */
const TAP_DURATION = 0.24;
/** Seconds the novice keeps holding the woodblock & mallet raised after the last tap. */
const WOODBLOCK_HOLD_SECONDS = 1.45;
/** Speed at which the arms raise/lower into the woodblock-holding posture. */
const HOLD_DAMP = 15;
/** Speed at which custom gestures blend in and out. */
const GESTURE_DAMP = 10;
/** Duration of the timed "Xá chào" bow greeting (seconds). */
const BOW_GREET_SECONDS = 2.4;
/** Duration of the timed "Chúc phúc" blessing gesture (seconds). */
const BLESSING_SECONDS = 2.6;
/** How fast the shown stride follows setMoving (1/s, for MathUtils.damp). */
const STRIDE_DAMP = 10;
/** Below this the cadence would look like slow motion; the stride shrinks instead. */
const MIN_CADENCE = 1.2;
/**
 * Covers every pose (standing head top, forehead + palms on the floor ahead when bowing).
 * The geometry's bind-pose sphere (r 0.6) misses the bowed head, so the avatar was culled at screen edges.
 */
const POSED_BOUNDS = new Sphere(new Vector3(0, 0.5, 0.15), 0.8);

const tmpEuler = new Euler();
const tmpQuat = new Quaternion();

function setQuatEuler(x: number, y: number, z: number): Quaternion {
  return tmpQuat.setFromEuler(tmpEuler.set(x, y, z, "XYZ"));
}

export interface SetPoseOptions {
  /** Server ms the bow cycle started (kneel). Missing → the next update's `now`. */
  bowAt?: number;
}

/**
 * One novice on screen: drives the rig from the current procedural pose and
 * slerps from whatever was shown when the pose changes.
 */
export class Avatar {
  readonly model: MonkModel;
  private current: Pose = "walk";
  /** Where `hello` goes back to after HELLO_SECONDS. */
  private returnTo: Pose = "walk";
  private bowAt = 0;
  private bowAtPending = true;
  private t: number;
  private elapsed = 0;
  private targetSpeed = 0;
  /** Shown speed, eased towards targetSpeed. */
  private speed = 0;
  private walkPhase = 0;
  private blend = BLEND_SECONDS;
  private blendSeconds = BLEND_SECONDS;
  private dozing = false;
  private tapTimer = 0;
  private woodblockHold = 0;
  private holdWeight = 0;
  private activeGesture: GestureKind | null = null;
  private shownGesture: GestureKind | null = null;
  private gestureElapsed = 0;
  private gestureWeight = 0;

  private readonly from = createBoneRotations();
  private readonly target = createBoneRotations();
  private readonly shown = createBoneRotations();
  private readonly fromRoot = new Vector3();
  private readonly targetRoot = new Vector3();
  private readonly shownRoot = new Vector3();
  private readonly ctx: PoseContext = { now: 0, bowAt: 0, elapsed: 0, stride: 0, walkPhase: 0, seated: false };

  /** `clockOffset` (s) de-syncs breathing between people; the bow stays synced through bowAt. */
  constructor(model: MonkModel, clockOffset = 0) {
    this.model = model;
    this.t = clockOffset;
    model.mesh.boundingSphere = POSED_BOUNDS.clone();
  }

  get object(): SkinnedMesh {
    return this.model.mesh;
  }

  get pose(): Pose {
    return this.current;
  }

  get gesture(): GestureKind | null {
    return this.activeGesture;
  }

  /** True while seated in the outdoor meditation posture (`gardenSit`). */
  get sitting(): boolean {
    return this.shownGesture === "gardenSit" && this.gestureWeight > 0.35;
  }

  /** Updates the novice's robe colour in place while keeping the active skeleton and pose. */
  setColor(robeColor: string): void {
    this.model.setColor(robeColor);
    this.model.mesh.boundingSphere = POSED_BOUNDS.clone();
  }

  /** Activates or clears one of the 4 mindfulness gestures from button [5]. */
  setGesture(kind: GestureKind | null): void {
    if (kind !== null) {
      this.shownGesture = kind;
      this.gestureElapsed = 0;
      if (kind !== "gardenSit") {
        this.woodblockHold = 0;
        this.tapTimer = 0;
      }
    }
    this.activeGesture = kind;
  }

  /** Raises the woodblock in the left hand and strikes it with the mallet in the right hand. */
  tap(): void {
    if (this.activeGesture !== null && this.activeGesture !== "gardenSit") {
      this.activeGesture = null;
    }
    this.tapTimer = TAP_DURATION;
    this.woodblockHold = WOODBLOCK_HOLD_SECONDS;
    if (this.holdWeight < 0.45) this.holdWeight = 0.45;
  }

  setPose(pose: Pose, opts: SetPoseOptions = {}): void {
    if (pose === "hello" || pose === "beads" || pose === "kneel") {
      this.woodblockHold = 0;
      this.tapTimer = 0;
      this.activeGesture = null;
    }
    const kneeling = this.current === "kneel" || (this.current === "hello" && this.returnTo === "kneel");
    const bowMoved = opts.bowAt !== undefined && opts.bowAt !== this.bowAt;
    if (opts.bowAt !== undefined) {
      this.bowAt = opts.bowAt;
      this.bowAtPending = false;
    } else if (pose === "kneel" && !kneeling) {
      this.bowAtPending = true;
    }
    if (pose === "hello" && this.current !== "hello") this.returnTo = this.current;
    if (pose === this.current && pose !== "hello") {
      // A new bowAt jumps to another phase of the bow: ease into it instead of snapping.
      if (pose === "kneel" && bowMoved) this.startBlend();
      return;
    }
    this.current = pose;
    this.elapsed = 0;
    this.startBlend();
  }

  get asleep(): boolean {
    return this.dozing;
  }

  /** D25: dozes in seiza over whatever pose is set (standing → sits down where it is); waking goes back to it. */
  setAsleep(asleep: boolean): void {
    if (asleep === this.dozing) return;
    this.dozing = asleep;
    if (asleep) {
      this.woodblockHold = 0;
      this.tapTimer = 0;
      this.activeGesture = null;
    }
    this.startBlend(SLEEP_BLEND_SECONDS);
  }

  /** Ground speed in m/s (0 = standing). Only shows in the walk pose. */
  setMoving(speed: number): void {
    this.targetSpeed = Math.max(0, speed);
    if (this.targetSpeed > 0.05) {
      this.woodblockHold = 0;
      if (this.activeGesture === "gardenSit" || this.activeGesture === "bowGreet") {
        this.activeGesture = null;
      }
    }
  }

  update(dt: number, now: number): void {
    this.t += dt;
    this.elapsed += dt;
    if (this.bowAtPending) {
      this.bowAt = now;
      this.bowAtPending = false;
    }
    if (this.current === "hello" && this.elapsed >= HELLO_SECONDS) {
      this.current = this.returnTo;
      this.elapsed = 0;
      this.startBlend();
    }

    this.speed = MathUtils.damp(this.speed, this.current === "walk" ? this.targetSpeed : 0, STRIDE_DAMP, dt);
    const amount = MathUtils.clamp(this.speed / MOVE_SPEED, 0, 1);
    const cadence = Math.max(MIN_CADENCE, this.speed / STRIDE_LENGTH);
    this.walkPhase = (this.walkPhase + dt * cadence * Math.PI * 2) % (Math.PI * 2);

    const ctx = this.ctx;
    ctx.now = now;
    ctx.bowAt = this.bowAt;
    ctx.elapsed = this.elapsed;
    ctx.stride = amount;
    ctx.walkPhase = this.walkPhase;
    ctx.seated = this.current === "hello" && (this.returnTo === "kneel" || this.returnTo === "beads");
    POSES[this.dozing ? "sleep" : this.current](this.t, this.target, this.targetRoot, ctx);

    if (this.blend < this.blendSeconds) {
      this.blend = Math.min(this.blendSeconds, this.blend + dt);
      const w = MathUtils.smoothstep(this.blend / this.blendSeconds, 0, 1);
      for (const name of BONE_NAMES) this.shown[name].slerpQuaternions(this.from[name], this.target[name], w);
      this.shownRoot.lerpVectors(this.fromRoot, this.targetRoot, w);
    } else {
      copyRotations(this.target, this.shown);
      this.shownRoot.copy(this.targetRoot);
    }

    const bones = this.model.rig.bones;
    for (const name of BONE_NAMES) bones[name].quaternion.copy(this.shown[name]);
    bones.hips.position.copy(JOINT.hips).add(this.shownRoot);

    // 1. Custom Gesture Layer (Động tác [5]: Xá chào, Kinh hành, Tọa thiền, Chúc phúc).
    if (this.activeGesture !== null) {
      this.gestureElapsed += dt;
      if (this.activeGesture === "bowGreet" && this.gestureElapsed >= BOW_GREET_SECONDS) {
        this.activeGesture = null;
      } else if (this.activeGesture === "blessing" && this.gestureElapsed >= BLESSING_SECONDS) {
        this.activeGesture = null;
      }
    }

    const wantGesture = this.activeGesture !== null && !this.dozing && this.current === "walk" ? 1 : 0;
    this.gestureWeight = MathUtils.damp(this.gestureWeight, wantGesture, GESTURE_DAMP, dt);
    if (this.gestureWeight < 0.01 && wantGesture === 0) {
      this.gestureWeight = 0;
      this.shownGesture = null;
    }

    if (this.gestureWeight > 0 && this.shownGesture !== null) {
      const gw = this.gestureWeight;
      const breath = Math.sin(this.t * 2.0) * 0.015;

      if (this.shownGesture === "bowGreet") {
        const p = MathUtils.clamp(this.gestureElapsed / BOW_GREET_SECONDS, 0, 1);
        const bowCurve = Math.sin(p * Math.PI);
        bones.spine.quaternion.slerp(setQuatEuler(0.28 * bowCurve, 0, 0), gw);
        bones.chest.quaternion.slerp(setQuatEuler(0.38 * bowCurve, 0, 0), gw);
        bones.head.quaternion.slerp(setQuatEuler(0.24 * bowCurve, 0, 0), gw);
        bones.hips.position.z = MathUtils.lerp(bones.hips.position.z, -0.04 * bowCurve, gw);
        bones["upper_arm.L"].quaternion.slerp(setQuatEuler(-0.62, -0.24, -0.18), gw);
        bones["forearm.L"].quaternion.slerp(setQuatEuler(-1.28, 0.36, -0.52), gw);
        bones["hand.L"].quaternion.slerp(setQuatEuler(0.16, 0.1, -0.28), gw);
        bones["upper_arm.R"].quaternion.slerp(setQuatEuler(-0.62, 0.24, 0.18), gw);
        bones["forearm.R"].quaternion.slerp(setQuatEuler(-1.28, -0.36, 0.52), gw);
        bones["hand.R"].quaternion.slerp(setQuatEuler(0.16, -0.1, 0.28), gw);
      } else if (this.shownGesture === "kinhHanh") {
        // Walking meditation: serene upright torso and clasped hands even while walking.
        bones.spine.quaternion.slerp(setQuatEuler(0.03 + breath * 0.5, 0, 0), gw);
        bones.chest.quaternion.slerp(setQuatEuler(0.05 + breath, 0, 0), gw);
        bones.head.quaternion.slerp(setQuatEuler(0.12, 0, 0), gw);
        bones["upper_arm.L"].quaternion.slerp(setQuatEuler(-0.56, -0.22, -0.16), gw);
        bones["forearm.L"].quaternion.slerp(setQuatEuler(-1.24, 0.34, -0.48), gw);
        bones["hand.L"].quaternion.slerp(setQuatEuler(0.14, 0.08, -0.24), gw);
        bones["upper_arm.R"].quaternion.slerp(setQuatEuler(-0.56, 0.22, 0.16), gw);
        bones["forearm.R"].quaternion.slerp(setQuatEuler(-1.24, -0.34, 0.48), gw);
        bones["hand.R"].quaternion.slerp(setQuatEuler(0.14, -0.08, 0.24), gw);
      } else if (this.shownGesture === "gardenSit") {
        // Seated lotus/seiza meditation in place anywhere in the courtyard or garden.
        bones.hips.position.y = MathUtils.lerp(bones.hips.position.y, JOINT.hips.y - 0.25, gw);
        bones.hips.position.z = MathUtils.lerp(bones.hips.position.z, 0, gw);
        bones.spine.quaternion.slerp(setQuatEuler(0.02 + breath * 0.5, 0, 0), gw);
        bones.chest.quaternion.slerp(setQuatEuler(0.03 + breath, 0, 0), gw);
        bones.head.quaternion.slerp(setQuatEuler(0.1 + breath * 0.4, 0, 0), gw);
        bones["thigh.L"].quaternion.slerp(setQuatEuler(-1.32, 0.36, -0.14), gw);
        bones["shin.L"].quaternion.slerp(setQuatEuler(2.12, 0, 0), gw);
        bones["foot.L"].quaternion.slerp(setQuatEuler(0.52, 0, 0), gw);
        bones["thigh.R"].quaternion.slerp(setQuatEuler(-1.32, -0.36, 0.14), gw);
        bones["shin.R"].quaternion.slerp(setQuatEuler(2.12, 0, 0), gw);
        bones["foot.R"].quaternion.slerp(setQuatEuler(0.52, 0, 0), gw);
        // Dhyana mudra hands resting in lap (overridden if tapping the woodblock).
        bones["upper_arm.L"].quaternion.slerp(setQuatEuler(-0.26, -0.12, -0.12), gw);
        bones["forearm.L"].quaternion.slerp(setQuatEuler(-1.12, 0.28, -0.52), gw);
        bones["hand.L"].quaternion.slerp(setQuatEuler(0.24, 0, -0.34), gw);
        bones["upper_arm.R"].quaternion.slerp(setQuatEuler(-0.26, 0.12, 0.12), gw);
        bones["forearm.R"].quaternion.slerp(setQuatEuler(-1.12, -0.28, 0.52), gw);
        bones["hand.R"].quaternion.slerp(setQuatEuler(0.24, 0, 0.34), gw);
      } else if (this.shownGesture === "blessing") {
        const p = MathUtils.clamp(this.gestureElapsed / BLESSING_SECONDS, 0, 1);
        const wave = Math.sin(p * Math.PI * 2);
        bones.spine.quaternion.slerp(setQuatEuler(0.02 + breath * 0.5, 0, 0), gw);
        bones.chest.quaternion.slerp(setQuatEuler(0.04 + breath, wave * 0.05, 0), gw);
        bones.head.quaternion.slerp(setQuatEuler(0.08, wave * 0.08, 0), gw);
        bones["upper_arm.L"].quaternion.slerp(setQuatEuler(-0.54, -0.2, -0.16), gw);
        bones["forearm.L"].quaternion.slerp(setQuatEuler(-1.22, 0.32, -0.46), gw);
        bones["hand.L"].quaternion.slerp(setQuatEuler(0.12, 0.06, -0.22), gw);
        bones["upper_arm.R"].quaternion.slerp(setQuatEuler(-0.98, -0.14, 0.22), gw);
        bones["forearm.R"].quaternion.slerp(setQuatEuler(-1.06, 0.12, -0.1 + wave * 0.12), gw);
        bones["hand.R"].quaternion.slerp(setQuatEuler(-0.36 + wave * 0.14, 0, 0.14), gw);
      }
    }

    // 2. Woodblock holding & mallet striking layer.
    if (this.woodblockHold > 0) {
      this.woodblockHold = Math.max(0, this.woodblockHold - dt);
    }
    const wantHold = this.woodblockHold > 0 && !this.dozing && this.current !== "hello" && this.current !== "beads" && this.targetSpeed <= 0.05 ? 1 : 0;
    this.holdWeight = MathUtils.damp(this.holdWeight, wantHold, HOLD_DAMP, dt);
    if (this.holdWeight < 0.01 && wantHold === 0) {
      this.holdWeight = 0;
    }

    this.model.setWoodblockVisible?.(this.holdWeight > 0.06);

    if (this.holdWeight > 0) {
      let swing = 0;
      let recoil = 0;
      if (this.tapTimer > 0) {
        this.tapTimer = Math.max(0, this.tapTimer - dt);
        const phase = 1 - this.tapTimer / TAP_DURATION;
        // Phase 0..0.28: wind up slightly (-0.35) then snap down (+1.0) onto the woodblock; 0.28..1: smooth rebound back to 0.
        if (phase < 0.14) {
          swing = -(phase / 0.14) * 0.35;
        } else if (phase < 0.34) {
          swing = -0.35 + ((phase - 0.14) / 0.2) * 1.35;
        } else {
          swing = Math.cos(((phase - 0.34) / 0.66) * (Math.PI * 0.5));
        }
        recoil = phase >= 0.28 ? Math.sin(((phase - 0.28) / 0.72) * Math.PI) : 0;
      }

      const w = this.holdWeight;
      const breath = Math.sin(this.t * 2.1) * 0.015;

      // Keep torso upright and calm (even when seated on a cushion in "kneel" mode).
      bones.spine.quaternion.slerp(setQuatEuler(0.02 + breath * 0.5, 0, 0), w);
      bones.chest.quaternion.slerp(setQuatEuler(0.03 + breath + 0.012 * recoil, 0, 0), w);
      bones.head.quaternion.slerp(setQuatEuler(0.14 + 0.02 * recoil, 0, 0), w);
      if (this.current === "kneel") {
        bones.hips.position.y = MathUtils.lerp(bones.hips.position.y, JOINT.hips.y - 0.26, w);
        bones.hips.position.z = MathUtils.lerp(bones.hips.position.z, 0, w);
      }

      // Left arm: reaches well forward (z ≈ 0.22 m, clear of the 0.163 m robe) cradling the woodblock in front of the chest.
      bones["upper_arm.L"].quaternion.slerp(setQuatEuler(-0.78, -0.15, -0.18), w);
      bones["forearm.L"].quaternion.slerp(setQuatEuler(-1.05 + 0.08 * recoil, 0.25, -0.36), w);
      bones["hand.L"].quaternion.slerp(setQuatEuler(0.08 + 0.12 * recoil, 0.05, -0.18), w);

      // Right arm: raised slightly higher and to the right, swinging the mallet down (-X pitch) and inward (+Z) onto the woodblock.
      bones["upper_arm.R"].quaternion.slerp(setQuatEuler(-0.82 + 0.14 * swing, 0.18, 0.22 - 0.1 * swing), w);
      bones["forearm.R"].quaternion.slerp(setQuatEuler(-1.18 + 0.42 * swing, -0.22, 0.16 + 0.35 * swing), w);
      bones["hand.R"].quaternion.slerp(setQuatEuler(-0.28 + 0.55 * swing, -0.12 * swing, -0.08 + 0.42 * swing), w);
    }
  }

  dispose(): void {
    this.model.dispose();
  }

  /** Freezes what is on screen now as the start of a new blend. */
  private startBlend(seconds = BLEND_SECONDS): void {
    copyRotations(this.shown, this.from);
    this.fromRoot.copy(this.shownRoot);
    this.blend = 0;
    this.blendSeconds = seconds;
  }
}

function copyRotations(src: BoneRotations, dst: BoneRotations): void {
  for (const name of BONE_NAMES) dst[name].copy(src[name]);
}
