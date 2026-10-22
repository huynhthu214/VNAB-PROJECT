import { useState, useRef, useEffect } from "react";
import "./App.css";

/* =========================================================
   CẤU HÌNH API
   Tỉnh nào có apiCode (khớp cột provinces_new.code trong DB) → gọi backend thật
   Tỉnh có apiCode: null → dùng mock (chưa batch-test / chưa có dữ liệu)
   Muốn bật một tỉnh: điền apiCode của tỉnh đó trong MOCK_PROVINCES bên dưới.
   ========================================================= */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

function useLiveApi(provinceCode) {
  return Boolean(MOCK_PROVINCES.find((p) => p.code === provinceCode)?.apiCode);
}
const MODEL_OPTIONS = [
  { value: "rule_based", label: "Model 1: Rule-based", short: "Rule-based" },
  { value: "naive_rag", label: "Model 2: Naive RAG", short: "Naive RAG" },
  {
    value: "advanced_rag",
    label: "Model 3: Advanced RAG",
    short: "Advanced RAG",
  },
  { value: "modular_rag", label: "Model 4: Modular RAG", short: "Modular RAG" },
];

const ANSWER_TYPE_LABEL = {
  structured_lookup: "Tra cứu trực tiếp",
  rag_generated: "Tổng hợp từ văn bản",
};

function fmtNum(n) {
  return typeof n === "number" ? n.toFixed(3) : String(n ?? "—");
}

/* =========================================================
   DANH SÁCH 8 TỈNH/THÀNH MIỀN NAM SAU SÁP NHẬP (Nghị quyết 202/2025/QH15)
   ========================================================= */
