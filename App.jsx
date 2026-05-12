import { useState, useEffect } from "react";

const LOGO_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 50'%3E%3Crect width='200' height='50' fill='%23009cff' rx='4'/%3E%3Ctext x='100' y='34' font-family='monospace' font-size='22' font-weight='900' fill='white' text-anchor='middle'%3ESKYLO%3C/text%3E%3C/svg%3E";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const blue = "#009cff";
const bg   = "#ffffff";
const card = "#f4f8fd";
const bord = "#d0e8ff";
const dark = "#0a1a2e";
const muted = "#6b8aaa";
const ADMIN_PIN = "0000";

const BADGE_DEFS = [
  { id:"day_one",        cat:"Tenure",      name:"Day One",           icon:"🔑", pts:50,   desc:"Completed first day on the job" },
  { id:"thirty_days",   cat:"Tenure",      name:"30-Day Survivor",   icon:"📅", pts:100,  desc:"First 30 days completed" },
  { id:"ninety_days",   cat:"Tenure",      name:"Quarter Strong",    icon:"📆", pts:200,  desc:"90 days on the team" },
  { id:"one_year",      cat:"Tenure",      name:"One Year Legend",   icon:"🏅", pts:500,  desc:"First full year — booklet unlocked" },
  { id:"two_year",      cat:"Tenure",      name:"Two Year Veteran",  icon:"🎖️", pts:750,  desc:"Two years of excellence" },
  { id:"five_year",     cat:"Tenure",      name:"Five Year Elite",   icon:"👑", pts:1500, desc:"Five years — rare and honored" },
  { id:"zero_callback", cat:"Performance", name:"Zero Callbacks",    icon:"✅", pts:300,  desc:"Month with zero callbacks" },
  { id:"clean_streak",  cat:"Performance", name:"Clean Streak",      icon:"🔥", pts:600,  desc:"3 months straight, no callbacks" },
  { id:"five_star",     cat:"Performance", name:"5-Star Tech",       icon:"⭐", pts:150,  desc:"First 5-star customer review" },
  { id:"review_machine",cat:"Performance", name:"Review Machine",    icon:"🌟", pts:400,  desc:"10 five-star reviews earned" },
  { id:"most_booked",   cat:"Performance", name:"Most Booked",       icon:"📈", pts:350,  desc:"Top revenue tech of the month" },
  { id:"certified",     cat:"Skills",      name:"Certified",         icon:"📜", pts:250,  desc:"First certification earned" },
  { id:"double_cert",   cat:"Skills",      name:"Double Certified",  icon:"🎓", pts:400,  desc:"Two certifications completed" },
  { id:"multi_trade",   cat:"Skills",      name:"Multi-Trade",       icon:"🛠️", pts:500,  desc:"Trained in more than one trade" },
  { id:"mentor",        cat:"Skills",      name:"Mentor",            icon:"🤝", pts:450,  desc:"Trained or onboarded a new tech" },
  { id:"never_late",    cat:"Character",   name:"Never Late",        icon:"⏰", pts:200,  desc:"Perfect punctuality all quarter" },
  { id:"safety_first",  cat:"Character",   name:"Safety First",      icon:"🦺", pts:100,  desc:"Proactive safety report" },
  { id:"problem_solver",cat:"Character",   name:"Problem Solver",    icon:"💡", pts:300,  desc:"Idea adopted by the team" },
  { id:"team_player",   cat:"Character",   name:"Team Player",       icon:"🫂", pts:150,  desc:"Covered for a teammate" },
  { id:"culture_carrier",cat:"Character",  name:"Culture Carrier",   icon:"🏆", pts:500,  desc:"Peer-nominated quarterly" },
];
const BADGE_MAP = Object.fromEntries(BADGE_DEFS.map(b => [b.id, b]));

const SERVICE_PLANS = [
  { id:"biannual",  label:"Bi-Annual",  freq:"2x/year",        value:2,  pts:10 },
  { id:"quarterly", label:"Quarterly",  freq:"4x/year",        value:4,  pts:20 },
  { id:"bimonthly", label:"Bi-Monthly", freq:"Every 2 months", value:6,  pts:30 },
  { id:"monthly",   label:"Monthly",    freq:"12x/year",       value:12, pts:50 },
  { id:"biweekly",  label:"Bi-Weekly",  freq:"Every 2 weeks",  value:26, pts:60 },
  { id:"weekly",    label:"Weekly",     freq:"52x/year",       value:52, pts:70 },
];
const PLAN_MAP = Object.fromEntries(SERVICE_PLANS.map(p => [p.id, p]));
const PLAN_COLORS = { biannual:"#10b981", quarterly:"#3b82f6", bimonthly:"#8b5cf6", monthly:"#009cff", biweekly:"#f59e0b", weekly:"#ef4444" };

