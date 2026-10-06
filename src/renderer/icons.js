// Line icons (24x24, stroke 1.5, currentColor), one per view.
const svg = (body) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" ' +
  'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  // light bulb
  tip: svg(
    '<path d="M9 18h6"/><path d="M10 21h4"/>' +
    '<path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  ),
  // four tiles
  overview: svg(
    '<rect x="3.75" y="3.75" width="7" height="7" rx="1.75"/>' +
      '<rect x="13.25" y="3.75" width="7" height="7" rx="1.75"/>' +
      '<rect x="3.75" y="13.25" width="7" height="7" rx="1.75"/>' +
      '<rect x="13.25" y="13.25" width="7" height="7" rx="1.75"/>',
  ),
  // envelope with a star-like mark: important mail
  important: svg(
    '<rect x="3.75" y="5.75" width="16.5" height="12.5" rx="2"/>' +
      '<path d="M4.5 7.5l7.5 5.5 7.5-5.5"/>',
  ),
  // two arrows up and down: sort mails
  sort: svg(
    '<path d="M8 4.75v14.5"/><path d="M4.75 8L8 4.75 11.25 8"/>' +
      '<path d="M16 19.25V4.75"/><path d="M12.75 16L16 19.25 19.25 16"/>',
  ),
  // stacked sheets: newsletters
  newsletters: svg(
    '<path d="M6.75 4.75h10.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-12a1.5 1.5 0 0 1 1.5-1.5z"/>' +
      '<path d="M8.5 9h7M8.5 12h7M8.5 15h4.5"/>',
  ),
  // window with a clock hand: rarely used programs
  programs: svg(
    '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2"/><path d="M3.75 8.75h16.5"/>' +
      '<path d="M12 11.5v3l2 1.25"/>',
  ),
  // three lines: show or hide the names in the navigation
  menu: svg('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>'),
  // trash can
  junk: svg(
    '<path d="M4.5 6.75h15"/><path d="M9.5 6.75V4.5h5v2.25"/>' +
      '<path d="M6.5 6.75l.75 12a1.5 1.5 0 0 0 1.5 1.4h6.5a1.5 1.5 0 0 0 1.5-1.4l.75-12"/>' +
      '<path d="M10 10.5v6M14 10.5v6"/>',
  ),
  // arrow into a tray
  downloads: svg(
    '<path d="M12 4v10.5"/><path d="M7.75 10.75L12 15l4.25-4.25"/>' +
      '<path d="M4.5 15.5v2.25a1.75 1.75 0 0 0 1.75 1.75h11.5a1.75 1.75 0 0 0 1.75-1.75V15.5"/>',
  ),
  // two overlapping sheets
  duplicates: svg(
    '<rect x="8.75" y="8.75" width="11" height="11" rx="2"/>' +
      '<path d="M15.25 5.75v-.5a1.5 1.5 0 0 0-1.5-1.5h-8a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h.5"/>',
  ),
  // sliders
  settings: svg(
    '<path d="M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9"/>' +
      '<circle cx="15.25" cy="7.5" r="2.25"/><circle cx="8.75" cy="16.5" r="2.25"/>',
  ),
  // sheet with a folded corner
  file: svg(
    '<path d="M7 3.75h6.5L18.25 8.5v10.25a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V5.25A1.5 1.5 0 0 1 7 3.75z"/>' +
      '<path d="M13.25 3.9V8.75h4.85"/>',
  ),
  // folder
  folder: svg(
    '<path d="M3.75 7.25a1.5 1.5 0 0 1 1.5-1.5h4.1l1.9 2.1h7.5a1.5 1.5 0 0 1 1.5 1.5v8.4a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5z"/>',
  ),
};
