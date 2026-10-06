// The look of the program, chosen in the settings: 'classic' (plain cards),
// 'tinted' (coloured greeting) or 'glass' (translucent cards over a coloured
// backdrop). styles.css does the rest by the class on <body>.
const STYLES = ['classic', 'tinted', 'glass'];

export function setStyle(style) {
  const chosen = STYLES.includes(style) ? style : 'classic';
  for (const name of STYLES) document.body.classList.toggle(`style-${name}`, name === chosen);
}
