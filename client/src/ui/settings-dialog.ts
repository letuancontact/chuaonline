import { CEREMONY_DURATION_S, CEREMONY_HOURS, ceremonyAt, vnTimeOfDay } from "@santinh/shared";
import type { Chant } from "../audio/chant.ts";
import type { AudioEngine, AudioSettings } from "../audio/engine.ts";
import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./base.css";

const HOUR_MS = 3_600_000;
const NOON_MS = 12 * HOUR_MS;

const hhmm = (msOfDay: number): string => {
  const m = Math.floor(msOfDay / 60_000);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** "Khóa lễ tối kế tiếp 18:00 · mỗi ngày 05:00 và 18:00 (giờ Việt Nam)" for the moment `ms`. */
export function ceremonyScheduleText(ms: number): string {
  const next = vnTimeOfDay(ceremonyAt(ms, CEREMONY_DURATION_S).next);
  const [a = 0, b = 0] = CEREMONY_HOURS;
  return vi.settings.nextCeremony
    .replace("{session}", next < NOON_MS ? vi.settings.morning : vi.settings.evening)
    .replace("{time}", hhmm(next))
    .replace("{hours}", vi.settings.hoursPair.replace("{a}", hhmm(a * HOUR_MS)).replace("{b}", hhmm(b * HOUR_MS)));
}

const percent = (v: number): string => vi.settings.percent.replace("{n}", String(Math.round(v * 100)));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function lines(parent: HTMLElement, texts: readonly string[]): void {
  texts.forEach((t, i) => {
    if (i > 0) parent.append(document.createElement("br"));
    parent.append(t);
  });
}

type VolumeKey = "ambientVolume" | "chantVolume" | "sfxVolume";

/** The "Tài khoản" row's two actions (start.ts owns the session). */
export interface AccountActions {
  signIn: () => void;
  signOut: () => void;
}

/** "Cài đặt" (design/settings.html): our name, ambient / chant / effects, background play, controls, credits. */
export class SettingsDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly desc: HTMLParagraphElement;
  private readonly ambientToggle: HTMLButtonElement;
  private readonly sfxToggle: HTMLButtonElement;
  private readonly bgToggle: HTMLButtonElement;
  private readonly bgDesc: HTMLElement;
  private readonly chantDesc: HTMLElement;
  private readonly chantBtn: HTMLButtonElement;
  private readonly schedule: HTMLElement;
  private readonly nameText: HTMLElement;
  private readonly accountText: HTMLElement;
  private readonly accountBtn: HTMLButtonElement;
  private username: string | null = null;
  private readonly sliders: { key: VolumeKey; input: HTMLInputElement; output: HTMLOutputElement }[] = [];
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly audio: AudioEngine,
    private readonly chant: Chant,
    private readonly now: () => number,
    onRename: () => void,
    private readonly account: AccountActions,
    parent: HTMLElement = document.body,
  ) {
    const t = vi.settings;
    this.dialog = el("dialog", "dialog");
    this.dialog.setAttribute("aria-labelledby", "set-title");

    const head = el("header", "dialog-head");
    const title = el("h2", "", t.title);
    title.id = "set-title";
    const close = el("button", "dialog-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", t.close);
    close.addEventListener("click", () => this.close());
    head.append(title, close);
    this.desc = el("p", "dialog-desc");

    const body = el("div", "dialog-body");

    const renameBtn = el("button", "btn btn--ghost", t.rename);
    renameBtn.type = "button";
    renameBtn.setAttribute("aria-label", t.renameLabel);
    renameBtn.addEventListener("click", onRename);
    const nameSection = this.section(t.name, "", renameBtn);
    this.nameText = nameSection.querySelector("small") ?? el("small");
    this.nameText.classList.add("section-name");
    body.append(nameSection);

    this.accountBtn = el("button", "btn btn--ghost");
    this.accountBtn.type = "button";
    this.accountBtn.addEventListener("click", () => (this.username === null ? this.account.signIn() : this.account.signOut()));
    const accountSection = this.section(t.account, "", this.accountBtn);
    this.accountText = accountSection.querySelector("small") ?? el("small");
    this.accountText.classList.add("section-name");
    body.append(accountSection);
    this.renderAccount();

    this.ambientToggle = this.toggle(t.ambient, () => this.flip("ambientOn"));
    body.append(this.section(t.ambient, t.ambientDesc, this.ambientToggle, "ambientVolume"));

    this.chantBtn = el("button", "btn btn--ghost");
    this.chantBtn.type = "button";
    this.chantBtn.addEventListener("click", () => chant.toggle());
    const chantSection = this.section(t.chant, t.chantDesc, this.chantBtn, "chantVolume");
    this.chantDesc = chantSection.querySelector("small") ?? el("small");
    this.schedule = el("small", "section-note");
    chantSection.append(this.schedule);
    body.append(chantSection);

    this.sfxToggle = this.toggle(t.sfx, () => this.flip("sfxOn"));
    body.append(this.section(t.sfx, t.sfxDesc, this.sfxToggle, "sfxVolume"));

    this.bgToggle = this.toggle(t.background, () => audio.update({ backgroundPlay: !audio.settings.backgroundPlay }));
    const bgSection = this.section(t.background, t.backgroundOff, this.bgToggle);
    this.bgDesc = bgSection.querySelector("small") ?? el("small");
    body.append(bgSection);

    const info = el("section", "section");
    const controls = el("details");
    const controlsBody = el("p");
    lines(controlsBody, t.controlsBody);
    controls.append(el("summary", "", t.controls), controlsBody);
    const author = el("p", "author");
    const mail = el("a", "", t.author);
    mail.href = `mailto:${t.authorMail}`;
    author.append(mail);
    info.append(controls, author);
    body.append(info);

    this.dialog.append(head, this.desc, body);
    this.offs.push(closeOnBackdrop(this.dialog));
    this.offs.push(audio.on("change", () => this.render()));
    this.offs.push(chant.onChange(() => this.render()));
    parent.append(this.dialog);
    this.render();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /** The name we picked (not the room's "An 2" variant, P3-D3). */
  setName(name: string): void {
    this.nameText.textContent = name;
    this.nameText.title = name;
  }

  /** Our username (only we ever see it, P4-D2), or null as a guest. */
  setAccount(username: string | null): void {
    this.username = username;
    this.renderAccount();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.close();
    this.dialog.remove();
  }

  private renderAccount(): void {
    const t = vi.settings;
    const signedIn = this.username !== null;
    this.accountText.textContent = this.username ?? t.accountGuest;
    this.accountText.title = this.username ?? "";
    this.accountText.classList.toggle("section-name--muted", !signedIn);
    this.accountBtn.textContent = signedIn ? t.signOut : t.signIn;
  }

  /** While muted every switch reads off (design "tiếng tổng đang tắt"); turning one on unmutes. */
  private flip(key: "ambientOn" | "sfxOn"): void {
    const shownOn = this.audio.settings[key] && !this.audio.muted;
    if (shownOn) this.audio.update({ [key]: false });
    else {
      this.audio.update({ [key]: true });
      if (this.audio.muted) this.audio.setMuted(false);
    }
  }

  private toggle(label: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", "toggle");
    b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }

  private section(title: string, desc: string, control: HTMLElement, volume?: VolumeKey): HTMLElement {
    const s = el("section", "section");
    const headRow = el("div", "section-head");
    const text = el("div", "section-text");
    text.append(el("h3", "", title), el("small", "", desc));
    headRow.append(text, control);
    s.append(headRow);
    if (volume) {
      const label = el("label", "slider");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.setAttribute("aria-label", `${vi.settings.volume} ${title}`);
      const output = el("output");
      input.addEventListener("input", () => {
        const v = Number(input.value) / 100;
        output.value = percent(v);
        this.audio.update({ [volume]: v } as Partial<AudioSettings>);
      });
      label.append(el("span", "", vi.settings.volume), input, output);
      s.append(label);
      this.sliders.push({ key: volume, input, output });
    }
    return s;
  }

  private render(): void {
    const t = vi.settings;
    const s = this.audio.settings;
    const muted = this.audio.muted;
    if (muted) {
      this.desc.textContent = "";
      this.desc.append(el("span", "text-warning", t.muted));
    } else this.desc.textContent = t.desc;

    this.ambientToggle.setAttribute("aria-checked", String(s.ambientOn && !muted));
    this.sfxToggle.setAttribute("aria-checked", String(s.sfxOn && !muted));
    this.bgToggle.setAttribute("aria-checked", String(s.backgroundPlay));
    this.bgDesc.textContent = s.backgroundPlay ? t.backgroundOn : t.backgroundOff;
    for (const sl of this.sliders) {
      const v = s[sl.key];
      // Don't fight the thumb the user is dragging.
      if (document.activeElement !== sl.input) sl.input.value = String(Math.round(v * 100));
      sl.output.value = percent(v);
    }

    const c = this.chant.state;
    this.chantBtn.textContent = c.on ? t.stop : t.listen;
    this.chantBtn.setAttribute("aria-pressed", String(c.on));
    this.chantDesc.textContent = c.error ? t.chantError : c.ceremony ? t.chantCeremony : t.chantDesc;
    this.chantDesc.classList.toggle("text-danger", c.error);
    this.schedule.textContent = "";
    lines(this.schedule, [ceremonyScheduleText(this.now()), t.together]);
  }
}
