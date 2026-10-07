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
const MODEL_OPTIONS = [
  { value: "rule_based", label: "Model 1: Rule-based" },
  { value: "naive_rag", label: "Model 2: Naive RAG" },
  { value: "advanced_rag", label: "Model 3: Advanced RAG" },
  { value: "modular_rag", label: "Model 4: Modular RAG" },
];

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

function formatAnswerText(text) {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(
      /\s*-\s+(?=(?:Phường|Xã|Quận|Huyện|Thành phố|Thị trấn)\b)/gi,
      "\n• ",
    )
    .replace(/:\s+(?=(?:Phường|Xã|Thị trấn)\b[^;]*;)/g, ":\n• ")
    .replace(/;\s+(?=(?:Phường|Xã|Thị trấn|Quận|Huyện|Thành phố)\b)/g, "\n• ")
    .replace(/\.\s+(?=Vui lòng)/g, ".\n\n")
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

const DEFAULT_MODEL = "modular_rag";
const DEFAULT_PROVIDER = "gemini";
// id trong bảng provinces_new (khớp tiền tố "p1_" của mã đơn vị, vd p1_0073).
// Chỉ khai báo tỉnh đã có dữ liệu thật; thêm tỉnh khác khi nó được batch-test.
const PROVINCE_IDS = { tphcm: 1 };
// Giá trị phải khớp khóa trong PROVIDERS của qa.controller.js (xem lệnh kiểm tra trong hướng dẫn)
const PROVIDER_OPTIONS = [
  { value: "gemini", label: "Gemini (mặc định)" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
];
const STORE_KEY = "vnab_conversations_v1";
const UI_KEY = "vnab_ui_v1";
const MAX_CONVERSATIONS = 50;
const EMPTY = [];

function loadConversations() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((c) => c && c.id && c.sessionId && Array.isArray(c.messages))
      .map((c) => {
        // trang bị tải lại khi đang chờ câu trả lời: báo rõ thay vì để câu hỏi treo
        const last = c.messages[c.messages.length - 1];
        if (last && last.role === "user") {
          return {
            ...c,
            messages: [
              ...c.messages,
              {
                role: "bot",
                kind: "no-answer",
                content:
                  "Chưa nhận được câu trả lời cho câu hỏi này (trang đã được tải lại giữa chừng). Hãy hỏi lại.",
              },
            ],
          };
        }
        return c;
      });
  } catch {
    return [];
  }
}

