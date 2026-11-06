// Line icons from design/game.html (24×24, stroke = currentColor). Decorative: the button carries the label.
const svg = (body: string, stroke = "1.5"): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  exit: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10"/>'),
  temple: svg(
    '<path d="M3 10.5c4-.6 7-3 9-6 2 3 5 5.4 9 6M5 11.5h14M7.5 12v7.5m9-7.5v7.5M4.5 19.5h15M10.5 14.5h3v5"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>',
    "1.2",
  ),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  chevron: svg('<path d="m7 10 5 5 5-5"/>'),
  offering: svg('<path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0m5 0c2-4 6-3 5 0"/>'),
  invite: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 9.5-4.9M18 14v6M15 17h6"/>'),
  people: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a9 9 0 0 0-3-5"/>'),
  muted: svg('<path d="m10 5-5 4H2v6h3l5 4V5Z"/><path d="m16 9 5 6m0-6-5 6"/>'),
  sound: svg('<path d="m10 5-5 4H2v6h3l5 4V5Z"/><path d="M14.5 8.5a5 5 0 0 1 0 7M17.5 5.5a9 9 0 0 1 0 13"/>'),
  settings: svg('<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="17" r="2" fill="currentColor"/>'),
  hello: svg('<path d="M12 21V6.5a1.5 1.5 0 0 0-3 0L7 13l-2 3 3 5h4Zm0 0V6.5a1.5 1.5 0 0 1 3 0L17 13l2 3-3 5h-4"/>'),
  bow: svg('<circle cx="12" cy="6" r="2.5"/><path d="M5 20c0-4 3-7 7-7s7 3 7 7M8 20h8"/>'),
  beads: svg(
    '<circle cx="12" cy="4.5" r="1.6"/><circle cx="17.3" cy="6.7" r="1.6"/><circle cx="19.5" cy="12" r="1.6"/><circle cx="17.3" cy="17.3" r="1.6"/><circle cx="6.7" cy="6.7" r="1.6"/><circle cx="4.5" cy="12" r="1.6"/><circle cx="6.7" cy="17.3" r="1.6"/><path d="M12 17v4"/>',
  ),
  woodblock: svg(
    '<path d="M4.5 12.5a7.5 7.5 0 0 1 15 0c0 3-2.4 5-5.8 5H10.3c-3.4 0-5.8-2-5.8-5Z"/><circle cx="9.5" cy="11.5" r="1.1" fill="currentColor"/><path d="M13.2 13h6"/><path d="M6 20h12"/>',
  ),
  gestures: svg(
    '<path d="M12 4.5c2 2.8 2.8 5.6 0 8.5-2.8-2.9-2-5.7 0-8.5Z"/><path d="M12 13c2.6-1.8 5.4-1.8 7.5.5-1.8 2.6-4.5 3.2-7.5-.5Z"/><path d="M12 13c-2.6-1.8-5.4-1.8-7.5.5 1.8 2.6 4.5 3.2 7.5-.5Z"/><path d="M7 18.5h10"/>',
  ),
  chat: svg('<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" stroke-width="2.2"/>'),
  chatOff: svg('<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4Z"/><path d="M3 3l18 18"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
} as const;
