import { useState, useRef, useEffect } from "react";
import "./App.css";

/* =========================================================
   CẤU HÌNH API
   TP.HCM (hasRealData: true) → gọi backend thật
   7 tỉnh còn lại → mock (chưa có dữ liệu backend)
   ========================================================= */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

function useLiveApi(provinceCode) {
  return (
    MOCK_PROVINCES.find((p) => p.code === provinceCode)?.hasRealData ?? false
  );
}

/* =========================================================
   DANH SÁCH 8 TỈNH/THÀNH MIỀN NAM SAU SÁP NHẬP (Nghị quyết 202/2025/QH15)
   ========================================================= */
const MOCK_PROVINCES = [
  {
    code: "tphcm",
    name: "TP. Hồ Chí Minh",
    merged: "TP.HCM, Bình Dương, Bà Rịa - Vũng Tàu",
    hasRealData: true,
  },
  {
    code: "dongnai",
    name: "Đồng Nai",
    merged: "Đồng Nai, Bình Phước",
    hasRealData: false,
  },
  {
    code: "tayninh",
    name: "Tây Ninh",
    merged: "Tây Ninh, Long An",
    hasRealData: false,
  },
  {
    code: "cantho",
    name: "Cần Thơ",
    merged: "Cần Thơ, Hậu Giang, Sóc Trăng",
    hasRealData: false,
  },
  {
    code: "vinhlong",
    name: "Vĩnh Long",
    merged: "Vĩnh Long, Bến Tre, Trà Vinh",
    hasRealData: false,
  },
  {
    code: "dongthap",
    name: "Đồng Tháp",
    merged: "Đồng Tháp, Tiền Giang",
    hasRealData: false,
  },
  {
    code: "angiang",
    name: "An Giang",
    merged: "An Giang, Kiên Giang",
    hasRealData: false,
  },
  {
    code: "camau",
    name: "Cà Mau",
    merged: "Cà Mau, Bạc Liêu",
    hasRealData: false,
  },
];

/* =========================================================
   MOCK DATA — mô phỏng bảng unit_mapping, gắn theo province
   TP.HCM: dựa theo Nghị quyết 1685/NQ-UBTVQH15 (xem API_DOC.md)
   7 tỉnh còn lại: dữ liệu MINH HỌA — GĐ2 (mở rộng) chưa thu thập dữ liệu thật,
   dùng để dựng UI trước, không phản ánh ánh xạ phường/xã có thật.
   ========================================================= */
