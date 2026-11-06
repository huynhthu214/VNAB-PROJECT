import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { useDirectory, buildStats } from "./api.js";
import { PROVINCES } from "./data.js";
import { loadUi, saveUi } from "./storage.js";
import { Icon, SealMark } from "./components/shared.jsx";
import OverviewTab from "./components/OverviewTab.jsx";
import ChatTab from "./components/ChatTab.jsx";
import LookupTab from "./components/LookupTab.jsx";
import ExploreTab from "./components/ExploreTab.jsx";
import AboutTab from "./components/AboutTab.jsx";

/* =========================================================
   KHUNG ỨNG DỤNG: điều hướng tab (đồng bộ với #/đường-dẫn),
   tỉnh đang chọn dùng chung cho mọi tab.
   ========================================================= */
const TABS = [
  { id: "overview", slug: "tong-quan", label: "Tổng quan", icon: "map" },
  { id: "chat", slug: "hoi-dap", label: "Hỏi đáp", icon: "chat" },
  { id: "lookup", slug: "tra-cuu", label: "Tra cứu", icon: "search" },
  { id: "explore", slug: "kham-pha", label: "Khám phá", icon: "layers" },
  { id: "about", slug: "gioi-thieu", label: "Giới thiệu", icon: "book" },
];

function tabFromHash() {
  const slug = window.location.hash.replace(/^#\/?/, "");
  return TABS.find((t) => t.slug === slug)?.id || "overview";
}

function PageFooter({ go }) {
  return (
    <footer className="site-foot">
      <div className="wrap">
        <div className="site-foot-brand">
          <SealMark size={22} />
          <strong>Địa giới hành chính miền Nam</strong>
        </div>
        <p>
          Thông tin mang tính tra cứu, tham khảo. Hãy đối chiếu văn bản gốc khi
          dùng cho thủ tục hành chính hoặc pháp lý.
        </p>
        <button className="link-btn" onClick={() => go("about")}>
          Xem văn bản căn cứ <Icon name="arrow" size={15} />
        </button>
      </div>
    </footer>
  );
}

export default function App() {
  const [tab, setTab] = useState(tabFromHash);
  const [province, setProvince] = useState(() => {
    const ui = loadUi();
    return PROVINCES.some((p) => p.code === ui.province)
      ? ui.province
      : PROVINCES[0].code;
  });
  const [lookupAll, setLookupAll] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [prefill, setPrefill] = useState(null); // { text, nonce } cho tab Hỏi đáp

  const dir = useDirectory();
  const stats = useMemo(
    () => buildStats(dir.units, dir.docs),
    [dir.units, dir.docs],
  );

  // ---------- điều hướng ----------
  function go(id) {
    setTab(id);
    const slug = TABS.find((t) => t.id === id).slug;
    if (window.location.hash !== `#/${slug}`) {
      window.history.pushState(null, "", `#/${slug}`);
    }
  }

  useEffect(() => {
    const onNav = () => setTab(tabFromHash());
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
  }, []);

  useEffect(() => {
    saveUi({ province });
  }, [province]);

  useEffect(() => {
    const t = TABS.find((x) => x.id === tab);
    document.title = `${t.label} · Địa giới hành chính miền Nam`;
  }, [tab]);

  // ---------- hành động dùng chung ----------
  const actions = {
    lookup(code) {
      setProvince(code);
      setLookupAll(false);
      go("lookup");
    },
    explore(code) {
      setProvince(code);
      go("explore");
    },
    chat(code) {
      setProvince(code);
      go("chat");
    },
    goLookup: () => go("lookup"),
    goExplore: () => go("explore"),
    goChat: () => go("chat"),
  };

  function heroSearch(q) {
    setLookupQuery(q);
    setLookupAll(true);
    go("lookup");
  }

  function onScope(v) {
    if (v === "all") setLookupAll(true);
    else {
      setLookupAll(false);
      setProvince(v);
    }
  }

  function ask(code, text) {
    if (code) setProvince(code);
    setPrefill({ text, nonce: Date.now() });
    go("chat");
  }

  function pickProvince(code) {
    setProvince(code);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-in">
          <a
            className="brand"
            href="#/tong-quan"
            onClick={(e) => {
              e.preventDefault();
              go("overview");
            }}
          >
            <span className="brand-mark">
              <SealMark size={30} />
            </span>
            <span className="brand-text">
              <span className="brand-name">Địa giới hành chính</span>
              <span className="brand-sub">Miền Nam sau sáp nhập</span>
            </span>
          </a>

          <nav className="tabs" aria-label="Điều hướng chính">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={`#/${t.slug}`}
                className={`tab ${tab === t.id ? "on" : ""}`}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(t.id);
                }}
              >
                <Icon name={t.icon} size={19} />
                <span>{t.label}</span>
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="stage">
        {/* Hỏi đáp luôn được giữ trong DOM để không mất cuộc trò chuyện đang dở */}
        <ChatTab
          visible={tab === "chat"}
          province={province}
          onProvince={pickProvince}
          prefill={prefill}
        />

        {tab !== "chat" && (
          <div className="page-scroll">
            {tab === "overview" && (
              <OverviewTab
                stats={stats}
                loading={dir.loading}
                actions={actions}
                onHeroSearch={heroSearch}
              />
            )}
            {tab === "lookup" && (
              <LookupTab
                units={dir.units}
                loading={dir.loading}
                province={province}
                all={lookupAll}
                onScope={onScope}
                query={lookupQuery}
                onQuery={setLookupQuery}
                onAsk={ask}
              />
            )}
            {tab === "explore" && (
              <ExploreTab
                units={dir.units}
                loading={dir.loading}
                province={province}
                onProvince={pickProvince}
                onAsk={ask}
              />
            )}
            {tab === "about" && (
              <AboutTab docs={dir.docs} stats={stats} actions={actions} />
            )}
            <PageFooter go={go} />
          </div>
        )}
      </main>
    </div>
  );
}