function loadUi() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function makeId() {
  return (
    "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  );
}

function makeTitle(q) {
  const t = q.replace(/\s+/g, " ").trim();
  return t.length > 44 ? t.slice(0, 44) + "…" : t;
}

function SealMark({ size = 28 }) {
  return (
    <svg
      className="seal-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M20 36 L32 22 L44 36"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function App() {
  // đọc lịch sử và trạng thái giao diện đã lưu (một lần khi mở trang)
  const [initial] = useState(() => {
    const list = loadConversations();
    const ui = loadUi();
    const conv = list.find((c) => c.id === ui.activeId) || null;
    const provinceOk = MOCK_PROVINCES.some((p) => p.code === ui.province);
    return {
      conversations: list,
      activeId: conv ? conv.id : null,
      province: conv ? conv.province : provinceOk ? ui.province : "tphcm",
      model: MODEL_OPTIONS.some((m) => m.value === ui.model)
        ? ui.model
        : DEFAULT_MODEL,
      provider: PROVIDER_OPTIONS.some((p) => p.value === ui.provider)
        ? ui.provider
        : DEFAULT_PROVIDER,
    };
  });
  const [conversations, setConversations] = useState(initial.conversations);
  const [activeId, setActiveId] = useState(initial.activeId); // null = cuộc trò chuyện trống, chưa lưu
  const [selectedProvince, setSelectedProvince] = useState(initial.province);
  const [model, setModel] = useState(initial.model);
  const [provider, setProvider] = useState(initial.provider);
  const [chatInput, setChatInput] = useState("");
  const [typingId, setTypingId] = useState(null); // id cuộc trò chuyện đang chờ câu trả lời
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [backendOk, setBackendOk] = useState(null); // null | true | false
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // cuộc trò chuyện đang chờ xác nhận xóa

  const threadRef = useRef(null);
  const textareaRef = useRef(null);
  const cancelBtnRef = useRef(null);

  const isLive = useLiveApi(selectedProvince);
  const currentProvince = MOCK_PROVINCES.find(
    (p) => p.code === selectedProvince,
  );
  const active = conversations.find((c) => c.id === activeId) || null;
  const messages = active ? active.messages : EMPTY;
  const busy = typingId !== null;
  const isTyping = typingId !== null && typingId === activeId;
  const sortedConversations = [...conversations].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );

  // ---------- effects ----------
  useEffect(() => {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)),
      );
    } catch {
      /* trình duyệt chặn lưu trữ: bỏ qua, lịch sử chỉ sống trong phiên này */
    }
  }, [conversations]);

  useEffect(() => {
    try {
      localStorage.setItem(
        UI_KEY,
        JSON.stringify({
          activeId,
          province: selectedProvince,
          model,
          provider,
        }),
      );
    } catch {
      /* bỏ qua */
    }
  }, [activeId, selectedProvince, model, provider]);

  useEffect(() => {
    if (!isLive) {
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
  }, [selectedProvince, isLive]);

  useEffect(() => {
    if (!pendingDelete) return;
    if (cancelBtnRef.current) cancelBtnRef.current.focus();
    function onKey(e) {
      if (e.key === "Escape") setPendingDelete(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTo({
        top: threadRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isTyping, activeId]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [chatInput]);

  // ---------- helpers ----------
  function provinceName(code) {
    return MOCK_PROVINCES.find((p) => p.code === code)?.name || code;
  }

  function updateConversation(id, fn) {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }

  function newChat() {
    setActiveId(null);
    setChatInput("");
    setSidebarOpen(false);
    if (textareaRef.current) textareaRef.current.focus();
  }

  function openConversation(c) {
    setSelectedProvince(c.province);
    setActiveId(c.id);
    setChatInput("");
    setSidebarOpen(false);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
    setPendingDelete(null);
  }

  function selectProvince(code) {
    if (code === selectedProvince) return;
    setSelectedProvince(code);
    setActiveId(null);
    setChatInput("");
  }

  function suggestions() {
    if (isLive) {
      return [
        "Phường Bến Nghé cũ bây giờ là phường gì?",
        "Phường Sài Gòn được sáp nhập từ những phường nào?",
        "Phường Đa Kao cũ bây giờ thuộc phường nào?",
      ];
    }
    return MOCK_UNITS.filter((u) => u.province === selectedProvince)
      .slice(0, 3)
      .map((u) => `${u.old_names[0]} cũ bây giờ thuộc đơn vị nào?`);
  }

  async function copyAnswer(index) {
    try {
      await navigator.clipboard.writeText(messages[index].content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1600);
    } catch {
      /* trình duyệt chặn clipboard: bỏ qua */
    }
  }

  // ---------- gửi câu hỏi ----------
  async function sendChat(textOverride) {
    const q = (textOverride ?? chatInput).trim();
    if (!q || busy) return;
    const modelAtSend = model;
    // Model 1 (rule_based) không gọi LLM nên không gửi provider
    const providerAtSend = modelAtSend !== "rule_based" ? provider : undefined;
    const userMsg = { role: "user", kind: "text", content: q };

    let convId = activeId;
    let sessionId;
    if (!convId) {
      convId = makeId();
      sessionId = "demo_" + Date.now();
      const conv = {
        id: convId,
        province: selectedProvince,
        title: makeTitle(q),
        sessionId,
        messages: [userMsg],
        updatedAt: Date.now(),
      };
      setConversations((prev) => [conv, ...prev]);
      setActiveId(convId);
    } else {
      sessionId = active.sessionId;
      updateConversation(convId, (c) => ({
        ...c,
        messages: [...c.messages, userMsg],
        updatedAt: Date.now(),
      }));
    }
    setChatInput("");
    setTypingId(convId);

    let response;
    if (isLive) {
      try {
        const r = await fetch(`${API_BASE_URL}/qa/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            session_id: sessionId,
            model: modelAtSend,
            llm_provider: providerAtSend,
            province_id: PROVINCE_IDS[selectedProvince],
          }),
        });
        response = await r.json();
      } catch {
        response = {
          success: false,
          data: null,
          message:
            "Không kết nối được máy chủ. Hãy kiểm tra backend đang chạy.",
          error_code: "INTERNAL_ERROR",
        };
      }
    } else {
      await new Promise((r) => setTimeout(r, 550));
      response = mockAsk(q, selectedProvince);
    }

    setTypingId(null);

    let botMsg;
    if (response.data && response.data.answer) {
      const d = response.data;
      botMsg = {
        role: "bot",
        kind: "answer",
        content: d.answer,
        answerType: d.answer_type,
        confidence: d.confidence,
        sources: d.sources || [],
        modelUsed: isLive ? modelAtSend : null,
        providerUsed: isLive ? providerAtSend || null : null,
        rewritten: d.rewritten_question || null,
      };
    } else if (response.success === false) {
      botMsg = {
        role: "bot",
        kind: "no-answer",
        content:
          "Hệ thống chưa trả lời được lúc này. Hãy thử lại sau ít phút, hoặc chọn nhà cung cấp LLM khác ở thanh phía trên.",
      };
    } else {
      botMsg = {
        role: "bot",
        kind: "no-answer",
        content:
          (response.data && response.data.suggestion) ||
          response.message ||
          "Chưa tìm được câu trả lời đủ tin cậy cho câu hỏi này.",
      };
    }
    updateConversation(convId, (c) => ({
      ...c,
      messages: [...c.messages, botMsg],
      updatedAt: Date.now(),
    }));
  }

  // ---------- render ----------
  const showHero = messages.length === 0 && !isTyping;

  return (
    <div className={`shell ${sidebarOpen ? "drawer-open" : ""}`}>
      <aside className="sidebar" aria-label="Lịch sử trò chuyện">
        <div className="side-head">
          <SealMark size={28} />
          <div className="side-brand">
            <span className="brand-name">Địa giới hành chính</span>
            <span className="brand-sub">Khu vực miền Nam</span>
          </div>
        </div>

        <button className="new-chat" onClick={newChat}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          Cuộc trò chuyện mới
        </button>

        <div className="side-list">
          {sortedConversations.length === 0 ? (
            <p className="side-empty">
              Chưa có cuộc trò chuyện nào. Câu hỏi của bạn sẽ được lưu ở đây.
            </p>
          ) : (
            sortedConversations.map((c) => (
              <div
                key={c.id}
                className={`side-item ${c.id === activeId ? "on" : ""}`}
              >
                <button
                  className="side-open"
                  onClick={() => openConversation(c)}
                  aria-current={c.id === activeId ? "true" : undefined}
                >
                  <span className="side-title">{c.title}</span>
                  <span className="side-prov">{provinceName(c.province)}</span>
                </button>
                <button
                  className="side-del"
                  onClick={() => setPendingDelete(c)}
                  aria-label={`Xóa cuộc trò chuyện: ${c.title}`}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="scrim" onClick={() => setSidebarOpen(false)} />

      <div className="main">
        <div className="main-top">
          <button
            className="menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Mở lịch sử trò chuyện"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="province-row" role="tablist" aria-label="Tỉnh/thành">
            {MOCK_PROVINCES.map((p) => (
              <button
                key={p.code}
                role="tab"
                aria-selected={p.code === selectedProvince}
                className={`pchip ${p.code === selectedProvince ? "on" : ""}`}
                onClick={() => selectProvince(p.code)}
              >
                <span className={`dot ${p.hasRealData ? "" : "mock"}`} />
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {!currentProvince.hasRealData && (
          <div className="notice">
            Dữ liệu của {currentProvince.name} là dữ liệu minh họa, chưa phải
            ánh xạ pháp lý thật. Hãy chọn TP. Hồ Chí Minh để xem dữ liệu đã kiểm
            chứng.
          </div>
        )}

        <div className="tech-bar">
          <span>
            Dữ liệu: <b>{isLive ? "backend thật" : "mock"}</b>
            {isLive && backendOk === true && " · backend kết nối tốt"}
            {isLive && backendOk === false && " · backend không phản hồi"}
          </span>
          <span>Địa chỉ API: {isLive ? API_BASE_URL : "không dùng"}</span>
          <label>
            Mô hình trả lời
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!isLive}
            >
              {MODEL_OPTIONS.map((mo) => (
                <option key={mo.value} value={mo.value}>
                  {mo.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tech-provider">
            Nhà cung cấp LLM
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={!isLive || model === "rule_based"}
            >
              {PROVIDER_OPTIONS.map((po) => (
                <option key={po.value} value={po.value}>
                  {po.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="chat-view">
          <div className="thread" ref={threadRef}>
            <div className="thread-inner">
              {showHero && (
                <div className="hero">
                  <h1>Bạn muốn tra cứu đơn vị hành chính nào?</h1>
                  <p>
                    Hỏi bằng câu tự nhiên về một phường hoặc xã cũ. Mỗi câu trả
                    lời đi kèm căn cứ pháp lý để bạn đối chiếu.
                  </p>
                  <div className="suggest">
                    {suggestions().map((s) => (
                      <button
                        key={s}
                        onClick={() => sendChat(s)}
                        disabled={busy}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="turn user">
                    <div className="user-bubble">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="turn bot">
                    <div className="avatar">
                      <SealMark size={22} />
                    </div>
                    <div className="bot-body">
                      {m.kind === "no-answer" ? (
                        <div className="no-answer">{m.content}</div>
                      ) : (
                        <div className="answer-text">
                          {formatAnswerText(m.content)}
                        </div>
                      )}

                      {m.kind === "answer" && (
                        <>
                          {(m.sources || []).length > 0 && (
                            <div className="sources">
                              <span className="sources-title">
                                Căn cứ pháp lý
                              </span>
                              {(m.sources || []).map((s, si) => {
                                const label = `${s.title}${s.section ? `, ${s.section}` : ""}`;
                                return /^https?:\/\//.test(
                                  s.source_url || "",
                                ) ? (
                                  <a
                                    key={si}
                                    className="source-chip link"
                                    href={s.source_url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {label}
                                  </a>
                                ) : (
                                  <span key={si} className="source-chip">
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <div className="tech-line">
                            answer_type: {m.answerType} ·{" "}
                            {m.modelUsed === "advanced_rag"
                              ? "điểm rerank"
                              : "confidence"}
                            : {m.confidence}
                            {m.modelUsed && ` · model: ${m.modelUsed}`}
                            {m.providerUsed && ` · provider: ${m.providerUsed}`}
                            {m.rewritten && (
                              <div>Câu hỏi sau khi viết lại: {m.rewritten}</div>
                            )}
                          </div>

                          <div className="actions">
                            <button
                              className="ghost sm"
                              onClick={() => copyAnswer(i)}
                            >
                              {copiedIndex === i ? "Đã sao chép" : "Sao chép"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ),
              )}

              {isTyping && (
                <div className="turn bot">
                  <div className="avatar">
                    <SealMark size={22} />
                  </div>
                  <div className="bot-body">
                    <div className="typing" aria-label="Đang trả lời">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="composer-wrap">
            <div className="composer">
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder={`Hỏi về một phường, xã cũ của ${currentProvince.name}...`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
              />
              <button
                className="send"
                onClick={() => sendChat()}
                disabled={!chatInput.trim() || busy}
                aria-label="Gửi câu hỏi"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 19V5M5 12l7-7 7 7"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <p className="fineprint">
              {isLive
                ? "Căn cứ: Nghị quyết 1685/NQ-UBTVQH15. Hãy đối chiếu văn bản gốc khi dùng cho thủ tục pháp lý."
                : "Đang dùng dữ liệu minh họa của tỉnh này."}
            </p>
          </div>
        </div>
      </div>

      {pendingDelete && (
        <div className="modal-back" onClick={() => setPendingDelete(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="del-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="del-title">Xóa cuộc trò chuyện này?</h2>
            <p>
              &ldquo;{pendingDelete.title}&rdquo; sẽ bị xóa khỏi lịch sử trên
              trình duyệt này và không thể khôi phục.
            </p>
            <div className="modal-actions">
              <button
                ref={cancelBtnRef}
                className="ghost"
                onClick={() => setPendingDelete(null)}
              >
                Hủy
              </button>
              <button className="danger" onClick={confirmDelete}>
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