const MOCK_PROVINCES = [
  {
    code: "tphcm",
    name: "TP. Hồ Chí Minh",
    merged: "TP.HCM, Bình Dương, Bà Rịa - Vũng Tàu",
    apiCode: "HCM",
    legalBasis: "Nghị quyết 1685/NQ-UBTVQH15",
    samples: [
      "Phường Bến Nghé cũ bây giờ là phường gì?",
      "Phường Sài Gòn được sáp nhập từ những phường nào?",
      "Phường Đa Kao cũ bây giờ thuộc phường nào?",
    ],
  },
  {
    code: "dongnai",
    name: "Đồng Nai",
    merged: "Đồng Nai, Bình Phước",
    apiCode: "DN",
  },
  {
    code: "tayninh",
    name: "Tây Ninh",
    merged: "Tây Ninh, Long An",
    apiCode: "TN",
  },
  {
    code: "cantho",
    name: "Cần Thơ",
    merged: "Cần Thơ, Hậu Giang, Sóc Trăng",
    apiCode: "CT",
  },
  {
    code: "vinhlong",
    name: "Vĩnh Long",
    merged: "Vĩnh Long, Bến Tre, Trà Vinh",
    apiCode: "VL",
  },
  {
    code: "dongthap",
    name: "Đồng Tháp",
    merged: "Đồng Tháp, Tiền Giang",
    apiCode: "DT",
  },
  {
    code: "angiang",
    name: "An Giang",
    merged: "An Giang, Kiên Giang",
    apiCode: "AG",
  },
  {
    code: "camau",
    name: "Cà Mau",
    merged: "Cà Mau, Bạc Liêu",
    apiCode: "CM",
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
// Backend nhận province_code (mã viết tắt trong provinces_new.code) vì id số khác nhau giữa các máy.
const QUESTION_MAX_LENGTH = 500; // khớp giới hạn ở qa.controller.js
const GENERIC_LEGAL_BASIS =
  "Nghị quyết 202/2025/QH15 và nghị quyết chi tiết cấp xã của tỉnh/thành";

// Chuyển phản hồi lỗi của backend thành câu hiển thị cho người dùng
function errorMessage(resp) {
  switch (resp?.error_code) {
    case "RATE_LIMITED": {
      const sec = resp.retry_after_ms
        ? Math.ceil(resp.retry_after_ms / 1000)
        : null;
      return `${resp.message}${sec ? ` (thử lại sau khoảng ${sec} giây)` : ""}`;
    }
    case "SERVICE_UNAVAILABLE":
    case "VALIDATION_ERROR":
      return resp.message;
    default:
      return "Hệ thống chưa trả lời được lúc này. Hãy thử lại sau ít phút, hoặc chọn nhà cung cấp LLM khác ở thanh phía trên.";
  }
}
// Giá trị phải khớp khóa trong PROVIDERS của qa.controller.js (xem lệnh kiểm tra trong hướng dẫn)
const PROVIDER_OPTIONS = [
  { value: "gemini", label: "Gemini" },
  { value: "cohere", label: "Cohere" },
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
      if (currentProvince.samples) return currentProvince.samples;
      return currentProvince.merged
        .split(",")
        .map((x) => x.trim())
        .slice(0, 3)
        .map((x) => `${x} cũ nay thuộc tỉnh, thành phố nào?`);
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
    const provinceAtSend = currentProvince;
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
            province_code: provinceAtSend.apiCode,
          }),
        });
        // 400/429/503 vẫn trả JSON chuẩn {success:false, error_code, message}
        response = await r.json().catch(() => ({
          success: false,
          data: null,
          message: `Máy chủ trả về lỗi ${r.status}.`,
          error_code: "INTERNAL_ERROR",
        }));
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
        content: errorMessage(response),
      };
    } else {
      // backend gắn cứng "TP.HCM" trong suggestion nên tự dựng câu theo tỉnh đang chọn
      botMsg = {
        role: "bot",
        kind: "no-answer",
        content:
          response.error_code === "NO_ANSWER_FOUND"
            ? `Câu hỏi nằm ngoài phạm vi dữ liệu hệ thống hiện có (${provinceAtSend.name} sau sắp xếp).`
            : response.message ||
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
  const oldProvinces = currentProvince.merged.split(",").map((x) => x.trim());
  const statusKind = !isLive
    ? "idle"
    : backendOk === true
      ? "ok"
      : backendOk === false
        ? "bad"
        : "wait";
  const statusText = !isLive
    ? "Đang dùng dữ liệu minh họa"
    : backendOk === true
      ? "Backend kết nối tốt"
      : backendOk === false
        ? "Backend không phản hồi"
        : "Đang kiểm tra backend";
  const nearLimit = chatInput.length >= QUESTION_MAX_LENGTH - 80;

  return (
    <div className={`shell ${sidebarOpen ? "drawer-open" : ""}`}>
      <aside className="sidebar" aria-label="Lịch sử trò chuyện">
        <div className="side-head">
          <SealMark size={30} />
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
                className={`ptab ${p.code === selectedProvince ? "on" : ""}`}
                onClick={() => selectProvince(p.code)}
              >
                <span className={`dot ${p.apiCode ? "" : "mock"}`} />
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar">
          <div className="seg" role="radiogroup" aria-label="Mô hình trả lời">
            {MODEL_OPTIONS.map((mo) => (
              <button
                key={mo.value}
                role="radio"
                aria-checked={model === mo.value}
                className={`seg-btn ${model === mo.value ? "on" : ""}`}
                onClick={() => setModel(mo.value)}
                disabled={!isLive}
                title={mo.label}
              >
                {mo.short}
              </button>
            ))}
          </div>
          <label>
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
          <span
            className={`status ${statusKind}`}
            title={isLive ? `API: ${API_BASE_URL}` : undefined}
          >
            {statusText}
          </span>
        </div>

        {!isLive && (
          <div className="notice">
            Dữ liệu của {currentProvince.name} là dữ liệu minh họa, chưa phải
            ánh xạ pháp lý thật.
          </div>
        )}

        <div className="chat-view">
          <div className="thread" ref={threadRef}>
            <div className="thread-inner">
              {showHero && (
                <div className="hero">
                  <h1>Tra cứu địa giới hành chính {currentProvince.name}</h1>
                  <div
                    className="lineage"
                    aria-label={`${currentProvince.name} hợp nhất từ ${currentProvince.merged}`}
                  >
                    <div className="lineage-old">
                      {oldProvinces.map((x) => (
                        <span key={x} className="chip-old">
                          {x}
                        </span>
                      ))}
                    </div>
                    <span className="lineage-arrow" aria-hidden="true">
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M5 12h14M13 6l6 6-6 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="chip-new">{currentProvince.name}</span>
                  </div>
                  <p className="hero-lead">
                    Nhập tên phường, xã cũ để biết nay thuộc đơn vị nào, hoặc
                    hỏi ngược từ đơn vị mới. Mỗi câu trả lời có kèm căn cứ pháp
                    lý để bạn đối chiếu.
                  </p>
                  <div className="suggest">
                    {suggestions().map((sg) => (
                      <button
                        key={sg}
                        onClick={() => sendChat(sg)}
                        disabled={busy}
                      >
                        {sg}
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
                      <SealMark size={20} />
                    </div>
                    <div className="bot-body">
                      {m.kind === "no-answer" ? (
                        <div className="no-answer" role="status">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                          >
                            <circle
                              cx="12"
                              cy="12"
                              r="9"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <path
                              d="M12 7.5v5M12 16v.5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                          <span>{m.content}</span>
                        </div>
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
                              {(m.sources || []).map((src, si) => {
                                const label = `${src.title}${src.section ? `, ${src.section}` : ""}`;
                                const icon = (
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M7 3h7l5 5v13H7z M14 3v5h5"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                );
                                return /^https?:\/\//.test(
                                  src.source_url || "",
                                ) ? (
                                  <a
                                    key={si}
                                    className="source-chip link"
                                    href={src.source_url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {icon}
                                    {label}
                                  </a>
                                ) : (
                                  <span key={si} className="source-chip">
                                    {icon}
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <div className="answer-foot">
                            <span className={`badge ${m.answerType || ""}`}>
                              {ANSWER_TYPE_LABEL[m.answerType] || m.answerType}
                            </span>
                            <button
                              className="ghost"
                              onClick={() => copyAnswer(i)}
                            >
                              {copiedIndex === i ? "Đã sao chép" : "Sao chép"}
                            </button>
                          </div>

                          <details className="tech">
                            <summary>Chi tiết kỹ thuật</summary>
                            <dl className="tech-grid">
                              <dt>answer_type</dt>
                              <dd>{m.answerType}</dd>
                              <dt>
                                {m.modelUsed === "advanced_rag"
                                  ? "Điểm rerank"
                                  : "Độ tin cậy"}
                              </dt>
                              <dd>{fmtNum(m.confidence)}</dd>
                              {m.modelUsed && (
                                <>
                                  <dt>Mô hình</dt>
                                  <dd>{m.modelUsed}</dd>
                                </>
                              )}
                              {m.providerUsed && (
                                <>
                                  <dt>Nhà cung cấp</dt>
                                  <dd>{m.providerUsed}</dd>
                                </>
                              )}
                              {m.rewritten && (
                                <>
                                  <dt>Câu viết lại</dt>
                                  <dd>{m.rewritten}</dd>
                                </>
                              )}
                            </dl>
                          </details>
                        </>
                      )}
                    </div>
                  </div>
                ),
              )}

              {isTyping && (
                <div className="turn bot">
                  <div className="avatar">
                    <SealMark size={20} />
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
                maxLength={QUESTION_MAX_LENGTH}
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
              {nearLimit && (
                <span className="counter near">
                  {chatInput.length}/{QUESTION_MAX_LENGTH}
                </span>
              )}
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
                ? `Căn cứ: ${currentProvince.legalBasis || GENERIC_LEGAL_BASIS}. Hãy đối chiếu văn bản gốc khi dùng cho thủ tục pháp lý.`
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
