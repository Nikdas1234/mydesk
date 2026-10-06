// Draws the program icon (build/icon.png, 512x512, and build/icon.ico) from the SVG below.
// Run with Electron: npm run icon
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const SIZE = 512;
// Rounded blue tile; two white orbits around a small tile in the middle.
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <rect x="24" y="24" width="464" height="464" rx="108" fill="#0071e3"/>
  <g fill="none" stroke="#ffffff" stroke-width="18">
    <ellipse cx="256" cy="256" rx="176" ry="70" transform="rotate(45 256 256)"/>
    <ellipse cx="256" cy="256" rx="176" ry="70" transform="rotate(-45 256 256)"/>
  </g>
  <rect x="216" y="216" width="80" height="80" rx="22" fill="#ffffff"/>
</svg>`;

// An .ico file that holds one PNG image (Windows accepts that since Vista).
function icoFromPng(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size === 256 ? 0 : size, 6);
  header.writeUInt8(size === 256 ? 0 : size, 7);
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${SVG}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const target = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, image.resize({ width: SIZE, height: SIZE }).toPNG());
  // For the desktop shortcut of the project (npm run shortcut).
  const ico = path.join(path.dirname(target), 'icon.ico');
  fs.writeFileSync(ico, icoFromPng(image.resize({ width: 256, height: 256 }).toPNG(), 256));
  console.log(`icon written: ${target}, ${ico}`);
  app.quit();
});