const SEED_TECHS = [
  { id:"t1", name:"Max Hancock",    pin:"1111", avatar:"MH", badges:["day_one"] },
  { id:"t2", name:"Milos Lewit",    pin:"1112", avatar:"ML", badges:["day_one"] },
  { id:"t3", name:"Kade Andrew",    pin:"1113", avatar:"KA", badges:["day_one"] },
  { id:"t4", name:"Riley Lyon",     pin:"1114", avatar:"RL", badges:["day_one"] },
  { id:"t5", name:"Caleb McDaniel", pin:"1115", avatar:"CM", badges:["day_one"] },
  { id:"t6", name:"Will Faulkner",  pin:"1116", avatar:"WF", badges:["day_one"] },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const calcPoints = (badges) => badges.reduce((s,id) => s + (BADGE_MAP[id]?.pts || 0), 0);
const calcUpsellPts = (upsells, techId) => Object.values(upsells).reduce((s,w) => s + (w[techId]||0), 0);
const calcSwitchPts = (switchovers, techId) => Object.values(switchovers).flatMap(w => w[techId]||[]).reduce((s,e) => s + (PLAN_MAP[e.plan]?.pts||0), 0);
const calcTotalPts = (tech, upsells, switchovers) => calcPoints(tech.badges) + calcUpsellPts(upsells, tech.id) + calcSwitchPts(switchovers, tech.id);
const getRank = (pts) => pts >= 2000 ? { label:"Elite", color:"#7c3aed" } : pts >= 1000 ? { label:"Pro", color:blue } : pts >= 500 ? { label:"Rising", color:"#10b981" } : { label:"Rookie", color:muted };
const medal = (i) => i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;

function getWeekKey() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  return `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}-${String(start.getDate()).padStart(2,"0")}`;
}
function formatWeekLabel(key) {
  const d = new Date(key + "T00:00:00");
  const end = new Date(d); end.setDate(d.getDate()+6);
  const fmt = (dt) => dt.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return `${fmt(d)} – ${fmt(end)}`;
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────
async function loadKey(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}
async function saveKey(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── LOGO ─────────────────────────────────────────────────────────────────────
function Logo({ height=44 }) {
  return <img src={LOGO_SRC} alt="Skylo Detailing" style={{ height:`${height}px`, objectFit:"contain" }} />;
}

// ─── HEADER ───────────────────────────────────────────────────────────────────
function Header({ right, title }) {
  return (
    <div style={{ background:"#fff", borderBottom:`1px solid ${bord}`, padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
        <Logo height={36} />
        {title && <span style={{ fontWeight:"800", fontSize:"15px", color:dark, letterSpacing:"-0.3px" }}>{title}</span>}
      </div>
      {right}
    </div>
  );
}

// ─── LOGOUT BTN ───────────────────────────────────────────────────────────────
function LogoutBtn({ onLogout }) {
  return <button onClick={onLogout} style={{ background:"none", border:`1px solid ${bord}`, color:muted, padding:"6px 14px", borderRadius:"6px", cursor:"pointer", fontSize:"12px", fontFamily:"monospace" }}>LOG OUT</button>;
}

// ─── TAB BAR ──────────────────────────────────────────────────────────────────
function TabBar({ tabs, active, setActive, accentColor }) {
  const ac = accentColor || blue;
  return (
    <div style={{ display:"flex", borderBottom:`1px solid ${bord}`, background:"#fff", padding:"0 12px", overflowX:"auto", WebkitOverflowScrolling:"touch", scrollbarWidth:"none" }}>
      {tabs.map(([id,label]) => (
        <button key={id} onClick={() => setActive(id)} style={{
          background:"none", border:"none", cursor:"pointer", whiteSpace:"nowrap",
          padding:"12px 14px", fontSize:"11px", letterSpacing:"0.5px", textTransform:"uppercase",
          fontFamily:"monospace", color: active===id ? ac : muted, flexShrink:0,
          borderBottom: active===id ? `2px solid ${ac}` : "2px solid transparent",
        }}>{label}</button>
      ))}
    </div>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }) {
  return (
    <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"18px" }}>
      <div style={{ fontSize:"10px", color:muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"monospace", marginBottom:"8px" }}>{label}</div>
      <div style={{ fontSize:"26px", fontWeight:"900", color: color||dark }}>{value}</div>
    </div>
  );
}

// ─── PIN PAD ──────────────────────────────────────────────────────────────────
function PinPad({ onSubmit }) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (pin.length === 4) {
      const ok = onSubmit(pin);
      if (!ok) { setShake(true); setTimeout(() => { setShake(false); setPin(""); }, 600); }
    }
  }, [pin]);
  const press = (d) => { if (pin.length < 4) setPin(p => p+d); };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"28px" }}>
      <div style={{ fontSize:"12px", letterSpacing:"3px", color:muted, textTransform:"uppercase", fontFamily:"monospace" }}>Enter PIN</div>
      <div style={{ display:"flex", gap:"16px", animation: shake?"shake 0.4s ease":"none" }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width:"16px", height:"16px", borderRadius:"50%", background: i<pin.length ? blue : "transparent", border:`2px solid ${i<pin.length ? blue : bord}`, transition:"all 0.15s" }} />
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 70px)", gap:"10px" }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i) => (
          <button key={i} onClick={() => d==="⌫" ? setPin(p=>p.slice(0,-1)) : d!=="" ? press(String(d)) : null}
            disabled={d===""}
            style={{ width:"70px", height:"70px", borderRadius:"8px", background: d===""?"transparent":card, border: d===""?"none":`1px solid ${bord}`, color: d==="⌫"?muted:dark, fontSize: d==="⌫"?"18px":"20px", fontWeight:"600", cursor: d===""?"default":"pointer", fontFamily:"monospace" }}>
            {d}
          </button>
        ))}
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

