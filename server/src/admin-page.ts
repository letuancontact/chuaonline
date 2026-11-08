import { createHash } from "node:crypto";
import { MAX_ROOM_NAME_CHARS, ROOM_COUNT, SLOT_MS } from "@santinh/shared";

// Served by the realtime server, not the client bundle: its Vietnamese text lives here (P3-D9), not in client i18n.

const STYLE = `
:root { color-scheme: dark; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin: 0; background: #14110d; color: #efe6d6; }
main { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
p { margin: 4px 0 12px; color: #c9bda8; font-size: 14px; line-height: 1.5; }
section { background: #211c16; border: 1px solid #3a3227; border-radius: 12px; padding: 16px; margin-top: 16px; }
h2 { font-size: 16px; margin: 0 0 12px; }
label { font-size: 14px; }
input { background: #14110d; color: inherit; border: 1px solid #4a4033; border-radius: 8px; padding: 8px; font: inherit; }
input[type=number] { width: 64px; text-align: right; }
.names { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.names input { width: 100%; box-sizing: border-box; min-width: 0; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row input[type=password] { flex: 1 1 200px; min-width: 0; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 6px 4px; text-align: left; }
th { color: #c9bda8; font-weight: 500; }
td.fill { color: #c9bda8; }
tfoot td { border-top: 1px solid #3a3227; }
.bad { color: #ff9b85; }
button { background: #d9a441; color: #14110d; border: 0; border-radius: 8px; padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer; }
button.ghost { background: transparent; color: #efe6d6; border: 1px solid #4a4033; }
button:disabled { opacity: 0.5; cursor: default; }
.actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
#msg { min-height: 20px; margin-top: 12px; font-size: 14px; }
#msg.ok { color: #9fd99b; }
#msg.err { color: #ff9b85; }
[hidden] { display: none !important; }
`;

const SCRIPT = `
(() => {
  const KEY = "santinh.admin.pw";
  const API = "/api/admin/population";
  const NAMES_API = "/api/admin/rooms";
  let defaultNames = null;
  const TIERS = ["full", "busy", "medium", "quiet"];
  const $ = (id) => document.getElementById(id);
  let defaults = null;
  let limits = null;

  const getPw = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
  const setPw = (v) => { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch {} };

  function say(text, kind) {
    const el = $("msg");
    el.textContent = text;
    el.className = kind || "";
  }

  function errorText(status, body) {
    if (status === 401) return "Sai mật khẩu.";
    if (status === 429) return "Sai quá nhiều lần, đợi 1 phút rồi thử lại.";
    if (status === 404) return "Trang admin đang tắt (server chưa đặt mật khẩu).";
    if (status === 403) return "Bị chặn: chỉ dùng được trên chính trang này.";
    if (status === 413) return "Dữ liệu quá lớn.";
    if (body && body.error === "invalid-config" && body.maxChars) {
      return "Tên phòng không hợp lệ: đủ " + body.count + " tên, không để trống, không trùng nhau, tối đa " + body.maxChars + " ký tự.";
    }
    if (body && body.error === "invalid-config") {
      const l = body.limits || limits;
      return l
        ? "Cấu hình không hợp lệ: tổng số phòng phải bằng " + l.rooms + ", số bot 0–" + l.maxBots +
          " (thấp ≤ cao), bot tối thiểu 0–" + l.maxMinBots + ", phòng đầy ít hơn " + l.rooms + "."
        : "Cấu hình không hợp lệ.";
    }
    return "Lỗi server" + (body && body.error ? " (" + body.error + ")" : " (" + status + ")") + ".";
  }

  async function call(method, body, url) {
    const res = await fetch(url || API, {
      method,
      headers: Object.assign({ authorization: "Bearer " + getPw() }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401) setPw("");
    return { ok: res.ok, status: res.status, data };
  }

  function num(id) {
    const v = $(id).value.trim();
    return v === "" ? NaN : Number(v);
  }

  function fill(cfg) {
    for (const t of TIERS) $("n-" + t).value = cfg.layout[t];
    for (const t of TIERS.slice(1)) {
      $("lo-" + t).value = cfg.bots[t][0];
      $("hi-" + t).value = cfg.bots[t][1];
    }
    $("min").value = cfg.minBots;
    total();
  }

  function read() {
    const layout = {};
    for (const t of TIERS) layout[t] = num("n-" + t);
    const bots = {};
    for (const t of TIERS.slice(1)) bots[t] = [num("lo-" + t), num("hi-" + t)];
    return { layout, bots, minBots: num("min") };
  }

  function total() {
    const sum = TIERS.reduce((s, t) => s + (num("n-" + t) || 0), 0);
    const el = $("sum");
    el.textContent = limits ? sum + " / " + limits.rooms : String(sum);
    el.className = limits && sum !== limits.rooms ? "bad" : "";
  }

  function fillNames(names) {
    names.forEach((n, i) => { $("room-" + (i + 1)).value = n; });
  }

  function readNames() {
    return Array.from(document.querySelectorAll(".names input"), (el) => el.value);
  }

  async function saveNames(names) {
    busy(true);
    say("Đang lưu…");
    try {
      const r = await call("PUT", { names }, NAMES_API);
      if (!r.ok) {
        say(errorText(r.status, r.data), "err");
        if (r.status === 401) { $("editor").hidden = true; $("names").hidden = true; $("login").hidden = false; }
        return;
      }
      fillNames(r.data.names);
      say("Đã lưu tên phòng. Người đang ở trong phòng thấy tên mới khi mở danh sách phòng hoặc vào lại.", "ok");
    } catch {
      say("Không nối được server.", "err");
    } finally {
      busy(false);
    }
  }

  function busy(on) {
    for (const b of document.querySelectorAll("button")) b.disabled = on;
  }

  async function load() {
    if (!getPw()) return;
    busy(true);
    say("Đang tải…");
    try {
      const r = await call("GET");
      if (!r.ok) {
        say(errorText(r.status, r.data), "err");
        return;
      }
      defaults = r.data.defaults;
      limits = r.data.limits;
      fill(r.data.config);
      const n = await call("GET", null, NAMES_API);
      if (!n.ok) {
        say(errorText(n.status, n.data), "err");
        return;
      }
      defaultNames = n.data.defaults;
      fillNames(n.data.names);
      $("login").hidden = true;
      $("editor").hidden = false;
      $("names").hidden = false;
      say("");
    } catch {
      say("Không nối được server.", "err");
    } finally {
      busy(false);
    }
  }

  async function save(cfg) {
    busy(true);
    say("Đang lưu…");
    try {
      const r = await call("PUT", cfg);
      if (!r.ok) {
        say(errorText(r.status, r.data), "err");
        if (r.status === 401) { $("editor").hidden = true; $("login").hidden = false; }
        return;
      }
      fill(r.data.config);
      say("Đã lưu. Số bot các phòng sẽ đổi dần.", "ok");
    } catch {
      say("Không nối được server.", "err");
    } finally {
      busy(false);
    }
  }

  $("login").addEventListener("submit", (e) => {
    e.preventDefault();
    setPw($("pw").value);
    $("pw").value = "";
    load();
  });
  $("editor").addEventListener("submit", (e) => {
    e.preventDefault();
    save(read());
  });
  $("editor").addEventListener("input", total);
  $("names").addEventListener("submit", (e) => {
    e.preventDefault();
    saveNames(readNames());
  });
  $("names-reset").addEventListener("click", () => { if (defaultNames) saveNames(defaultNames); });
  $("reset").addEventListener("click", () => { if (defaults) save(defaults); });
  $("logout").addEventListener("click", () => {
    setPw("");
    $("editor").hidden = true;
    $("names").hidden = true;
    $("login").hidden = false;
    say("");
  });
  load();
})();
`;

