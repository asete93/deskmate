import { h } from 'preact';

const svg = (paths, size = 17, stroke = 'currentColor', sw = 1.8) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML={{ __html: paths }} />
);

export const I = {
  dash: (s) => svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', s),
  chat: (s) => svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', s),
  subs: (s) => svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 14.5c2.9 0 5 2 5 5"/>', s),
  req: (s) => svg('<path d="M8 9h8"/><path d="M8 13h5"/><path d="M12 21a9 9 0 1 0-8-4.9L3 21l4.9-1A9 9 0 0 0 12 21z"/>', s),
  org: (s) => svg('<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4"/><path d="M6 16v-2h12v2"/>', s),
  git: (s, stroke) => svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7"/><path d="M15.7 9.7C13.5 12 9 12 6 12"/>', s, stroke, 2),
  tickets: (s) => svg('<path d="M6 5v11"/><path d="M12 5v6"/><path d="M18 5v14"/><path d="M3 3h18"/>', s),
  check: (s) => svg('<path d="M20 6 9 17l-5-5"/>', s),
  settings: (s) => svg('<path d="M4 8h10"/><circle cx="17" cy="8" r="2.5"/><path d="M20 16H10"/><circle cx="7" cy="16" r="2.5"/>', s),
  chevron: (s = 11, stroke = 'currentColor') => svg('<path d="m6 9 6 6 6-6"/>', s, stroke, 2.2),
  arrow: (s = 12, stroke = 'rgba(0,0,0,0.30)') => svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', s, stroke, 2),
  target: (s = 15) => svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8"/>', s),
  report: (s = 17) => svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h5"/>', s),
  folder: (s = 14) => svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>', s, '#8a6a2f'),
  files: (s) => svg('<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M13 2v7h7"/>', s),
  terminal: (s) => svg('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>', s),
  file: (s = 14) => svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', s, 'rgba(0,0,0,0.58)'),
};
