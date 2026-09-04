// icons.js — small hand-drawn line-icon set. No external icon library:
// keeps the prototype dependency-free and every icon themeable via
// `currentColor`, so it always renders even with no network access.
const svg = (body, vb = 24) =>
  `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  check: svg('<polyline points="20 6 9 17 4 12" stroke-width="2.6"/>'),
  x: svg('<line x1="18" y1="6" x2="6" y2="18" stroke-width="2.6"/><line x1="6" y1="6" x2="18" y2="18" stroke-width="2.6"/>'),
  shield: svg('<path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Z"/>'),
  pin: svg('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>'),
  camera: svg('<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>'),
  chevronLeft: svg('<polyline points="15 18 9 12 15 6" stroke-width="2.4"/>'),
  chevronDown: svg('<polyline points="6 9 12 15 18 9" stroke-width="2.4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="9" rx="2.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  home: svg('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 6 8 7 8-7"/>'),
  noVisit: svg('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  bank: svg('<path d="M3 10 12 4l9 6"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9"/><path d="M3 21h18"/>'),
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18" stroke-width="2.4"/>'),
  headset: svg('<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M20 19v1a3 3 0 0 1-3 3h-3"/>'),
};

export const icon = (name, cls = '') => `<span class="${cls}">${ICONS[name] || ''}</span>`;
