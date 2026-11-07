import {
  ALL_QUESTS_BONUS,
  SHOP_ITEMS,
  type BuyOrEquipResult,
  type Progression,
  type ShopCategory,
} from "../game/progression.ts";
import "./progression-dialog.css";

type TabId = "checkin" | "quests" | "shop";

export interface ProgressionDialogCallbacks {
  onClaimReward?: (meritAdded: number, label: string) => void;
  onShopAction?: (res: BuyOrEquipResult) => void;
}

const CATEGORY_LABEL: Record<ShopCategory, string> = {
  aura: "Hào Quang Chánh Niệm",
  artifact: "Pháp Khí Hộ Thân",
  title: "Danh Hiệu Tịnh Tu",
};

/**
 * HUD Merit Currency pill + 3-tab modal dialog (Daily Check-in, Daily Quests, Spiritual Shop).
 */
export class ProgressionDialog {
  private readonly chip: HTMLButtonElement;
  private readonly chipValue: HTMLSpanElement;
  private readonly chipDot: HTMLSpanElement;
  private readonly dialog: HTMLDialogElement;
  private readonly balanceEl: HTMLSpanElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private activeTab: TabId = "checkin";
  private readonly offChange: () => void;

  constructor(
    private readonly prog: Progression,
    private readonly cb: ProgressionDialogCallbacks = {},
    parent: HTMLElement = document.body,
  ) {
    // 1. HUD Merit Currency Pill
    this.chip = document.createElement("button");
    this.chip.type = "button";
    this.chip.className = "hud-merit-chip";
    this.chip.title = "Sổ Tu Tập & Pháp Bảo Các (Phím 6 / J)";
    this.chip.setAttribute("aria-label", "Công đức và Nhiệm vụ");

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.9");
    icon.classList.add("hud-merit-icon");
    icon.innerHTML = `<path d="M12 3C9.5 6.5 8 9.5 8 12.5a4 4 0 0 0 8 0C16 9.5 14.5 6.5 12 3Z"/><path d="M8 13c-2.5-.5-4.5 1-5 3.5 2.5 1 5.5 1.5 9 1.5s6.5-.5 9-1.5c-.5-2.5-2.5-4-5-3.5"/>`;

    const label = document.createElement("span");
    label.textContent = "Công đức:";

    this.chipValue = document.createElement("span");
    this.chipValue.className = "hud-merit-value";

    this.chipDot = document.createElement("span");
    this.chipDot.className = "hud-merit-dot";
    this.chipDot.hidden = true;

    this.chip.append(icon, label, this.chipValue, this.chipDot);
    this.chip.addEventListener("click", () => this.open());
    parent.append(this.chip);

    // 2. Modal Dialog
    this.dialog = document.createElement("dialog");
    this.dialog.className = "progression-dialog";
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.close();
    });

    const shell = document.createElement("div");
    shell.className = "prog-shell";

    const header = document.createElement("div");
    header.className = "prog-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "prog-title-wrap";
    const h2 = document.createElement("h2");
    h2.textContent = "Sổ Tu Tập & Pháp Bảo Các";
    const sub = document.createElement("p");
    sub.textContent = "Tích lũy công đức mỗi ngày qua lễ Phật, lần chuỗi và gõ mõ";
    titleWrap.append(h2, sub);

    const headerRight = document.createElement("div");
    headerRight.className = "prog-header-right";
    this.balanceEl = document.createElement("span");
    this.balanceEl.className = "prog-balance";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "prog-close";
    closeBtn.setAttribute("aria-label", "Đóng");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());

    headerRight.append(this.balanceEl, closeBtn);
    header.append(titleWrap, headerRight);

    const tabs = document.createElement("div");
    tabs.className = "prog-tabs";
    tabs.setAttribute("role", "tablist");
    const tabDefs: { id: TabId; label: string }[] = [
      { id: "checkin", label: "Điểm Danh" },
      { id: "quests", label: "Nhật Tu" },
      { id: "shop", label: "Pháp Bảo Các" },
    ];
    for (const t of tabDefs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prog-tab";
      btn.setAttribute("role", "tab");
      btn.textContent = t.label;
      btn.addEventListener("click", () => {
        this.activeTab = t.id;
        this.render();
      });
      this.tabButtons.set(t.id, btn);
      tabs.append(btn);
    }

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "prog-body";

    shell.append(header, tabs, this.bodyEl);
    this.dialog.append(shell);
    parent.append(this.dialog);

    this.offChange = this.prog.onChange(() => this.render());
    this.render();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(tab?: TabId): void {
    if (tab) this.activeTab = tab;
    else if (this.prog.canCheckIn()) this.activeTab = "checkin";
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  toggle(): void {
    if (this.dialog.open) this.close();
    else this.open();
  }

  dispose(): void {
    this.offChange();
    this.chip.remove();
    this.dialog.remove();
  }

  private render(): void {
    const meritText = String(this.prog.merit);
    this.chipValue.textContent = meritText;
    this.balanceEl.textContent = `🪷 ${meritText} Công đức`;
    this.chipDot.hidden = !this.prog.hasNotification();

    for (const [id, btn] of this.tabButtons) {
      btn.setAttribute("aria-selected", id === this.activeTab ? "true" : "false");
    }

    if (!this.dialog.open && !this.bodyEl.hasChildNodes()) {
      this.renderActiveTab();
      return;
    }
    if (this.dialog.open) {
      this.renderActiveTab();
    }
  }

  private renderActiveTab(): void {
    this.bodyEl.replaceChildren();
    if (this.activeTab === "checkin") this.renderCheckIn();
    else if (this.activeTab === "quests") this.renderQuests();
    else this.renderShop();
  }

  private renderCheckIn(): void {
    const status = this.prog.checkInStatus();

    const banner = document.createElement("div");
    banner.className = "checkin-banner";

    const textWrap = document.createElement("div");
    textWrap.className = "checkin-banner-text";
    const strong = document.createElement("strong");
    strong.textContent = status.canClaim
      ? `Hôm nay là Ngày ${status.activeDay} trong chuỗi tinh tấn`
      : `Đã điểm danh Ngày ${status.activeDay} hôm nay`;
    const sub = document.createElement("span");
    sub.textContent = status.canClaim
      ? "Nhận lộc công đức đầu ngày để thỉnh pháp bảo và hào quang."
      : "Hãy quay lại vào ngày mai (sau 00:00 giờ Việt Nam) để nối tiếp chuỗi tu tập.";
    textWrap.append(strong, sub);

    const claimBtn = document.createElement("button");
    claimBtn.type = "button";
    claimBtn.className = "prog-btn";
    claimBtn.disabled = !status.canClaim;
    const todayReward = status.rewards[status.activeDay - 1] ?? 20;
    claimBtn.textContent = status.canClaim ? `Điểm danh (+${todayReward})` : "Đã nhận hôm nay";
    claimBtn.addEventListener("click", () => {
      const res = this.prog.claimCheckIn();
      if (res.ok) {
        this.cb.onClaimReward?.(res.reward, `Điểm danh Ngày ${res.day}: +${res.reward} Công đức`);
      }
    });

    banner.append(textWrap, claimBtn);

    const grid = document.createElement("div");
    grid.className = "checkin-grid";
    status.rewards.forEach((reward, idx) => {
      const dayNum = idx + 1;
      const card = document.createElement("div");
      card.className = "checkin-day";
      if (dayNum === 7) card.classList.add("checkin-day--wide");

      const isDone = status.canClaim ? dayNum < status.activeDay : dayNum <= status.activeDay;
      const isToday = dayNum === status.activeDay;
      if (isDone) card.classList.add("checkin-day--done");
      if (isToday && status.canClaim) card.classList.add("checkin-day--today");

      const lbl = document.createElement("span");
      lbl.className = "checkin-day-label";
      lbl.textContent = dayNum === 7 ? "Ngày 7 · Viên Mãn Tuần" : `Ngày ${dayNum}`;

      const val = document.createElement("span");
      val.className = "checkin-day-reward";
      val.textContent = `+${reward} Công đức`;

      const st = document.createElement("span");
      st.className = "checkin-day-status";
      st.textContent = isDone ? "✓ Đã nhận" : isToday ? "Hôm nay" : "Sắp tới";

      card.append(lbl, val, st);
      grid.append(card);
    });

    this.bodyEl.append(banner, grid);
  }

  private renderQuests(): void {
    const list = document.createElement("div");
    list.className = "quest-list";

    // Bonus banner for completing all 5 daily quests
    const bonusCard = document.createElement("div");
    bonusCard.className = "checkin-banner";
    const bonusText = document.createElement("div");
    bonusText.className = "checkin-banner-text";
    const bStrong = document.createElement("strong");
    bStrong.textContent = `Viên Mãn Nhật Tu (+${ALL_QUESTS_BONUS} Công đức)`;
    const bSub = document.createElement("span");
    bSub.textContent = "Hoàn thành cả 5 nhiệm vụ trong ngày để nhận thưởng viên mãn.";
    bonusText.append(bStrong, bSub);

    const bonusBtn = document.createElement("button");
    bonusBtn.type = "button";
    bonusBtn.className = "prog-btn";
    bonusBtn.disabled = !this.prog.canClaimAllBonus;
    bonusBtn.textContent = this.prog.allBonusClaimed
      ? "Đã nhận thưởng"
      : this.prog.canClaimAllBonus
        ? `Nhận +${ALL_QUESTS_BONUS}`
        : "Chưa đủ 5/5";
    bonusBtn.addEventListener("click", () => {
      const res = this.prog.claimAllBonus();
      if (res.ok) {
        this.cb.onClaimReward?.(res.reward, `Viên mãn Nhật Tu: +${res.reward} Công đức`);
      }
    });
    bonusCard.append(bonusText, bonusBtn);
    list.append(bonusCard);

    for (const q of this.prog.quests()) {
      const card = document.createElement("div");
      card.className = "quest-card";
      if (q.completed && !q.claimed) card.classList.add("quest-card--done");

      const info = document.createElement("div");
      info.className = "quest-info";

      const titleRow = document.createElement("div");
      titleRow.className = "quest-title-row";
      const title = document.createElement("span");
      title.className = "quest-title";
      title.textContent = q.def.title;
      const rewardTag = document.createElement("span");
      rewardTag.className = "quest-reward-tag";
      rewardTag.textContent = `+${q.def.reward} Công đức`;
      titleRow.append(title, rewardTag);

      const desc = document.createElement("p");
      desc.className = "quest-desc";
      desc.textContent = q.def.desc;

      const barWrap = document.createElement("div");
      barWrap.className = "quest-bar-wrap";
      const bar = document.createElement("div");
      bar.className = "quest-bar";
      const fill = document.createElement("div");
      fill.className = "quest-bar-fill";
      const pct = Math.min(100, Math.round((q.progress / q.def.target) * 100));
      fill.style.width = `${pct}%`;
      bar.append(fill);

      const count = document.createElement("span");
      count.className = "quest-count";
      count.textContent = `${q.progress}/${q.def.target}`;
      barWrap.append(bar, count);

      info.append(titleRow, desc, barWrap);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prog-btn";
      btn.disabled = !q.completed || q.claimed;
      btn.textContent = q.claimed ? "Đã nhận" : q.completed ? "Nhận thưởng" : "Đang tu tập";
      btn.addEventListener("click", () => {
        const res = this.prog.claimQuest(q.def.id);
        if (res.ok) {
          this.cb.onClaimReward?.(res.reward, `${q.def.title}: +${res.reward} Công đức`);
        }
      });

      card.append(info, btn);
      list.append(card);
    }

    this.bodyEl.append(list);
  }

  private renderShop(): void {
    const list = document.createElement("div");
    list.className = "shop-list";

    for (const item of SHOP_ITEMS) {
      const owned = this.prog.isOwned(item.id);
      const equipped = this.prog.isEquipped(item.id);

      const card = document.createElement("div");
      card.className = "shop-card";
      if (equipped) card.classList.add("shop-card--equipped");

      const info = document.createElement("div");
      info.className = "shop-info";

      const cat = document.createElement("span");
      cat.className = "shop-cat";
      cat.textContent = CATEGORY_LABEL[item.category];

      const name = document.createElement("span");
      name.className = "shop-name";
      name.textContent = item.name;

      const desc = document.createElement("p");
      desc.className = "shop-desc";
      desc.textContent = item.desc;

      info.append(cat, name, desc);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prog-btn";
      if (equipped) {
        btn.classList.add("prog-btn--equipped");
        btn.textContent = "Đang dùng (Gỡ)";
      } else if (owned) {
        btn.classList.add("prog-btn--equip");
        btn.textContent = "Trang bị";
      } else {
        btn.textContent = `Thỉnh · ${item.price}`;
      }

      btn.addEventListener("click", () => {
        const res = this.prog.buyOrEquip(item.id);
        this.cb.onShopAction?.(res);
      });

      card.append(info, btn);
      list.append(card);
    }

    this.bodyEl.append(list);
  }
}
