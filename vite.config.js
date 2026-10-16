import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { BLOCKS as MVP_BLOCKS, TEXT as MVP_TEXT } from './demo/mvp_overrides.mjs'

// Demo builds for other companies: VITE_TENANT=dsd npx vite build
// The normal build (Skylo's live app) is untouched -- the tenant plugin only
// runs when VITE_TENANT is set. It rebrands the app at build time (name,
// colors, logo), strips Skylo's database address and key, and loads the
// made-up data layer in demo/ so nothing real is reachable from a demo.
const TENANTS = {
  dsd: {
    title: "Diamond State Command Center",
    short: "DSD Board",
    theme: "#2b65a3",
    outDir: "dist-dsd",
    logo: ["dsd_mark.png", "dsd_wordmark.png"], alt: "Diamond State Detailing",
    text: [
      ["Skylo Standard Board", "Diamond State Command Center"],
      ["The Standard Board", "Diamond State Command Center"],
      ["Skylo Cash", "DSD Cash"],
      ["with Skylo", "with Diamond State"],
      ["Skylo rewards program", "Diamond State rewards program"],
      ["searched Skylo by name", "searched Diamond State by name"],
      ["Skylo (or Squeegee Boys)", "Diamond State"],
      ["Trevor", "Ryan"], ["Ethan", "Cole"], ["sold by trevor", "sold by ryan"],
      ["Squeegee Boys", "Diamond State"], ["Skylo", "Diamond State"], ["Utah", "Arkansas"], ["skylod.com", "diamondstatedetailers.com"],
    ],
    colors: [
      ["#0092f9", "#2b65a3"], ["#0077d4", "#1f4f84"], ["#005fb0", "#1a426f"],
      ["#eaf3ff", "#e8eff8"], ["#f5f9ff", "#f4f7fb"], ["#2aa8ff", "#5381bc"], ["#0072d1", "#173a63"],
    ],
  },
  // MVP Cleaning (house cleaners, American Fork UT). Black and white like their logo.
  mvp: {
    title: "MVP Command Center",
    short: "MVP Board",
    theme: "#26262a",
    outDir: "dist-mvp",
    logo: ["mvp_mark.svg", "mvp_wordmark.svg"], alt: "MVP Cleaning",
    text: MVP_TEXT,
    blocks: MVP_BLOCKS,
    words: true,
    colors: [
      ["#0092f9", "#26262a"], ["#0077d4", "#18181b"], ["#005fb0", "#111113"],
      ["#eaf3ff", "#efeff1"], ["#f5f9ff", "#f7f7f8"], ["#2aa8ff", "#5a5a63"], ["#0072d1", "#0b0b0c"],
    ],
  },
}

// Swap a whole top-level \`const NAME = [ ... ];\` / \`{ ... };\` block.
function swapConst(s, name, src) {
  const i = s.indexOf(`const ${name} = `)
  if (i < 0) throw new Error(`tenant: ${name} not found`)
  const end = s.indexOf(s[i + name.length + 9] === "[" ? "\n];" : "\n};", i)
  return s.slice(0, i) + src + s.slice(end + 3)
}

// Truck -> Car in words people read only (strings and JSX text), never code names.
function truckWords(s) {
  const swap = t => t.replace(/\bTrucks\b/g, "Cars").replace(/\bTruck\b/g, "Car")
    .replace(/(\s)trucks\b/g, "$1cars").replace(/(\s)truck\b/g, "$1car").replace(/\bunit\/truck\b/g, "car")
  return s.replace(/"(?:[^"\\\n]|\\.)*"/g, swap).replace(/>([^<>{}\n]*)</g, (m, t) => ">" + swap(t) + "<")
}

function tenantPlugin(key) {
  const t = TENANTS[key]
  if (!t) throw new Error(`Unknown VITE_TENANT "${key}"`)
  const logo = `
import __mark from "./demo/${t.logo[0]}";
import __wordmark from "./demo/${t.logo[1]}";
`
  return {
    name: 'tenant-demo',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/main.jsx')) return `import "./demo/install.js";\n${code}`
      if (id.includes('node_modules') || id.includes('/demo/') || !/\.(jsx?|mjs)$/.test(id)) return null
      if (!id.endsWith('/App.jsx')) {
        // Other app modules (scoring files): just the names and colors.
        let s = code
        for (const [a, b] of t.text) s = s.split(a).join(b)
        for (const [a, b] of t.colors) s = s.split(a).join(b)
        return t.words ? truckWords(s) : s
      }
      let s = logo + code
      for (const [name, src] of Object.entries(t.blocks || {})) s = swapConst(s, name, src)
      // No real backend in a demo: the data layer answers these.
      s = s.replace(/const SUPABASE_URL = "[^"]*";/, 'const SUPABASE_URL = "https://demo.invalid";')
           .replace(/const SUPABASE_ANON_KEY = "[^"]*";/, 'const SUPABASE_ANON_KEY = "demo";')
      // Their logo: the DSD mark in headers, the full wordmark on big spots.
      s = s.replace(/function Logo\(\{ h=40, color=C\.brand \}\) \{\n[^\n]*\n\}/, `function Logo({ h=40, color=C.brand }) {
  const big = h >= 60, white = color === "#fff" || color === "#ffffff";
  return <img src={big ? __wordmark : __mark} alt="${t.alt}" style={{ height:big ? h*0.8 : h*0.62, width:"auto", maxWidth:"80vw", display:"block", flexShrink:0, filter:white ? "brightness(0) invert(1)" : "none" }}/>;
}`)
      s = s.replace('<div style={{ fontSize:"15px", color:"rgba(255,255,255,0.8)", marginTop:"6px", fontFamily:FONT }}>Enter your PIN</div>',
        '<div style={{ fontSize:"15px", color:"rgba(255,255,255,0.8)", marginTop:"6px", fontFamily:FONT }}>Enter your PIN</div><div style={{ fontSize:"12px", color:"rgba(255,255,255,0.75)", marginTop:"10px", fontFamily:FONT, background:"rgba(0,0,0,0.18)", padding:"6px 12px", borderRadius:"980px" }}>Demo · 1111 owner · 2222 manager · 3333 team lead</div>')
      for (const [a, b] of t.text) s = s.split(a).join(b)
      for (const [a, b] of t.colors) s = s.split(a).join(b).split(a.toUpperCase()).join(b)
      return t.words ? truckWords(s) : s
    },
    transformIndexHtml(html) {
      return html.replace(/<title>[^<]*<\/title>/, `<title>${t.title}</title>`)
        .replace(/content="Skylo Board"/, `content="${t.short}"`).replace(/content="#0092f9"/, `content="${t.theme}"`)
    },
  }
}

const tenant = process.env.VITE_TENANT

export default defineConfig({
  plugins: [react(), ...(tenant ? [tenantPlugin(tenant)] : [])],
  ...(tenant ? { build: { outDir: TENANTS[tenant].outDir } } : {}),
})
