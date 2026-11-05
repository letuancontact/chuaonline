import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __audioCtx?: AudioContext;
    __chantPlaying?: () => boolean;
  }
}

test("L7: sound on by default, starts at the first gesture; switching it off and settings persist", async ({ page }) => {
  // Keep handles on the game's context and chant element without exposing them from the app.
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.__audioCtx = this;
      }
    };
    const elements: HTMLAudioElement[] = [];
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(src?: string) {
        super(src);
        elements.push(this);
      }
    };
    window.__chantPlaying = () => elements.some((el) => !el.paused);
  });
  await page.goto("/?e2e=1&mock");
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });

  // Chosen state shows before any gesture, but nothing plays yet (autoplay rules).
  await expect(page.getByRole("button", { name: "Tắt tiếng" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nghe tụng kinh" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__audioCtx?.state ?? "none")).toBe("none");

  await page.mouse.click(5, 300);
  await expect.poll(() => page.evaluate(() => window.__audioCtx?.state ?? "none")).toBe("running");
  await expect.poll(() => page.evaluate(() => window.__chantPlaying?.() ?? false)).toBe(true);

  await page.getByRole("button", { name: "Cài đặt" }).click();
  const dialog = page.getByRole("dialog", { name: "Cài đặt" });
  await expect(dialog.getByRole("switch", { name: "Âm nền" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("switch", { name: "Phát khi đổi tab" }).click();
  await expect(dialog.getByRole("switch", { name: "Phát khi đổi tab" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Tắt tiếng" }).click();
  await expect(page.getByRole("button", { name: "Bật tiếng" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__chantPlaying?.() ?? true)).toBe(false);

  // Muted with listening still on: the chip turns the sound back on, it does not stop the chant.
  const chip = page.getByRole("button", { name: "Nghe tụng kinh" });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await chip.click();
  await expect(page.getByRole("button", { name: "Tắt tiếng" })).toBeVisible();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__chantPlaying?.() ?? false)).toBe(true);
  await page.getByRole("button", { name: "Tắt tiếng" }).click();
  await expect(page.getByRole("button", { name: "Bật tiếng" })).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Bật tiếng" })).toBeVisible();
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByRole("dialog", { name: "Cài đặt" }).getByRole("switch", { name: "Phát khi đổi tab" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
