// Wraps index.html (written for claude.ai, which adds the document shell itself)
// into a complete page you can upload to any web host: site/index.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

let body = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// Move the title and font links into <head>
const headBits = [];
body = body.replace(/^(<title>.*?<\/title>|<link [^>]*>)\r?\n/gm, m => { headBits.push(m.trim()); return ""; });

// Google Analytics (GA4). Only the hosted site gets this; the claude.ai version has none.
const GA_ID = "G-FKQX3TD3JD";
const analytics = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag("js", new Date());
gtag("config", "${GA_ID}");
</script>`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Wordpie: change one letter, make a new word, beat the clock. Play on one phone or invite friends online.">
${headBits.join("\n")}
<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style>
<script>try{var t=localStorage.getItem("wordpie.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
<script src="/firebase-config.js"></script>
${analytics}
</head>
<body>
${body}
</body>
</html>
`;
mkdirSync(new URL("./site/", import.meta.url), { recursive: true });
writeFileSync(new URL("./site/index.html", import.meta.url), page);
console.log("Wrote site/index.html");
