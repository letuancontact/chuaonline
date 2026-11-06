import { roomNameOf, type ConnectionStatus } from "@santinh/shared";
import type { ActionState } from "../game/actions.ts";
import { vi } from "../i18n/vi.ts";
import { icons } from "./icons.ts";
import "./base.css";

/** The control hint fades out after this (design/game.html note). */
export const HINT_MS = 8000;

export type GestureKind = "bowGreet" | "kinhHanh" | "gardenSit" | "blessing";

export const GESTURE_ORDER: readonly GestureKind[] = ["bowGreet", "kinhHanh", "gardenSit", "blessing"];

/** HUD buttons; the optional ones do nothing when left out (previews, tests). */
export interface HudHandlers {
  rooms(): void;
  hello(): void;
  bow(): void;
  beads(): void;
  woodblock?(): void;
  gesture?(kind: GestureKind): void;
  offering?(): void;
  exit?(): void;
  people?(): void;
  invite?(): void;
  sound?(): void;
  settings?(): void;
  chant?(): void;
}

function button(className: string, html: string, label?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.innerHTML = html;
  if (label) b.setAttribute("aria-label", label);
  return b;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function actionButton(icon: string, label: string, key: string): { button: HTMLButtonElement; label: HTMLSpanElement } {
  const b = button("action", icon);
  b.setAttribute("aria-pressed", "false");
  const span = el("span", "", label);
  b.append(span, el("kbd", "", key));
  return { button: b, label: span };
}

/** Game HUD (design/game.html): exit + room pill top-left, tools top-right, action dock, control hint. */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly pill: HTMLButtonElement;
  private readonly pillRoom: HTMLElement;
  private readonly dot: HTMLSpanElement;
  private readonly invite: HTMLButtonElement;
  private readonly people: HTMLButtonElement;
  private readonly peopleCount: HTMLSpanElement;
  private readonly sound: HTMLButtonElement;
  private readonly chant: HTMLButtonElement;
  private readonly helloBtn: HTMLButtonElement;
  private readonly bowBtn: HTMLButtonElement;
  private readonly bowLabel: HTMLSpanElement;
  private readonly beadsBtn: HTMLButtonElement;
  private readonly woodblockBtn: HTMLButtonElement;
  private readonly woodblockBadge: HTMLSpanElement;
  private readonly gesturesBtn: HTMLButtonElement;
  private readonly gestureMenu: HTMLDivElement;
  private readonly gestureItems = new Map<GestureKind, HTMLButtonElement>();
  private readonly hint: HTMLDivElement;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onDocPointerDown: (e: PointerEvent) => void;
  private room = 1;
  private roomName = roomNameOf(null, 1);
  private status: ConnectionStatus = "connecting";
  private count = 0;
  private bowLocked = true;
  private action: ActionState = "idle";
  private bowing = false;
  private activeGesture: GestureKind | null = null;

  constructor(h: HudHandlers, parent: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.className = "game-hud";

    // Top-left: exit + room pill.
    const topLeft = el("div", "hud hud-top-left");
    const exit = button("tool tool-circle glass", icons.exit, vi.hud.exit);
    exit.addEventListener("click", () => h.exit?.());
    this.pill = button("room-pill glass", "");
    const mark = el("span", "mark");
    mark.innerHTML = icons.temple;
    this.pillRoom = el("small", "");
    this.dot = el("span", "status-dot");
    const chevron = document.createElement("span");
    chevron.innerHTML = icons.chevron;
    this.pill.append(mark, el("strong", "pill-brand", vi.hud.brand), this.pillRoom, this.dot, chevron);
    this.pill.addEventListener("click", () => h.rooms());
    topLeft.append(exit, this.pill);

    // Top-right: tool group + chant chip.
    const topRight = el("div", "hud hud-top-right");
    const group = el("div", "tool-group glass");
    const offering = button("tool tool-circle", icons.offering, vi.hud.offering);
    offering.title = vi.hud.offering;
    offering.addEventListener("click", () => h.offering?.());
    // 390 px: icon only (the label carries the name); wider: icon + text.
    this.invite = button("tool", icons.invite, vi.hud.invite);
    this.invite.append(el("span", "hide-mobile", vi.hud.inviteShort));
    this.invite.addEventListener("click", () => h.invite?.());
    this.people = button("tool", icons.people);
    this.peopleCount = el("span", "");
    this.people.append(this.peopleCount);
    this.people.addEventListener("click", () => h.people?.());
    this.sound = button("tool tool-circle", icons.muted, vi.hud.soundOn);
    this.sound.addEventListener("click", () => h.sound?.());
    const settings = button("tool tool-circle", icons.settings, vi.hud.settings);
    settings.addEventListener("click", () => h.settings?.());
    group.append(offering, this.invite, this.people, this.sound, settings);
    this.chant = button("chip", "");
    this.chant.textContent = vi.hud.chant;
    this.chant.setAttribute("aria-pressed", "false");
    this.chant.addEventListener("click", () => h.chant?.());
    topRight.append(group, this.chant);

    // Bottom dock: Chắp tay [3], Thiền [1], Tràng hạt [2], Gõ mõ [4], Động tác [5].
    const bottom = el("div", "hud hud-bottom");
    const bar = el("div", "action-bar glass");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", vi.hud.actions);
    const hello = actionButton(icons.hello, vi.hud.hello, "3");
    const bow = actionButton(icons.bow, vi.hud.bow, "1");
    const beads = actionButton(icons.beads, vi.hud.beads, "2");
    const woodblock = actionButton(icons.woodblock, vi.hud.woodblock, "4");
    const gestures = actionButton(icons.gestures, vi.hud.gestures, "5");
    this.helloBtn = hello.button;
    this.bowBtn = bow.button;
    this.bowLabel = bow.label;
    this.beadsBtn = beads.button;
    this.woodblockBtn = woodblock.button;
    this.gesturesBtn = gestures.button;
    this.woodblockBadge = el("span", "action-badge");
    this.woodblockBadge.hidden = true;
    this.woodblockBtn.append(this.woodblockBadge);

    // Gesture popover menu above the action dock (with icons + labels).
    this.gestureMenu = el("div", "gesture-menu glass");
    this.gestureMenu.hidden = true;
    const gestureLabels: Record<GestureKind, string> = {
      bowGreet: vi.hud.gestureBowGreet,
      kinhHanh: vi.hud.gestureKinhHanh,
      gardenSit: vi.hud.gestureGardenSit,
      blessing: vi.hud.gestureBlessing,
    };
    const gestureIcons: Record<GestureKind, string> = {
      bowGreet: icons.gestureBowGreet,
      kinhHanh: icons.gestureKinhHanh,
      gardenSit: icons.gestureGardenSit,
      blessing: icons.gestureBlessing,
    };
    for (const kind of GESTURE_ORDER) {
      const item = button("gesture-item", gestureIcons[kind]);
      item.setAttribute("aria-pressed", "false");
      item.append(el("span", "", gestureLabels[kind]));
      item.addEventListener("click", () => {
        this.gestureMenu.hidden = true;
        h.gesture?.(kind);
      });
      this.gestureItems.set(kind, item);
      this.gestureMenu.append(item);
    }

    this.helloBtn.addEventListener("click", () => {
      this.gestureMenu.hidden = true;
      h.hello();
    });
    this.bowBtn.addEventListener("click", () => {
      this.gestureMenu.hidden = true;
      h.bow();
    });
    this.beadsBtn.addEventListener("click", () => {
      this.gestureMenu.hidden = true;
      h.beads();
    });
    this.woodblockBtn.addEventListener("click", () => {
      this.gestureMenu.hidden = true;
      h.woodblock?.();
    });
    this.gesturesBtn.addEventListener("click", () => {
      this.gestureMenu.hidden = !this.gestureMenu.hidden;
    });

    this.onDocPointerDown = (e: PointerEvent) => {
      if (this.gestureMenu.hidden) return;
      const target = e.target as Node | null;
      if (target && !bottom.contains(target)) {
        this.gestureMenu.hidden = true;
      }
    };
    window.addEventListener("pointerdown", this.onDocPointerDown, { passive: true });

    bar.append(this.helloBtn, this.bowBtn, this.beadsBtn, this.woodblockBtn, this.gesturesBtn);
    bottom.append(this.gestureMenu, bar);

    // Control hint: pointer and touch copy, CSS picks one.
    this.hint = el("div", "hud hud-hint");
    const hint = el("div", "hint");
    hint.append(el("span", "only-pointer", vi.hud.hintPointer), el("span", "only-touch", vi.hud.hintTouch));
    this.hint.append(hint);
    this.timers.push(
      setTimeout(() => {
        this.hint.dataset.hidden = "";
        this.timers.push(setTimeout(() => (this.hint.hidden = true), 700));
      }, HINT_MS),
    );

    this.root.append(topLeft, topRight, bottom, this.hint);
    parent.append(this.root);
    this.renderRoom();
    this.renderStatus();
    this.renderActions();
  }

  setRoom(n: number, name: string): void {
    this.room = n;
    this.roomName = name;
    this.renderRoom();
  }

  setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.renderStatus();
  }

  /** People in the room, ourselves included, NPCs not. */
  setCount(n: number): void {
    this.count = n;
    this.renderStatus();
  }

  /** `bowing` = seeking or on a cushion, even under a hello / beads overlay (Lạy turns into Dừng). */
  setAction(state: ActionState, bowing: boolean): void {
    this.action = state;
    this.bowing = bowing;
    this.renderActions();
  }

  /** Lạy needs the server (cushion grant); locked while not connected. */
  setBowLocked(locked: boolean): void {
    this.bowLocked = locked;
    this.renderActions();
  }

  /** Highlights the active gesture on the Động tác [5] button and its popover menu. */
  setGesture(kind: GestureKind | null): void {
    this.activeGesture = kind;
    this.gesturesBtn.setAttribute("aria-pressed", String(kind !== null));
    for (const [k, btn] of this.gestureItems) {
      btn.setAttribute("aria-pressed", String(k === kind));
    }
  }

  /** Updates the bronze counter badge on the Gõ mõ action button (hidden when 0) and pulses the button. */
  setWoodblockCount(count: number, pulse = false): void {
    const n = Math.max(0, Math.floor(count));
    if (n > 0) {
      this.woodblockBadge.textContent = String(n);
      this.woodblockBadge.hidden = false;
    } else {
      this.woodblockBadge.textContent = "";
      this.woodblockBadge.hidden = true;
    }
    if (pulse) {
      this.woodblockBtn.dataset.pulse = "true";
      if (this.pulseTimer) clearTimeout(this.pulseTimer);
      this.pulseTimer = setTimeout(() => {
        delete this.woodblockBtn.dataset.pulse;
        this.pulseTimer = null;
      }, 110);
    }
  }

  setSound(on: boolean): void {
    this.sound.innerHTML = on ? icons.sound : icons.muted;
    this.sound.setAttribute("aria-label", on ? vi.hud.soundOff : vi.hud.soundOn);
  }

  /** Puts a status chip (ceremony banner) above the chant button, as in design/game.html. */
  addBanner(el: HTMLElement): void {
    this.chant.before(el);
  }

  setChant(on: boolean): void {
    this.chant.setAttribute("aria-pressed", String(on));
  }

  dispose(): void {
    window.removeEventListener("pointerdown", this.onDocPointerDown);
    for (const t of this.timers) clearTimeout(t);
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.root.remove();
  }

  private renderRoom(): void {
    const fill = (t: string): string => t.replace("{n}", String(this.room)).replace("{room}", this.roomName);
    this.pillRoom.textContent = fill(vi.hud.room);
    this.pill.setAttribute("aria-label", fill(vi.hud.roomPill));
  }

  private renderStatus(): void {
    const s = this.status;
    this.dot.className =
      s === "connected" ? "status-dot" : s === "connecting" ? "status-dot status-dot--connecting" : "status-dot status-dot--off";
    const connected = s === "connected";
    this.invite.disabled = !connected;
    this.peopleCount.textContent = connected ? String(this.count) : vi.hud.peopleUnknown;
    this.people.setAttribute(
      "aria-label",
      connected
        ? vi.hud.people.replace("{n}", String(this.count))
        : s === "connecting"
          ? vi.hud.peopleConnecting
          : vi.hud.peopleOffline,
    );
  }

  private renderActions(): void {
    const a = this.action;
    const bowing = this.bowing;
    this.helloBtn.setAttribute("aria-pressed", String(a === "hello"));
    this.beadsBtn.setAttribute("aria-pressed", String(a === "beads"));
    this.gesturesBtn.setAttribute("aria-pressed", String(this.activeGesture !== null));
    this.bowLabel.textContent = bowing ? vi.hud.stand : vi.hud.bow;
    // Standing up must stay possible even if the link drops mid-bow.
    this.bowBtn.disabled = this.bowLocked && !bowing;
    if (this.bowBtn.disabled) this.bowBtn.removeAttribute("aria-pressed");
    else this.bowBtn.setAttribute("aria-pressed", String(bowing));
  }
}
