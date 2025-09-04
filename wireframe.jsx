import React, { useState } from "react";
import { MessageSquare, BarChart3, CalendarDays, Users, Settings, Play, PauseCircle, LineChart, ChevronRight, Plus, Search } from "lucide-react";

// Low‑fi desktop wireframe for the AI Trading Twin web app
// Focus: layout + flows, grayscale blocks, no brand colors yet.
// Tabs: Chat, Dashboard, Digest, Personas. Includes Onboarding ribbon and right drawer.

const NavItem = ({ icon: Icon, label, active, onClick }: { icon: any; label: string; active?: boolean; onClick?: () => void }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-3 w-full text-left px-3 py-2 rounded-xl transition ${
      active ? "bg-zinc-800 text-white" : "text-zinc-300 hover:bg-zinc-800/60"
    }`}
  >
    <Icon size={18} />
    <span className="font-medium tracking-tight">{label}</span>
  </button>
);

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="px-2 py-0.5 text-xs rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700">{children}</span>
);

const PlaceholderChart = ({ title }: { title: string }) => (
  <div className="w-full h-48 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900 flex items-center justify-center">
    <div className="text-zinc-500 text-sm flex items-center gap-2">
      <LineChart size={16} /> {title}
    </div>
  </div>
);

const StatBox = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-zinc-700/70 bg-zinc-900 p-4 flex flex-col gap-1">
    <div className="text-xs text-zinc-400">{label}</div>
    <div className="text-lg text-zinc-100 font-semibold">{value}</div>
  </div>
);

const ListItem = ({ title, tag, time }: { title: string; tag: string; time: string }) => (
  <div className="flex items-center justify-between py-3 border-b border-zinc-800 last:border-0">
    <div className="flex items-center gap-3">
      <div className="size-8 rounded-xl bg-zinc-800/80" />
      <div className="flex flex-col">
        <span className="text-sm text-zinc-100 font-medium">{title}</span>
        <span className="text-xs text-zinc-500">{time}</span>
      </div>
    </div>
    <Badge>{tag}</Badge>
  </div>
);

function ChatView() {
  return (
    <div className="flex h-full">
      {/* Left thread list */}
      <div className="w-80 shrink-0 border-r border-zinc-800 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative w-full">
            <input placeholder="Search conversations" className="w-full bg-zinc-900/70 border border-zinc-800 rounded-xl px-9 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none" />
            <Search size={16} className="absolute left-3 top-2.5 text-zinc-500" />
          </div>
          <button className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-200 text-sm">
            <Plus size={16} />
          </button>
        </div>
        <div className="text-xs text-zinc-500 uppercase tracking-wider">Recent</div>
        <div className="flex-1 overflow-auto">
          {[
            { title: "ETH spike entry", tag: "FOMO", time: "Today • 10:14" },
            { title: "BTC stop loss", tag: "Discipline", time: "Yesterday • 21:03" },
            { title: "SOL breakout", tag: "FOMO", time: "Mon • 13:55" },
          ].map((x, i) => (
            <ListItem key={i} {...x} />
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {/* Onboarding ribbon */}
        <div className="bg-zinc-900/70 border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-zinc-300">
            Connect your broker to unlock full analysis <Badge>30‑day import</Badge>
          </div>
          <button className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 text-sm font-medium">Connect Broker</button>
        </div>

        {/* transcript */}
        <div className="flex-1 overflow-auto p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-2xl bg-zinc-800" />
            <div className="max-w-[52rem] rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-200">
              You just bought <span className="font-semibold">ETH</span> after a <span className="font-semibold">+12% pump</span>. Historically, your spike entries underperform within 48h.
              <div className="mt-3"><PlaceholderChart title="Inline price sketch" /></div>
              <div className="mt-3 flex items-center gap-2">
                <button className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs">Show simulation</button>
                <button className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs">Compare with Buffett</button>
                <button className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs">Add note</button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 justify-end">
            <div className="max-w-[40rem] rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-100">
              Run the what‑if if I waited for a pullback.
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="size-9 rounded-2xl bg-zinc-800" />
            <div className="max-w-[52rem] rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-200">
              In 72% of your past spike entries, price retraced within 48h. Waiting improved your odds to 61%.
              <div className="mt-3 grid grid-cols-2 gap-3">
                <PlaceholderChart title="What you did (‑7%)" />
                <PlaceholderChart title="If you waited (+4%)" />
              </div>
              <div className="mt-3 flex gap-2">
                <button className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 text-xs font-medium">Open Simulation</button>
                <button className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs">Set alert rule</button>
              </div>
            </div>
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-zinc-800 p-4 flex items-center gap-3">
          <button className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-200 text-sm flex items-center gap-2">
            <Play size={16} /> Live coach
          </button>
          <input placeholder="Type to your clone…" className="flex-1 bg-zinc-900/70 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none" />
          <button className="px-3 py-2 rounded-xl bg-zinc-100 text-zinc-900 text-sm font-medium">Send</button>
        </div>
      </div>

      {/* Right rail */}
      <div className="w-80 shrink-0 border-l border-zinc-800 p-4 flex flex-col gap-3">
        <div className="text-xs text-zinc-500 uppercase tracking-wider">Profile</div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-2xl bg-zinc-800" />
            <div>
              <div className="text-sm text-zinc-100 font-medium">Your Trading Twin</div>
              <div className="text-xs text-zinc-500">Tone: Supportive</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatBox label="FOMO Risk" value="High" />
            <StatBox label="Discipline" value="Med" />
          </div>
        </div>

        <div className="text-xs text-zinc-500 uppercase tracking-wider">Recent Trades</div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
          <ListItem title="BUY ETH" tag="FOMO" time="+12% candle" />
          <ListItem title="SELL BTC" tag="Panic" time="stop hit" />
          <ListItem title="BUY AAPL" tag="Plan" time="DCA #2" />
        </div>
      </div>
    </div>
  );
}

function DashboardView() {
  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="grid grid-cols-4 gap-4">
        <StatBox label="Trades (30d)" value="42" />
        <StatBox label="FOMO %" value="38%" />
        <StatBox label="Avg Hold" value="1.5d" />
        <StatBox label="Net P/L" value="‑$380" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-4">
          <div className="text-sm text-zinc-200 font-medium">Bias Timeline</div>
          <PlaceholderChart title="Trades mapped to FOMO/Panic/Discipline" />
          <div className="text-xs text-zinc-500">Each marker = a trade; color = bias tag</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-4">
          <div className="text-sm text-zinc-200 font-medium">Behavioral Profile</div>
          <div className="w-full h-56 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900 flex items-center justify-center text-zinc-500 text-sm">
            Radar chart placeholder
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Badge>FOMO: High</Badge>
            <Badge>Patience: Med</Badge>
            <Badge>Discipline: Low</Badge>
            <Badge>Risk: Med</Badge>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-200 font-medium">Tagged Trades</div>
          <button className="text-xs text-zinc-400 flex items-center gap-1">View all <ChevronRight size={14} /></button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {[
            { title: "ETH spike buy", tag: "FOMO", time: "Today" },
            { title: "BTC stop", tag: "Panic", time: "Yesterday" },
            { title: "AAPL DCA", tag: "Discipline", time: "Mon" },
          ].map((x, i) => (
            <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="text-sm text-zinc-200 font-medium">{x.title}</div>
              <div className="mt-2"><PlaceholderChart title="Mini chart" /></div>
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                <Badge>{x.tag}</Badge>
                <span>{x.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DigestView() {
  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-200 font-medium">Weekly Report Card</div>
        <div className="mt-3 grid grid-cols-4 gap-4">
          <StatBox label="FOMO Loss" value="‑$420" />
          <StatBox label="Panic Loss" value="‑$120" />
          <StatBox label="Discipline Gain" value="+$260" />
          <StatBox label="Net Impact" value="‑$280" />
        </div>
        <div className="mt-4"><PlaceholderChart title="Bias impact bar chart" /></div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-zinc-400 uppercase tracking-wider">Streaks</div>
          <div className="mt-2 flex flex-col gap-2">
            <Badge>3 days no panic selling</Badge>
            <Badge>2 days no spike entries</Badge>
          </div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-zinc-400 uppercase tracking-wider">Clone Advice</div>
          <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-200">
            Next week, set price alerts at prior swing lows/highs to avoid chasing green candles. Consider a "2 red candles" rule before entries.
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonasView() {
  const personas = [
    { name: "Buffett Clone", desc: "Value first, avoid hype." },
    { name: "Cathie Clone", desc: "Growth & innovation tilt." },
    { name: "Rational Future Self", desc: "Disciplined, rules‑based you." },
  ];
  return (
    <div className="p-6 grid grid-cols-3 gap-4">
      {personas.map((p) => (
        <div key={p.name} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-2">
          <div className="h-28 rounded-xl bg-zinc-800/60" />
          <div className="text-zinc-100 font-medium">{p.name}</div>
          <div className="text-sm text-zinc-500">{p.desc}</div>
          <button className="mt-2 px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-900 text-xs font-medium w-max">Preview in Chat</button>
        </div>
      ))}
    </div>
  );
}

export default function AppWireframe() {
  const [tab, setTab] = useState<"chat" | "dashboard" | "digest" | "personas">("chat");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      {/* Top bar */}
      <header className="h-14 border-b border-zinc-800 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-xl bg-zinc-800" />
          <div className="text-sm font-semibold tracking-tight">AI Trading Twin</div>
          <Badge>Low‑Fi</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Settings size={16} /> Settings
        </div>
      </header>

      {/* Shell */}
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-zinc-800 p-3 flex flex-col gap-2">
          <NavItem icon={MessageSquare} label="Chat" active={tab === "chat"} onClick={() => setTab("chat")} />
          <NavItem icon={BarChart3} label="Dashboard" active={tab === "dashboard"} onClick={() => setTab("dashboard")} />
          <NavItem icon={CalendarDays} label="Digest" active={tab === "digest"} onClick={() => setTab("digest")} />
          <NavItem icon={Users} label="Personas" active={tab === "personas"} onClick={() => setTab("personas")} />
        </aside>

        {/* Main */}
        <main className="flex-1 min-h-[calc(100vh-3.5rem)]">
          {tab === "chat" && <ChatView />}
          {tab === "dashboard" && <DashboardView />}
          {tab === "digest" && <DigestView />}
          {tab === "personas" && <PersonasView />}
        </main>
      </div>
    </div>
  );
}