function tierRow(tier: string, label: string): string {
  const range =
    tier === "full"
      ? `<td class="fill" colspan="2">lấp đầy phòng</td>`
      : `<td><input id="lo-${tier}" type="number" min="0" step="1" required aria-label="${label}: bot thấp nhất"></td>` +
        `<td><input id="hi-${tier}" type="number" min="0" step="1" required aria-label="${label}: bot cao nhất"></td>`;
  return `<tr><th scope="row">${label}</th><td><input id="n-${tier}" type="number" min="0" step="1" required aria-label="${label}: số phòng"></td>${range}</tr>`;
}

function nameRows(): string {
  let rows = "";
  for (let i = 1; i <= ROOM_COUNT; i++) {
    rows += `<label for="room-${i}">Phòng ${i}</label><input id="room-${i}" type="text" required maxlength="${MAX_ROOM_NAME_CHARS}" autocomplete="off">`;
  }
  return rows;
}

export const ADMIN_PAGE_HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sân Tĩnh · Quản trị</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Sân Tĩnh · Quản trị</h1>
<p>Chỉnh số người giả và tên các phòng. Lưu xong áp dụng ngay, bot tăng / giảm dần mỗi 20–40 giây.</p>
<form id="login" class="row" autocomplete="off">
<input id="pw" type="password" placeholder="Mật khẩu" aria-label="Mật khẩu" required autocomplete="current-password">
<button type="submit">Mở</button>
</form>
<form id="editor" hidden>
<section>
<h2>Số phòng mỗi hạng và số bot</h2>
<table>
<thead><tr><th>Hạng</th><th>Số phòng</th><th>Bot thấp</th><th>Bot cao</th></tr></thead>
<tbody>
${tierRow("full", "Đầy")}
${tierRow("busy", "Đông")}
${tierRow("medium", "Vừa")}
${tierRow("quiet", "Vắng")}
</tbody>
<tfoot><tr><th scope="row">Tổng</th><td id="sum" colspan="3"></td></tr></tfoot>
</table>
<p>Hạng các phòng xáo lại mỗi ${SLOT_MS / 3_600_000} giờ. Phòng 1 không bao giờ đầy.</p>
</section>
<section>
<h2>Bot tối thiểu</h2>
<div class="row"><label for="min">Mỗi phòng luôn giữ ít nhất</label><input id="min" type="number" min="0" step="1" required><label for="min">bot</label></div>
</section>
<div class="actions">
<button type="submit">Lưu</button>
<button type="button" id="reset" class="ghost">Về mặc định</button>
<button type="button" id="logout" class="ghost">Thoát</button>
</div>
</form>
<form id="names" hidden>
<section>
<h2>Tên phòng</h2>
<p>Hiện ở thanh trên cùng và danh sách phòng. Tối đa ${MAX_ROOM_NAME_CHARS} ký tự, không trùng nhau.</p>
<div class="names">
${nameRows()}
</div>
</section>
<div class="actions">
<button type="submit">Lưu tên phòng</button>
<button type="button" id="names-reset" class="ghost">Tên mặc định</button>
</div>
</form>
<div id="msg" role="status" aria-live="polite"></div>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;

const hash = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

// Hashes of the exact inline blocks above: no 'unsafe-inline', nothing loaded from elsewhere.
export const ADMIN_PAGE_CSP = [
  "default-src 'none'",
  `script-src ${hash(SCRIPT)}`,
  `style-src ${hash(STYLE)}`,
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");
