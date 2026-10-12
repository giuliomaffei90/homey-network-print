'use strict';
const fs = require('node:fs');
// Build-only renderer; never installed or required on Homey.
const { Resvg } = require('/tmp/networkprint-art-tools/node_modules/@resvg/resvg-js');
const deviceIcon = fs.readFileSync('assets/icon.svg','utf8');
fs.writeFileSync('drivers/printer/assets/icon.svg',deviceIcon);
const printer = `<g><rect x="116" y="302" width="272" height="20" rx="10" fill="#163463" opacity=".08"/><rect x="112" y="170" width="276" height="135" rx="25" fill="#dce5f1"/><rect x="112" y="158" width="276" height="130" rx="25" fill="#fdfefe" stroke="#bbcce0" stroke-width="3"/><rect x="137" y="185" width="226" height="30" rx="8" fill="#eaf0f8"/><rect x="165" y="68" width="170" height="131" rx="6" fill="#fff" stroke="#bbcce0" stroke-width="3"/><path d="M191 98h94M191 115h114M191 132h74" stroke="#b5c6de" stroke-width="7" stroke-linecap="round"/><circle cx="352" cy="238" r="7" fill="#2c72ec"/><rect x="149" y="246" width="201" height="13" rx="6.5" fill="#1d355c"/><path d="M166 252h168v109a7 7 0 0 1-7 7H173a7 7 0 0 1-7-7z" fill="#fff" stroke="#c1cee0" stroke-width="2"/><rect x="180" y="270" width="140" height="78" rx="4" fill="#d8eaff"/><circle cx="294" cy="287" r="10" fill="#f4b658"/><path d="m180 332 41-44 44 44 26-28 29 27v17H180z" fill="#3973bd"/><path d="m180 345 42-25 45 28z" fill="#245595"/></g>`;
for(const [name,w,h] of [['small',250,175],['large',500,350],['xlarge',1000,700]]){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 500 350"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#edf4ff"/><stop offset="1" stop-color="#d6e5fb"/></linearGradient></defs><rect width="500" height="350" fill="url(#bg)"/><circle cx="415" cy="53" r="156" fill="#fff" opacity=".38"/><g transform="translate(64,-5) scale(.75)">${printer}</g><rect x="28" y="28" width="39" height="5" rx="2.5" fill="#2863df"/><text x="28" y="321" font-family="Arial" font-size="17" font-weight="700" fill="#203f6e">Network Print</text><text x="473" y="321" text-anchor="end" font-family="Arial" font-size="11" fill="#4b6386">TESTO · IMMAGINI · FLOW</text></svg>`;
 fs.writeFileSync(`assets/images/${name}.png`,new Resvg(svg).render().asPng());
}
for(const [name,size] of [['small',75],['large',500],['xlarge',1000]]){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 500 500"><rect width="500" height="500" fill="#fff"/><g transform="translate(-12,8) scale(1.05)">${printer}</g></svg>`;
 fs.writeFileSync(`drivers/printer/assets/images/${name}.png`,new Resvg(svg).render().asPng());
}