const MOCK_UNITS = [
  // ---- TP. HỒ CHÍ MINH (dữ liệu mẫu theo văn bản thật) ----
  {
    province: "tphcm",
    old_names: [
      "Phường Bến Nghé",
      "Phường Bến Thành",
      "Phường Nguyễn Thái Bình",
    ],
    new_name: "Phường Sài Gòn",
    old_parent: "Quận 1",
    headquarters_address: "86 Lê Thánh Tôn, Quận 1 cũ",
    decision_number: "1685/NQ-UBTVQH15",
    decision_date: "2025-06-16",
  },
  {
    province: "tphcm",
    old_names: ["Phường Tân Định"],
    new_name: "Phường Tân Định",
    old_parent: "Quận 1",
    headquarters_address: "48 Nguyễn Hữu Cầu, Quận 1 cũ",
    decision_number: "1685/NQ-UBTVQH15",
    decision_date: "2025-06-16",
  },
  {
    province: "tphcm",
    old_names: ["Phường Linh Tây"],
    new_name: "Phường Linh Xuân",
    old_parent: "TP. Thủ Đức",
    headquarters_address: "Đường Kha Vạn Cân, TP. Thủ Đức cũ",
    decision_number: "1685/NQ-UBTVQH15",
    decision_date: "2025-06-16",
  },

  // ---- ĐỒNG NAI (minh họa) ----
  {
    province: "dongnai",
    old_names: ["Phường Tân Phong", "Phường Trảng Dài"],
    new_name: "Phường Biên Hòa",
    old_parent: "TP. Biên Hòa cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "dongnai",
    old_names: ["Xã Tân Lợi"],
    new_name: "Xã Đồng Xoài",
    old_parent: "Đồng Phú cũ (Bình Phước cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },

  // ---- TÂY NINH (minh họa) ----
  {
    province: "tayninh",
    old_names: ["Phường 2"],
    new_name: "Phường Tây Ninh",
    old_parent: "TP. Tây Ninh cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "tayninh",
    old_names: ["Phường Tân An"],
    new_name: "Phường Tân An",
    old_parent: "TP. Tân An cũ (Long An cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },

  // ---- CẦN THƠ (minh họa) ----
  {
    province: "cantho",
    old_names: ["Phường An Hòa"],
    new_name: "Phường Ninh Kiều",
    old_parent: "Quận Ninh Kiều cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "cantho",
    old_names: ["Phường 1"],
    new_name: "Phường Vị Thanh",
    old_parent: "TP. Vị Thanh cũ (Hậu Giang cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },

  // ---- VĨNH LONG (minh họa) ----
  {
    province: "vinhlong",
    old_names: ["Phường 4"],
    new_name: "Phường Vĩnh Long",
    old_parent: "TP. Vĩnh Long cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "vinhlong",
    old_names: ["Phường 1"],
    new_name: "Phường Trà Vinh",
    old_parent: "TP. Trà Vinh cũ (Trà Vinh cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },

  // ---- ĐỒNG THÁP (minh họa) ----
  {
    province: "dongthap",
    old_names: ["Phường 1"],
    new_name: "Phường Cao Lãnh",
    old_parent: "TP. Cao Lãnh cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "dongthap",
    old_names: ["Phường 8"],
    new_name: "Phường Mỹ Tho",
    old_parent: "TP. Mỹ Tho cũ (Tiền Giang cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },

  // ---- AN GIANG (minh họa) ----
  {
    province: "angiang",
    old_names: ["Phường Mỹ Long"],
    new_name: "Phường Long Xuyên",
    old_parent: "TP. Long Xuyên cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "angiang",
    old_names: ["Phường Vĩnh Thanh Vân"],
    new_name: "Phường Rạch Giá",
    old_parent: "TP. Rạch Giá cũ (Kiên Giang cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },

  // ---- CÀ MAU (minh họa) ----
  {
    province: "camau",
    old_names: ["Phường 5"],
    new_name: "Phường Cà Mau",
    old_parent: "TP. Cà Mau cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "camau",
    old_names: ["Phường 3"],
    new_name: "Phường Bạc Liêu",
    old_parent: "TP. Bạc Liêu cũ (Bạc Liêu cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
];

// "Phường 7" trùng tên ở nhiều quận trong TP.HCM — demo case disambiguation
const MOCK_DUPLICATES = {
  tphcm: {
    "Phường 7": [
      { old_parent: "Quận 3", new_name: "Phường Bàn Cờ" },
      { old_parent: "Quận Phú Nhuận", new_name: "Phường Phú Nhuận" },
      { old_parent: "Quận Gò Vấp", new_name: "Phường Gò Vấp" },
    ],
  },
};

function formatAnswerText(text) {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(
      /\s*-\s+(?=(?:Phường|Xã|Quận|Huyện|Thành phố|Thị trấn)\b)/gi,
      "\n• ",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalize(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function mockSearch(raw, selectedProvince) {
  const n = normalize(raw);
  const dupMap = MOCK_DUPLICATES[selectedProvince] || {};
  const dupKey = Object.keys(dupMap).find((k) => normalize(k) === n);
  if (dupKey) {
    return {
      success: false,
      data: null,
      message: "Tên trùng ở nhiều nơi",
      error_code: "UNIT_NOT_FOUND",
      _duplicateKey: dupKey,
    };
  }
  const scoped = MOCK_UNITS.filter((u) => u.province === selectedProvince);
  for (const u of scoped) {
    const hit = u.old_names.find(
      (name) =>
        normalize(name).includes(n) ||
        n.includes(normalize(name).replace("phuong ", "").replace("xa ", "")),
    );
    if (hit) {
      return {
        success: true,
        data: {
          matched_old_name: hit,
          new_unit: {
            new_name: u.new_name,
            decision_number: u.decision_number,
            headquarters_address: u.headquarters_address,
          },
        },
        message: "OK",
      };
    }
  }
  return {
    success: false,
    data: null,
    message: "Không tìm thấy đơn vị hành chính phù hợp",
    error_code: "UNIT_NOT_FOUND",
  };
}

function mockAsk(question, selectedProvince) {
  const n = normalize(question);
  const scoped = MOCK_UNITS.filter((u) => u.province === selectedProvince);
  for (const u of scoped) {
    if (
      u.old_names.some((name) =>
        n.includes(normalize(name).replace("phuong ", "").replace("xa ", "")),
      )
    ) {
      return {
        success: true,
        data: {
          answer: `${u.old_names[0]} (cũ) hiện nay thuộc ${u.new_name}, được thành lập theo ${u.decision_number}.`,
          answer_type: "structured_lookup",
          confidence: 0.96,
          sources: [
            {
              document_id: "doc_0042",
              title: u.decision_number,
              section: "Phụ lục",
            },
          ],
        },
        message: "OK",
      };
    }
  }
  const pName = MOCK_PROVINCES.find((p) => p.code === selectedProvince).name;
  return {
    success: true,
    data: {
      answer: null,
      answer_type: "no_answer",
      confidence: 0.0,
      sources: [],
      suggestion: `Câu hỏi nằm ngoài phạm vi dữ liệu hệ thống hiện có (${pName} sau sắp xếp).`,
    },
    message: "NO_ANSWER_FOUND",
    error_code: "NO_ANSWER_FOUND",
  };
}

export default function App() {
  const [selectedProvince, setSelectedProvince] = useState("tphcm");
  const [lookupInput, setLookupInput] = useState("");
  const [lookupResult, setLookupResult] = useState(null); // { oldName, newName, meta }
  const [noMatchInfo, setNoMatchInfo] = useState(null); // string or { duplicateKey, list }
  const [stampOn, setStampOn] = useState(false);

  const [messages, setMessages] = useState([
    {
      role: "bot",
      kind: "text",
      content:
        'Chào bạn — chọn tỉnh/thành ở thanh phía trên, rồi hỏi mình bằng câu tự nhiên, VD: "Phường Bến Nghé cũ bây giờ là phường gì?"',
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [backendOk, setBackendOk] = useState(null); // null | true | false
  const messagesEndRef = useRef(null);

  const isLive = useLiveApi(selectedProvince);

  useEffect(() => {
    if (!useLiveApi(selectedProvince)) {
      setBackendOk(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE_URL}/health`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setBackendOk(body.success === true);
      })
      .catch(() => {
        if (!cancelled) setBackendOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProvince]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const currentProvince = MOCK_PROVINCES.find(
    (p) => p.code === selectedProvince,
  );

  function selectProvince(code) {
    setSelectedProvince(code);
    setLookupResult(null);
    setNoMatchInfo(null);
    setLookupInput("");
    setStampOn(false);
  }

  function hintChips() {
    const units = MOCK_UNITS.filter((u) => u.province === selectedProvince);
    return units
      .slice(0, 3)
      .map((u) => u.old_names[0].replace(/^(Phường|Xã)\s+/, ""));
  }

  function quickLookup(chipLabel) {
    const clean = chipLabel.replace(/ \(.*\)$/, "");
    setLookupInput(clean);
    doLookup(clean);
  }

  async function doLookup(overrideValue) {
    const raw = (
      overrideValue !== undefined ? overrideValue : lookupInput
    ).trim();
    if (!raw) return;

    setLookupResult(null);
    setNoMatchInfo(null);
    setStampOn(false);

    let response;
    if (isLive) {
      try {
        const r = await fetch(
          `${API_BASE_URL}/admin-units/search?old_name=${encodeURIComponent(raw)}`,
        );
        response = await r.json();
      } catch {
        response = {
          success: false,
          data: null,
          message: "Không kết nối được máy chủ backend",
          error_code: "INTERNAL_ERROR",
        };
      }
    } else {
      response = mockSearch(raw, selectedProvince);
    }

    if (response.success) {
      const d = response.data;
      setLookupResult({
        oldName: d.matched_old_name,
        newName: d.new_unit.new_name,
        decisionNumber: d.new_unit.decision_number,
        headquarters: d.new_unit.headquarters_address,
      });
      requestAnimationFrame(() => setStampOn(true));
    } else if (!isLive && response._duplicateKey) {
      const key = response._duplicateKey;
      const dupList = (MOCK_DUPLICATES[selectedProvince] || {})[key] || [];
      setNoMatchInfo({ duplicateKey: key, list: dupList });
    } else {
      setNoMatchInfo({
        text: response.message || "Không tìm thấy đơn vị hành chính phù hợp.",
      });
    }
  }

  async function sendChat() {
    const q = chatInput.trim();
    if (!q) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", kind: "text", content: q },
    ]);
    setChatInput("");
    setIsTyping(true);

    let response;
    if (isLive) {
      try {
        const r = await fetch(`${API_BASE_URL}/qa/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
        });
        response = await r.json();
      } catch {
        response = {
          success: false,
          data: null,
          message: "Không kết nối được máy chủ backend",
          error_code: "INTERNAL_ERROR",
        };
      }
    } else {
      await new Promise((r) => setTimeout(r, 550));
      response = mockAsk(q, selectedProvince);
    }

    setIsTyping(false);

    if (response.data && response.data.answer) {
      const d = response.data;
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          kind: "answer",
          content: d.answer,
          answerType: d.answer_type,
          confidence: d.confidence,
          sources: d.sources || [],
        },
      ]);
    } else {
      const msg =
        (response.data && response.data.suggestion) ||
        response.message ||
        "Không tìm được câu trả lời đủ tin cậy cho câu hỏi này.";
      setMessages((prev) => [
        ...prev,
        { role: "bot", kind: "no-answer", content: msg },
      ]);
    }
  }

  return (
    <>
      <header>
        <div className="wordmark">
          <svg className="seal-mini" viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="29" stroke="#C9A227" strokeWidth="2" />
            <circle cx="32" cy="32" r="22" stroke="#C9A227" strokeWidth="1" />
            <text
              x="32"
              y="37"
              textAnchor="middle"
              fontFamily="IBM Plex Mono"
              fontSize="8"
              fill="#C9A227"
            >
              MIỀN NAM
            </text>
          </svg>
          <h1>
            Tra cứu đơn vị hành chính miền Nam
            <small>Tra cứu &amp; hỏi đáp — 8 tỉnh/thành khu vực miền Nam</small>
          </h1>
        </div>
        <div className="status-line">
          <div>
            <span className="status-dot"></span>
            data mode:{" "}
            <b style={{ color: "#C9A227" }}>{isLive ? "LIVE" : "MOCK"}</b>
            {isLive && backendOk === true && (
              <span style={{ color: "var(--jade)", marginLeft: 8 }}>
                · backend OK
              </span>
            )}
            {isLive && backendOk === false && (
              <span style={{ color: "#B4523A", marginLeft: 8 }}>
                · backend offline
              </span>
            )}
          </div>
          <div>
            base_url:{" "}
            <span>{isLive ? API_BASE_URL : "(mock — chưa nối API)"}</span>
          </div>
        </div>
      </header>

      <div className="province-bar">
        <div className="province-tabs">
          {MOCK_PROVINCES.map((p) => (
            <span
              key={p.code}
              className={`ptab ${p.code === selectedProvince ? "active" : ""}`}
              onClick={() => selectProvince(p.code)}
            >
              <span className={`dot ${p.hasRealData ? "" : "mock"}`}></span>
              {p.name}
            </span>
          ))}
        </div>
      </div>

      <div className="data-banner">
        {currentProvince.hasRealData ? (
          <>
            <b style={{ color: "var(--jade)" }}>●</b> {currentProvince.name} —
            sáp nhập từ {currentProvince.merged}. Đang kết nối backend thật
            (Nghị quyết 1685/NQ-UBTVQH15).
          </>
        ) : (
          <>
            <b>●</b> {currentProvince.name} — sáp nhập từ{" "}
            {currentProvince.merged}. <b>Dữ liệu MINH HỌA</b> để dựng giao diện
            trước — nhóm chưa thu thập ánh xạ phường/xã thật của tỉnh này.
          </>
        )}
      </div>

      <main>
        {/* LOOKUP PANEL */}
        <section className="panel">
          <div className="panel-head">
            <h2>Tra cứu nhanh</h2>
            <span className="tag">GET /admin-units/search</span>
          </div>
          <div className="lookup-body">
            <div className="search-row">
              <input
                type="text"
                placeholder="Nhập tên phường/xã cũ, VD: Bến Nghé"
                value={lookupInput}
                onChange={(e) => setLookupInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doLookup();
                }}
              />
              <button onClick={() => doLookup()}>Tra</button>
            </div>

            <div className="hint-chips">
              {hintChips().map((c) => (
                <span key={c} className="chip" onClick={() => quickLookup(c)}>
                  {c}
                </span>
              ))}
            </div>

            {lookupResult && (
              <div className="result-card show">
                <svg
                  className={`seal ${stampOn ? "stamp" : ""}`}
                  viewBox="0 0 64 64"
                  fill="none"
                >
                  <circle
                    cx="32"
                    cy="32"
                    r="29"
                    stroke="#B4523A"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="23"
                    stroke="#B4523A"
                    strokeWidth="1"
                  />
                  <text
                    x="32"
                    y="30"
                    textAnchor="middle"
                    fontFamily="IBM Plex Mono"
                    fontSize="7.5"
                    fill="#B4523A"
                    fontWeight="600"
                  >
                    ĐÃ
                  </text>
                  <text
                    x="32"
                    y="40"
                    textAnchor="middle"
                    fontFamily="IBM Plex Mono"
                    fontSize="7.5"
                    fill="#B4523A"
                    fontWeight="600"
                  >
                    SÁP NHẬP
                  </text>
                </svg>
                <div className="old-name">{lookupResult.oldName}</div>
                <div className="new-name">
                  <span className="arrow">→</span>
                  <span>{lookupResult.newName}</span>
                </div>
                <div className="meta">
                  <b>Quyết định:</b> {lookupResult.decisionNumber || "—"}
                  {lookupResult.headquarters && (
                    <>
                      <br />
                      <b>Trụ sở:</b> {lookupResult.headquarters}
                    </>
                  )}
                </div>
              </div>
            )}

            {noMatchInfo && (
              <div className="no-match show">
                {noMatchInfo.duplicateKey ? (
                  <>
                    <b style={{ color: "var(--gold)" }}>
                      {noMatchInfo.duplicateKey}
                    </b>{" "}
                    trùng tên ở {noMatchInfo.list.length} nơi khác nhau — cần
                    nêu rõ quận/huyện:
                    <br />
                    <br />
                    {noMatchInfo.list.map((x, i) => (
                      <span key={i}>
                        • {x.old_parent} →{" "}
                        <b style={{ color: "var(--ink)" }}>{x.new_name}</b>
                        {i < noMatchInfo.list.length - 1 && <br />}
                      </span>
                    ))}
                  </>
                ) : (
                  noMatchInfo.text ||
                  "Không khớp tên nào trong dữ liệu hiện có. Thử một trong các gợi ý ở trên, hoặc dùng khung hỏi-đáp bên phải để hỏi bằng câu tự nhiên."
                )}
              </div>
            )}
          </div>
        </section>

        {/* CHAT PANEL */}
        <section className="panel">
          <div className="panel-head">
            <h2>Hỏi đáp tự nhiên</h2>
            <span className="tag">POST /qa/ask</span>
          </div>
          <div className="chat-body">
            <div className="messages" ref={messagesEndRef}>
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div
                    className={`bubble ${m.kind === "no-answer" ? "no-answer" : ""}`}
                  >
                    {m.kind === "answer" ? (
                      <div className="answer-text">
                        {formatAnswerText(m.content)}
                      </div>
                    ) : (
                      <div className="answer-text">{m.content}</div>
                    )}
                    {m.kind === "answer" && (
                      <>
                        <div className="confidence">
                          answer_type: {m.answerType} · confidence:{" "}
                          {m.confidence}
                        </div>
                        {m.sources && m.sources.length > 0 && (
                          <div className="sources">
                            {m.sources.map((s, si) => (
                              <div className="source-pill" key={si}>
                                {s.title}
                                {s.section ? ` · ${s.section}` : ""}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="msg bot">
                  <div className="bubble">
                    <div className="typing">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="composer">
              <input
                type="text"
                placeholder="Nhập câu hỏi..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendChat();
                }}
              />
              <button onClick={sendChat}>Gửi</button>
            </div>
            <div className="mode-note">
              {isLive ? (
                <>
                  TP.HCM đang gọi API thật qua <code>{API_BASE_URL}</code>. Tra
                  cứu nhanh dùng <code>GET /admin-units/search</code>; hỏi đáp
                  dùng <code>POST /qa/ask</code>.
                </>
              ) : (
                <>
                  Tỉnh này đang dùng dữ liệu MINH HỌA. Chọn{" "}
                  <b>TP. Hồ Chí Minh</b> để dùng backend thật.
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer>
        TP.HCM kết nối backend qua Vite proxy → localhost:3000. 7 tỉnh còn lại
        dùng dữ liệu MINH HỌA.
      </footer>
    </>
  );
}
