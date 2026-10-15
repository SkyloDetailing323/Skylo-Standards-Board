import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
}

function tenantPlugin(key) {
  const t = TENANTS[key]
  if (!t) throw new Error(`Unknown VITE_TENANT "${key}"`)
  const logo = `
import __mark from "./demo/dsd_mark.png";
import __wordmark from "./demo/dsd_wordmark.png";
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
        return s
      }
      let s = logo + code
      // No real backend in a demo: the data layer answers these.
      s = s.replace(/const SUPABASE_URL = "[^"]*";/, 'const SUPABASE_URL = "https://demo.invalid";')
           .replace(/const SUPABASE_ANON_KEY = "[^"]*";/, 'const SUPABASE_ANON_KEY = "demo";')
      // Their logo: the DSD mark in headers, the full wordmark on big spots.
      s = s.replace(/function Logo\(\{ h=40, color=C\.brand \}\) \{\n[^\n]*\n\}/, `function Logo({ h=40, color=C.brand }) {
  const big = h >= 60, white = color === "#fff" || color === "#ffffff";
  return <img src={big ? __wordmark : __mark} alt="Diamond State Detailing" style={{ height:big ? h*0.8 : h*0.62, width:"auto", maxWidth:"80vw", display:"block", flexShrink:0, filter:white ? "brightness(0) invert(1)" : "none" }}/>;
}`)
      s = s.replace('<div style={{ fontSize:"15px", color:"rgba(255,255,255,0.8)", marginTop:"6px", fontFamily:FONT }}>Enter your PIN</div>',
        '<div style={{ fontSize:"15px", color:"rgba(255,255,255,0.8)", marginTop:"6px", fontFamily:FONT }}>Enter your PIN</div><div style={{ fontSize:"12px", color:"rgba(255,255,255,0.75)", marginTop:"10px", fontFamily:FONT, background:"rgba(0,0,0,0.18)", padding:"6px 12px", borderRadius:"980px" }}>Demo · 1111 owner · 2222 manager · 3333 team lead</div>')
      for (const [a, b] of t.text) s = s.split(a).join(b)
      for (const [a, b] of t.colors) s = s.split(a).join(b).split(a.toUpperCase()).join(b)
      return s
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