// ─── BADGE GRID ───────────────────────────────────────────────────────────────
function BadgeGrid({ earned }) {
  return (
    <div>
      {["Tenure","Performance","Skills","Character"].map(cat => (
        <div key={cat} style={{ marginBottom:"28px" }}>
          <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"10px" }}>{cat}</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(190px,1fr))", gap:"10px" }}>
            {BADGE_DEFS.filter(b => b.cat===cat).map(b => {
              const has = earned.includes(b.id);
              return (
                <div key={b.id} style={{ background: has?"#e6f4ff":card, border:`1px solid ${has?blue+"55":bord}`, borderRadius:"8px", padding:"14px", opacity: has?1:0.45, position:"relative" }}>
                  {!has && <div style={{ position:"absolute", top:"10px", right:"10px", fontSize:"11px" }}>🔒</div>}
                  <div style={{ fontSize:"22px", marginBottom:"6px" }}>{b.icon}</div>
                  <div style={{ fontWeight:"700", fontSize:"13px", color:dark, marginBottom:"3px" }}>{b.name}</div>
                  <div style={{ fontSize:"11px", color:muted, marginBottom:"6px" }}>{b.desc}</div>
                  <div style={{ fontSize:"11px", fontFamily:"monospace", color: has?blue:muted }}>+{b.pts} pts</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── BADGE LEADERBOARD ────────────────────────────────────────────────────────
function BadgeLeaderboard({ techs, currentId }) {
  const sorted = [...techs].sort((a,b) => calcPoints(b.badges)-calcPoints(a.badges));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      {sorted.map((t,idx) => {
        const pts = calcPoints(t.badges);
        const rank = getRank(pts);
        const isMe = t.id===currentId;
        const earned = BADGE_DEFS.filter(b => t.badges.includes(b.id));
        return (
          <div key={t.id} style={{ background: isMe?"#e6f4ff":card, border:`1px solid ${isMe?blue:bord}`, borderRadius:"10px", padding:"16px 18px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom: earned.length>0?"12px":"0" }}>
              <div style={{ width:"30px", textAlign:"center", fontSize: idx<3?"20px":"13px", color:muted, fontFamily:"monospace", fontWeight:"700" }}>{medal(idx)}</div>
              <div style={{ width:"40px", height:"40px", borderRadius:"50%", background:`${blue}22`, border:`1px solid ${blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:blue, fontFamily:"monospace", flexShrink:0 }}>{t.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name} {isMe && <span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}>YOU</span>}</div>
                <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}><span style={{ color:rank.color, fontWeight:"700" }}>{rank.label}</span> · {t.badges.length} badges</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:"22px", fontWeight:"900", color:dark }}>{pts.toLocaleString()}</div>
                <div style={{ fontSize:"11px", color:muted, fontFamily:"monospace" }}>pts</div>
              </div>
            </div>
            {earned.length>0 && (
              <div style={{ borderTop:`1px solid ${isMe?blue+"33":bord}`, paddingTop:"10px", display:"flex", flexWrap:"wrap", gap:"6px" }}>
                {earned.map(b => (
                  <div key={b.id} style={{ display:"flex", alignItems:"center", gap:"4px", background: isMe?"#cce8ff":"#eef6ff", border:`1px solid ${blue}33`, borderRadius:"4px", padding:"3px 8px", fontSize:"11px", color:dark }}>
                    <span>{b.icon}</span><span>{b.name}</span><span style={{ color:blue, fontFamily:"monospace" }}>+{b.pts}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── UPSELL LEADERBOARD ───────────────────────────────────────────────────────
function UpsellLeaderboard({ techs, upsells, currentId }) {
  const wk = getWeekKey();
  const wkData = upsells[wk] || {};
  const allWeeks = Object.keys(upsells).sort((a,b) => b.localeCompare(a));
  const ranked = [...techs].map(t => ({
    ...t,
    thisWeek: wkData[t.id]||0,
    allTime: Object.values(upsells).reduce((s,w) => s+(w[t.id]||0),0),
  })).sort((a,b) => b.thisWeek-a.thisWeek);
  const top = ranked[0]?.thisWeek||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div>
        <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>This Week · {formatWeekLabel(wk)}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {ranked.map((t,idx) => {
            const isMe = t.id===currentId;
            const pct = top>0 ? Math.round((t.thisWeek/top)*100) : 0;
            return (
              <div key={t.id} style={{ background: isMe?"#e6f4ff":card, border:`1px solid ${isMe?blue:bord}`, borderRadius:"10px", padding:"16px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"10px" }}>
                  <div style={{ width:"30px", textAlign:"center", fontSize:idx<3?"20px":"13px", color:muted, fontFamily:"monospace", fontWeight:"700" }}>{medal(idx)}</div>
                  <div style={{ width:"40px", height:"40px", borderRadius:"50%", background:`${blue}22`, border:`1px solid ${blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:blue, fontFamily:"monospace", flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name} {isMe && <span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}>YOU</span>}</div>
                    <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}>All-time: ${t.allTime.toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:"22px", fontWeight:"900", color: t.thisWeek>0?dark:bord }}>${t.thisWeek.toLocaleString()}</div>
                    <div style={{ fontSize:"11px", color:blue, fontFamily:"monospace" }}>+{t.thisWeek.toLocaleString()} pts</div>
                  </div>
                </div>
                <div style={{ background:bord, borderRadius:"4px", height:"5px", overflow:"hidden" }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${blue},#0066cc)`, borderRadius:"4px" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {allWeeks.length>1 && (
        <div>
          <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>Weekly History</div>
          <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
            {allWeeks.filter(w=>w!==wk).map(w => {
              const d = upsells[w]||{};
              const rows = [...techs].map(t=>({...t,amt:d[t.id]||0})).filter(t=>t.amt>0).sort((a,b)=>b.amt-a.amt);
              const total = rows.reduce((s,t)=>s+t.amt,0);
              return (
                <div key={w} style={{ background:card, border:`1px solid ${bord}`, borderRadius:"10px", overflow:"hidden" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${bord}`, background:"#eef6ff" }}>
                    <div style={{ fontWeight:"700", fontSize:"13px", color:dark }}>{formatWeekLabel(w)}</div>
                    <div style={{ fontFamily:"monospace", color:blue, fontWeight:"700", fontSize:"13px" }}>Total: ${total.toLocaleString()}</div>
                  </div>
                  <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:"5px" }}>
                    {rows.map((t,i)=>(
                      <div key={t.id} style={{ display:"flex", justifyContent:"space-between" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px" }}><span>{medal(i)}</span><span style={{ fontSize:"13px", color:dark }}>{t.name}</span></div>
                        <span style={{ fontFamily:"monospace", fontWeight:"700", fontSize:"13px", color:dark }}>${t.amt.toLocaleString()}</span>
                      </div>
                    ))}
                    {rows.length===0 && <div style={{ fontSize:"12px", color:muted }}>No data</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SWITCHOVER LEADERBOARD ───────────────────────────────────────────────────
function SwitchoverLeaderboard({ techs, switchovers, currentId }) {
  const [rankBy, setRankBy] = useState("count");
  const wk = getWeekKey();
  const wkData = switchovers[wk] || {};
  const allWeeks = Object.keys(switchovers).sort((a,b) => b.localeCompare(a));
  const ranked = [...techs].map(t => {
    const entries = wkData[t.id]||[];
    const allE = Object.values(switchovers).flatMap(w => w[t.id]||[]);
    return {
      ...t,
      count: entries.length,
      value: entries.reduce((s,e) => s+(PLAN_MAP[e.plan]?.value||0),0),
      allCount: allE.length,
      allValue: allE.reduce((s,e) => s+(PLAN_MAP[e.plan]?.value||0),0),
      entries,
    };
  }).sort((a,b) => rankBy==="count" ? b.count-a.count : b.value-a.value);
  const top = ranked[0]?.[rankBy]||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
          <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase" }}>This Week · {formatWeekLabel(wk)}</div>
          <div style={{ display:"flex", gap:"6px" }}>
            {[["count","# Converts"],["value","Plan Value"]].map(([id,label]) => (
              <button key={id} onClick={() => setRankBy(id)} style={{ background: rankBy===id?blue:card, border:`1px solid ${rankBy===id?blue:bord}`, color: rankBy===id?"#fff":muted, padding:"4px 10px", borderRadius:"4px", cursor:"pointer", fontSize:"11px", fontFamily:"monospace" }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {ranked.map((t,idx) => {
            const isMe = t.id===currentId;
            const pct = top>0 ? Math.round((t[rankBy]/top)*100) : 0;
            return (
              <div key={t.id} style={{ background: isMe?"#e6f4ff":card, border:`1px solid ${isMe?blue:bord}`, borderRadius:"10px", padding:"16px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"10px" }}>
                  <div style={{ width:"30px", textAlign:"center", fontSize:idx<3?"20px":"13px", color:muted, fontFamily:"monospace", fontWeight:"700" }}>{medal(idx)}</div>
                  <div style={{ width:"40px", height:"40px", borderRadius:"50%", background:`${blue}22`, border:`1px solid ${blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:blue, fontFamily:"monospace", flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name} {isMe && <span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}>YOU</span>}</div>
                    <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}>All-time: {t.allCount} converts · {t.allValue} visits/yr</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:"22px", fontWeight:"900", color: t.count>0?dark:bord }}>{t.count}</div>
                    <div style={{ fontSize:"11px", color:muted, fontFamily:"monospace" }}>{t.value} visits/yr</div>
                  </div>
                </div>
                <div style={{ background:bord, borderRadius:"4px", height:"5px", overflow:"hidden", marginBottom: t.entries.length>0?"10px":"0" }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${blue},#0066cc)`, borderRadius:"4px" }} />
                </div>
                {t.entries.length>0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                    {t.entries.map((e,i) => {
                      const plan = PLAN_MAP[e.plan];
                      const pc = PLAN_COLORS[e.plan]||muted;
                      return plan ? (
                        <div key={i} style={{ background:"#fff", border:`1px solid ${pc}44`, borderLeft:`3px solid ${pc}`, borderRadius:"4px", padding:"2px 8px", fontSize:"11px", color:dark, fontFamily:"monospace" }}>
                          {plan.label} · {plan.freq}
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"14px 18px" }}>
        <div style={{ fontSize:"11px", letterSpacing:"2px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"10px" }}>Plan Tiers</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
          {SERVICE_PLANS.map(p => (
            <div key={p.id} style={{ background:"#fff", border:`1px solid ${PLAN_COLORS[p.id]}44`, borderLeft:`3px solid ${PLAN_COLORS[p.id]}`, borderRadius:"4px", padding:"3px 10px", fontSize:"12px", display:"flex", gap:"8px", alignItems:"center" }}>
              <span style={{ fontWeight:"700", color:dark }}>{p.label}</span>
              <span style={{ color:muted }}>{p.freq}</span>
              <span style={{ color:blue, fontFamily:"monospace", fontWeight:"700" }}>+{p.pts}pts</span>
            </div>
          ))}
        </div>
      </div>
      {allWeeks.length>1 && (
        <div>
          <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>Weekly History</div>
          <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
            {allWeeks.filter(w=>w!==wk).map(w => {
              const d = switchovers[w]||{};
              const rows = [...techs].map(t=>({ ...t, entries:(d[t.id]||[]) })).filter(t=>t.entries.length>0).sort((a,b)=>b.entries.length-a.entries.length);
              const total = rows.reduce((s,t)=>s+t.entries.length,0);
              return (
                <div key={w} style={{ background:card, border:`1px solid ${bord}`, borderRadius:"10px", overflow:"hidden" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${bord}`, background:"#eef6ff" }}>
                    <div style={{ fontWeight:"700", fontSize:"13px", color:dark }}>{formatWeekLabel(w)}</div>
                    <div style={{ fontFamily:"monospace", color:blue, fontWeight:"700", fontSize:"13px" }}>{total} converts</div>
                  </div>
                  <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:"6px" }}>
                    {rows.map((t,i) => (
                      <div key={t.id}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"3px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:"6px" }}><span>{medal(i)}</span><span style={{ fontSize:"13px", fontWeight:"600", color:dark }}>{t.name}</span></div>
                          <span style={{ fontFamily:"monospace", fontWeight:"700", fontSize:"13px", color:dark }}>{t.entries.length} converts</span>
                        </div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:"3px", paddingLeft:"24px" }}>
                          {t.entries.map((e,j) => {
                            const plan = PLAN_MAP[e.plan];
                            const pc = PLAN_COLORS[e.plan]||muted;
                            return plan ? <div key={j} style={{ fontSize:"10px", background:"#fff", border:`1px solid ${pc}33`, borderLeft:`2px solid ${pc}`, borderRadius:"3px", padding:"1px 6px", color:muted, fontFamily:"monospace" }}>{plan.label}</div> : null;
                          })}
                        </div>
                      </div>
                    ))}
                    {rows.length===0 && <div style={{ fontSize:"12px", color:muted }}>No conversions recorded</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── TOTAL LEADERBOARD ────────────────────────────────────────────────────────
function TotalLeaderboard({ techs, upsells, switchovers, currentId }) {
  const ranked = [...techs].map(t => {
    const badgePts = calcPoints(t.badges);
    const upsellPts = calcUpsellPts(upsells, t.id);
    const switchPts = calcSwitchPts(switchovers, t.id);
    const total = badgePts + upsellPts + switchPts;
    return { ...t, badgePts, upsellPts, switchPts, total };
  }).sort((a,b) => b.total - a.total);

  const top = ranked[0]?.total || 1;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      {ranked.map((t, idx) => {
        const isMe = t.id === currentId;
        const pct = Math.round((t.total / top) * 100);
        const rank = getRank(t.total);
        return (
          <div key={t.id} style={{ background: isMe?"#e6f4ff":card, border:`1px solid ${isMe?blue:bord}`, borderRadius:"10px", padding:"16px 18px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"12px" }}>
              <div style={{ width:"30px", textAlign:"center", fontSize:idx<3?"20px":"13px", color:muted, fontFamily:"monospace", fontWeight:"700" }}>{medal(idx)}</div>
              <div style={{ width:"40px", height:"40px", borderRadius:"50%", background:`${blue}22`, border:`1px solid ${blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:blue, fontFamily:"monospace", flexShrink:0 }}>{t.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name} {isMe && <span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}>YOU</span>}</div>
                <div style={{ fontSize:"11px", color:rank.color, fontFamily:"monospace", fontWeight:"700" }}>{rank.label}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:"24px", fontWeight:"900", color:dark, letterSpacing:"-0.5px" }}>{t.total.toLocaleString()}</div>
                <div style={{ fontSize:"11px", color:muted, fontFamily:"monospace" }}>total pts</div>
              </div>
            </div>
            {/* Progress bar */}
            <div style={{ background:bord, borderRadius:"4px", height:"6px", overflow:"hidden", marginBottom:"10px" }}>
              <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${blue},#0066cc)`, borderRadius:"4px", transition:"width 1s ease" }} />
            </div>
            {/* Breakdown */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px" }}>
              {[
                { label:"🏅 Badges", val:t.badgePts, color:"#7c3aed" },
                { label:"💰 Upsells", val:t.upsellPts, color:"#10b981" },
                { label:"🔄 Switchovers", val:t.switchPts, color:blue },
              ].map(item => (
                <div key={item.label} style={{ background:"#fff", border:`1px solid ${bord}`, borderRadius:"6px", padding:"8px 10px", textAlign:"center" }}>
                  <div style={{ fontSize:"11px", color:muted, marginBottom:"2px" }}>{item.label}</div>
                  <div style={{ fontSize:"15px", fontWeight:"800", color:item.color }}>{item.val.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── TECH DASHBOARD ───────────────────────────────────────────────────────────
function TechDashboard({ tech, techs, upsells, switchovers, onLogout }) {
  const [tab, setTab] = useState("overview");
  const pts = calcTotalPts(tech, upsells, switchovers);
  const rank = getRank(pts);
  const myPos = [...techs].sort((a,b)=>calcTotalPts(b,upsells,switchovers)-calcTotalPts(a,upsells,switchovers)).findIndex(t=>t.id===tech.id)+1;
  const maxPts = Math.max(...techs.map(t=>calcTotalPts(t,upsells,switchovers)));
  const pct = maxPts>0 ? Math.round((pts/maxPts)*100) : 0;

  return (
    <div style={{ minHeight:"100vh", background:bg, color:dark }}>
      <Header right={<LogoutBtn onLogout={onLogout} />} />
      <div style={{ borderBottom:`1px solid ${bord}`, background:"#fff" }}>
        <div style={{ display:"flex", flexWrap:"wrap", padding:"0 12px" }}>
          {[["overview","Overview"],["badges","Badges"],["leaderboard","Rankings"],["upsells","Upsells"],["switchovers","Switchovers"],["total","🏆 Total Pts"]].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              background:"none", border:"none", cursor:"pointer", whiteSpace:"nowrap",
              padding:"11px 12px", fontSize:"11px", letterSpacing:"0.5px", textTransform:"uppercase",
              fontFamily:"monospace", color: tab===id ? blue : muted, flexShrink:0,
              borderBottom: tab===id ? `2px solid ${blue}` : "2px solid transparent",
            }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ padding:"24px", maxWidth:"800px", margin:"0 auto" }}>

        {tab==="overview" && (
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"12px" }}>
              <StatCard label="Total Points" value={pts.toLocaleString()} color={blue} />
              <StatCard label="Team Rank" value={`#${myPos} of ${techs.length}`} color="#10b981" />
              <StatCard label="Badges" value={`${tech.badges.length}/${BADGE_DEFS.length}`} color="#7c3aed" />
            </div>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
                <div>
                  <div style={{ fontSize:"10px", color:muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"monospace", marginBottom:"4px" }}>Current Rank</div>
                  <div style={{ fontSize:"26px", fontWeight:"900", color:rank.color }}>{rank.label}</div>
                </div>
                <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}>{pct}% of leader</div>
              </div>
              <div style={{ background:bord, borderRadius:"4px", height:"8px", overflow:"hidden" }}>
                <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${blue},#0066cc)`, borderRadius:"4px", transition:"width 1s ease" }} />
              </div>
              <div style={{ fontSize:"10px", color:muted, fontFamily:"monospace", marginTop:"6px" }}>Rookie → Rising (500) → Pro (1000) → Elite (2000)</div>
            </div>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ fontSize:"10px", color:muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"monospace", marginBottom:"12px" }}>Recent Badges</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"8px" }}>
                {BADGE_DEFS.filter(b=>tech.badges.includes(b.id)).slice(-5).map(b => (
                  <div key={b.id} style={{ display:"flex", alignItems:"center", gap:"6px", background:"#e6f4ff", border:`1px solid ${blue}33`, borderRadius:"6px", padding:"6px 12px" }}>
                    <span style={{ fontSize:"16px" }}>{b.icon}</span>
                    <div>
                      <div style={{ fontSize:"12px", fontWeight:"700", color:dark }}>{b.name}</div>
                      <div style={{ fontSize:"11px", color:blue, fontFamily:"monospace" }}>+{b.pts} pts</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab==="badges" && <BadgeGrid earned={tech.badges} />}

        {tab==="leaderboard" && (
          <div>
            <div style={{ fontSize:"13px", color:muted, marginBottom:"20px" }}>Live standings — updated every time a badge is awarded.</div>
            <BadgeLeaderboard techs={techs} currentId={tech.id} />
          </div>
        )}

        {tab==="upsells" && (
          <div>
            <div style={{ fontSize:"13px", color:muted, marginBottom:"20px" }}>Weekly upsell revenue — updated by your admin every week.</div>
            <UpsellLeaderboard techs={techs} upsells={upsells} currentId={tech.id} />
          </div>
        )}

        {tab==="switchovers" && (
          <div>
            <div style={{ fontSize:"13px", color:muted, marginBottom:"20px" }}>Track who converted one-time clients to recurring service plans.</div>
            <SwitchoverLeaderboard techs={techs} switchovers={switchovers} currentId={tech.id} />
          </div>
        )}

        {tab==="total" && (
          <div>
            <div style={{ fontSize:"13px", color:muted, marginBottom:"20px" }}>Combined ranking — badges + upsell dollars + switchover points all in one.</div>
            <TotalLeaderboard techs={techs} upsells={upsells} switchovers={switchovers} currentId={tech.id} />
          </div>
        )}

      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function AdminPanel({ techs, setTechs, upsells, setUpsells, switchovers, setSwitchovers, onLogout }) {
  const [tab, setTab] = useState("award");
  const [awardForm, setAwardForm] = useState({ techId:"", badgeId:"" });
  const [addForm, setAddForm] = useState({ name:"", pin:"", avatar:"" });
  const [upsellForm, setUpsellForm] = useState({});
  const [swForm, setSwForm] = useState({ techId:"", planId:"" });
  const [toast, setToast] = useState(null);

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3000); };

  function awardBadge() {
    if (!awardForm.techId||!awardForm.badgeId) return showToast("Select a tech and badge",false);
    const tech = techs.find(t=>t.id===awardForm.techId);
    if (tech.badges.includes(awardForm.badgeId)) return showToast(`${tech.name} already has this badge`,false);
    const updated = techs.map(t => t.id===awardForm.techId ? {...t, badges:[...t.badges,awardForm.badgeId]} : t);
    setTechs(updated); saveKey("techs_v1",updated);
    showToast(`✅ Badge awarded to ${tech.name}!`);
    setAwardForm({techId:"",badgeId:""});
  }

  function addTech() {
    if (!addForm.name||!addForm.pin||addForm.pin.length!==4) return showToast("Name + 4-digit PIN required",false);
    if (techs.find(t=>t.pin===addForm.pin)) return showToast("PIN already in use",false);
    const avatar = addForm.avatar||addForm.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
    const t = { id:`t${Date.now()}`, name:addForm.name, pin:addForm.pin, avatar, badges:["day_one"] };
    const updated = [...techs,t];
    setTechs(updated); saveKey("techs_v1",updated);
    showToast(`✅ ${addForm.name} added!`);
    setAddForm({name:"",pin:"",avatar:""});
  }

  function revokeBadge(techId, badgeId) {
    const updated = techs.map(t => t.id===techId ? {...t, badges:t.badges.filter(b=>b!==badgeId)} : t);
    setTechs(updated); saveKey("techs_v1",updated);
    showToast("Badge removed");
  }

  function saveUpsells() {
    const wk = getWeekKey();
    const updated = {...upsells, [wk]: {...(upsells[wk]||{})}};
    techs.forEach(t => { const v=parseFloat(upsellForm[t.id]); if(!isNaN(v)) updated[wk][t.id]=v; });
    setUpsells(updated); saveKey("upsells_v1",updated);
    showToast("✅ Upsell numbers saved!");
    setUpsellForm({});
  }

  function logSwitchover() {
    if (!swForm.techId||!swForm.planId) return showToast("Select a tech and plan",false);
    const wk = getWeekKey();
    const updated = JSON.parse(JSON.stringify(switchovers));
    if (!updated[wk]) updated[wk]={};
    if (!updated[wk][swForm.techId]) updated[wk][swForm.techId]=[];
    updated[wk][swForm.techId].push({ plan:swForm.planId, date:new Date().toISOString() });
    setSwitchovers(updated); saveKey("switchovers_v1",updated);
    const tech = techs.find(t=>t.id===swForm.techId);
    showToast(`✅ Switchover logged for ${tech.name}!`);
    setSwForm({techId:"",planId:""});
  }

  const selStyle = (val) => ({ background:"#fff", border:`1px solid ${bord}`, color:val?dark:muted, padding:"10px 14px", borderRadius:"6px", fontSize:"14px", fontFamily:"monospace", width:"100%", boxSizing:"border-box" });
  const inpStyle = { background:"#fff", border:`1px solid ${bord}`, color:dark, padding:"10px 14px", borderRadius:"6px", fontSize:"14px", fontFamily:"monospace", width:"100%", boxSizing:"border-box" };
  const btnStyle = (color) => ({ background:color||blue, border:"none", color:"#fff", padding:"12px", borderRadius:"6px", cursor:"pointer", fontSize:"14px", fontWeight:"700", letterSpacing:"1px", fontFamily:"monospace", width:"100%" });

  return (
    <div style={{ minHeight:"100vh", background:bg, color:dark }}>
      <Header title="Admin Panel" right={<LogoutBtn onLogout={onLogout} />} />
      <TabBar
        tabs={[["award","Award Badge"],["add","Add Tech"],["manage","Manage"],["upsells","Upsells"],["switchovers","Switchovers"]]}
        active={tab} setActive={setTab} accentColor="#10b981"
      />
      <div style={{ padding:"24px", maxWidth:"700px", margin:"0 auto" }}>

        {tab==="award" && (
          <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace", marginBottom:"4px" }}>AWARD A BADGE</div>
            <select value={awardForm.techId} onChange={e=>setAwardForm(f=>({...f,techId:e.target.value}))} style={selStyle(awardForm.techId)}>
              <option value="">— Select Tech —</option>
              {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={awardForm.badgeId} onChange={e=>setAwardForm(f=>({...f,badgeId:e.target.value}))} style={selStyle(awardForm.badgeId)}>
              <option value="">— Select Badge —</option>
              {BADGE_DEFS.map(b=><option key={b.id} value={b.id}>{b.icon} {b.name} (+{b.pts} pts)</option>)}
            </select>
            <button onClick={awardBadge} style={btnStyle(blue)}>AWARD BADGE</button>
          </div>
        )}

        {tab==="add" && (
          <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace", marginBottom:"4px" }}>ADD NEW TECH</div>
            <input placeholder="Full Name" value={addForm.name} onChange={e=>setAddForm(f=>({...f,name:e.target.value}))} style={inpStyle} />
            <input placeholder="4-Digit PIN" value={addForm.pin} maxLength={4} onChange={e=>setAddForm(f=>({...f,pin:e.target.value.replace(/\D/g,"")}))} style={inpStyle} />
            <input placeholder="Initials (optional, e.g. JD)" value={addForm.avatar} maxLength={2} onChange={e=>setAddForm(f=>({...f,avatar:e.target.value.toUpperCase()}))} style={inpStyle} />
            <button onClick={addTech} style={btnStyle("#10b981")}>ADD TECH → Gets Day One Badge</button>
          </div>
        )}

        {tab==="manage" && (
          <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
            {techs.map(t => (
              <div key={t.id} style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"18px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
                  <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name}</div>
                  <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}>{calcPoints(t.badges).toLocaleString()} pts · PIN: {t.pin}</div>
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                  {t.badges.map(bid => {
                    const b = BADGE_MAP[bid];
                    return b ? (
                      <div key={bid} style={{ display:"flex", alignItems:"center", gap:"5px", background:"#e6f4ff", border:`1px solid ${blue}33`, borderRadius:"4px", padding:"3px 8px", fontSize:"12px" }}>
                        <span>{b.icon}</span><span style={{ color:dark }}>{b.name}</span>
                        <button onClick={()=>revokeBadge(t.id,bid)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:"13px", padding:"0 0 0 2px", lineHeight:1 }}>×</button>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab==="upsells" && (
          <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"14px" }}>
            <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace" }}>ENTER THIS WEEK · {formatWeekLabel(getWeekKey())}</div>
            {techs.map(t => (
              <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                <div style={{ width:"130px", fontSize:"14px", fontWeight:"600", color:dark }}>{t.name}</div>
                <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                  <span style={{ color:muted, fontSize:"16px", fontWeight:"700" }}>$</span>
                  <input type="number" placeholder="0" value={upsellForm[t.id]||""} onChange={e=>setUpsellForm(f=>({...f,[t.id]:e.target.value}))}
                    style={{ background:"#fff", border:`1px solid ${bord}`, color:dark, padding:"8px 10px", borderRadius:"6px", fontSize:"14px", fontFamily:"monospace", width:"110px" }} />
                </div>
              </div>
            ))}
            <button onClick={saveUpsells} style={btnStyle(blue)}>SAVE THIS WEEK</button>
          </div>
        )}

        {tab==="switchovers" && (
          <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"12px" }}>
              <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace" }}>LOG A SWITCHOVER · {formatWeekLabel(getWeekKey())}</div>
              <select value={swForm.techId} onChange={e=>setSwForm(f=>({...f,techId:e.target.value}))} style={selStyle(swForm.techId)}>
                <option value="">— Select Tech —</option>
                {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={swForm.planId} onChange={e=>setSwForm(f=>({...f,planId:e.target.value}))} style={selStyle(swForm.planId)}>
                <option value="">— Select Plan Converted To —</option>
                {SERVICE_PLANS.map(p=><option key={p.id} value={p.id}>{p.label} ({p.freq})</option>)}
              </select>
              <button onClick={logSwitchover} style={btnStyle(blue)}>LOG SWITCHOVER</button>
            </div>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ fontSize:"11px", letterSpacing:"2px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"10px" }}>This Week So Far</div>
              {(() => {
                const wkData = switchovers[getWeekKey()]||{};
                const hasAny = techs.some(t=>(wkData[t.id]||[]).length>0);
                if (!hasAny) return <div style={{ fontSize:"12px", color:muted }}>No switchovers logged yet this week</div>;
                return techs.filter(t=>(wkData[t.id]||[]).length>0).map(t => {
                  const entries = wkData[t.id]||[];
                  return (
                    <div key={t.id} style={{ marginBottom:"10px" }}>
                      <div style={{ fontSize:"13px", fontWeight:"700", color:dark, marginBottom:"4px" }}>{t.name} — {entries.length} convert{entries.length!==1?"s":""}</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
                        {entries.map((e,i)=>{ const plan=PLAN_MAP[e.plan]; return plan?<div key={i} style={{ fontSize:"11px", background:"#fff", border:`1px solid ${bord}`, borderRadius:"3px", padding:"2px 7px", color:muted, fontFamily:"monospace" }}>{plan.label}</div>:null; })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

      </div>
      {toast && (
        <div style={{ position:"fixed", bottom:"24px", left:"50%", transform:"translateX(-50%)", background: toast.ok?"#10b981":"#ef4444", color:"#fff", padding:"12px 24px", borderRadius:"8px", fontSize:"14px", fontWeight:"600", zIndex:999 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [techs, setTechs] = useState(null);
  const [upsells, setUpsells] = useState({});
  const [switchovers, setSwitchovers] = useState({});
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([loadKey("techs_v1"), loadKey("upsells_v1"), loadKey("switchovers_v1")]).then(([t,u,s]) => {
      const hasOld = t && t.some(x => ["Marcus R.","Devon K.","Jordan T.","Carlos M.","Tyler B."].includes(x.name));
      setTechs(hasOld||!t ? SEED_TECHS : t);
      if (hasOld||!t) saveKey("techs_v1", SEED_TECHS);
      setUpsells(u||{});
      setSwitchovers(s||{});
      setLoading(false);
    });
  }, []);

  function handlePin(pin) {
    if (pin===ADMIN_PIN) { setUser({type:"admin"}); return true; }
    const tech = techs?.find(t=>t.pin===pin);
    if (tech) { setUser({type:"tech",techId:tech.id}); return true; }
    return false;
  }

  const currentTech = user?.type==="tech" ? techs?.find(t=>t.id===user.techId) : null;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:blue, fontFamily:"monospace", letterSpacing:"3px", fontSize:"12px" }}>LOADING...</div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:"100vh", background:bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"40px" }}>
      <div style={{ textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:"16px" }}>
        <Logo height={80} />
        <div>
          <div style={{ fontSize:"11px", letterSpacing:"4px", color:blue, textTransform:"uppercase", fontFamily:"monospace", marginBottom:"6px" }}>Field Operations</div>
          <h1 style={{ fontSize:"28px", fontWeight:"900", margin:0, letterSpacing:"-0.5px", color:dark }}>The Standard Board</h1>
          <p style={{ color:muted, marginTop:"6px", fontSize:"14px" }}>Enter your PIN to continue</p>
        </div>
      </div>
      <PinPad onSubmit={handlePin} />
      <div style={{ fontSize:"11px", color:bord, fontFamily:"monospace", textAlign:"center" }}>PINS: 1111–1116 · Admin: 0000</div>
    </div>
  );

  if (user.type==="admin") return <AdminPanel techs={techs} setTechs={setTechs} upsells={upsells} setUpsells={setUpsells} switchovers={switchovers} setSwitchovers={setSwitchovers} onLogout={()=>setUser(null)} />;
  if (user.type==="tech"&&currentTech) return <TechDashboard tech={currentTech} techs={techs} upsells={upsells} switchovers={switchovers} onLogout={()=>setUser(null)} />;
  return null;
}
