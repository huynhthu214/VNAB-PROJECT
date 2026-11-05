import { useState, useRef, useEffect } from "react";
import { API_BASE_URL } from "../api.js";
import {
  MOCK_UNITS,
  GENERIC_LEGAL_BASIS,
  provinceByCode,
  oldProvinceList,
} from "../data.js";
import { STORE_KEY, loadUi, saveUi } from "../storage.js";
import { Icon, SealMark, ProvinceChips } from "./shared.jsx";

/* =========================================================
   LOGIC HỎI ĐÁP — giữ nguyên từ App.jsx cũ.
   Khác biệt duy nhất: tỉnh đang chọn nay do App quản lý (props
   province / onProvince) để dùng chung với các tab khác.
   ========================================================= */
function useLiveApi(provinceCode) {
  return Boolean(provinceByCode(provinceCode)?.apiCode);
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
    .replace(/[̀-ͯ]/g, "")
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
  const pName = provinceByCode(selectedProvince).name;
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
      return "Hệ thống chưa trả lời được lúc này. Hãy thử lại sau ít phút, hoặc chọn nhà cung cấp LLM khác ở mục Tùy chọn.";
  }
}
// Giá trị phải khớp khóa trong PROVIDERS của qa.controller.js
const PROVIDER_OPTIONS = [
  { value: "gemini", label: "Gemini" },
  { value: "cohere", label: "Cohere" },
];
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

function makeId() {
  return (
    "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  );
}

function makeTitle(q) {
  const t = q.replace(/\s+/g, " ").trim();
  return t.length > 44 ? t.slice(0, 44) + "…" : t;
}

export default function ChatTab({
  visible,
  province: selectedProvince,
  onProvince,
  prefill,
}) {
  // đọc lịch sử và trạng thái giao diện đã lưu (một lần khi mở trang)
  const [initial] = useState(() => {
    const list = loadConversations();
    const ui = loadUi();
    const conv = list.find((c) => c.id === ui.activeId) || null;
    return {
      conversations: list,
      activeId: conv && conv.province === selectedProvince ? conv.id : null,
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
  const [model, setModel] = useState(initial.model);
  const [provider, setProvider] = useState(initial.provider);
  const [chatInput, setChatInput] = useState("");
  const [typingId, setTypingId] = useState(null); // id cuộc trò chuyện đang chờ câu trả lời
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [backendOk, setBackendOk] = useState(null); // null | true | false
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // cuộc trò chuyện đang chờ xác nhận xóa

  const threadRef = useRef(null);
  const textareaRef = useRef(null);
  const cancelBtnRef = useRef(null);
  const optsRef = useRef(null);

  const isLive = useLiveApi(selectedProvince);
  const currentProvince = provinceByCode(selectedProvince);
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
    saveUi({ activeId, model, provider });
  }, [activeId, model, provider]);

  // tỉnh bị đổi từ nơi khác (bản đồ, tab khác): bỏ cuộc trò chuyện của tỉnh cũ
  useEffect(() => {
    if (active && active.province !== selectedProvince) {
      setActiveId(null);
      setChatInput("");
    }
  }, [selectedProvince, active]);

  // câu hỏi được chuyển sang từ tab Tra cứu/Khám phá: đặt vào ô nhập, chưa gửi
  useEffect(() => {
    if (!prefill?.nonce) return;
    setActiveId(null);
    setChatInput(prefill.text || "");
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [prefill?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // đóng popover tùy chọn khi bấm ra ngoài / nhấn Esc
  useEffect(() => {
    if (!optsOpen) return;
    function onDown(e) {
      if (optsRef.current && !optsRef.current.contains(e.target))
        setOptsOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOptsOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [optsOpen]);

  useEffect(() => {
    if (visible && threadRef.current) {
      threadRef.current.scrollTo({
        top: threadRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isTyping, activeId, visible]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !visible) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [chatInput, visible]);

  // ---------- helpers ----------
  function provinceName(code) {
    return provinceByCode(code)?.name || code;
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
    onProvince(c.province);
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
    onProvince(code);
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

  // hỏi lại: bỏ câu trả lời cuối rồi gửi lại đúng câu hỏi đó (dùng mô hình đang chọn)
  function regenerate() {
    if (busy || !active) return;
    const msgs = active.messages;
    if (msgs[msgs.length - 1]?.role !== "bot") return;
    let ui = msgs.length - 2;
    while (ui >= 0 && msgs[ui].role !== "user") ui--;
    if (ui < 0) return;
    const q = msgs[ui].content;
    updateConversation(active.id, (c) => ({
      ...c,
      messages: c.messages.slice(0, -1),
      updatedAt: Date.now(),
    }));
    runQuery(active.id, active.sessionId, q);
  }

  // sửa câu hỏi cuối: đưa nội dung về ô nhập và bỏ câu hỏi + câu trả lời cũ
  function editLast(index) {
    if (busy || !active) return;
    const text = messages[index].content;
    if (index === 0) {
      const id = active.id;
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setActiveId(null);
    } else {
      updateConversation(active.id, (c) => ({
        ...c,
        messages: c.messages.slice(0, index),
        updatedAt: Date.now(),
      }));
    }
    setChatInput(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  // ---------- gửi câu hỏi ----------
  async function sendChat(textOverride) {
    const q = (textOverride ?? chatInput).trim();
    if (!q || busy) return;
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
    await runQuery(convId, sessionId, q);
  }

  // gọi backend (hoặc mock) cho câu hỏi q rồi thêm câu trả lời vào cuộc trò chuyện convId
  async function runQuery(convId, sessionId, q) {
    const modelAtSend = model;
    const provinceAtSend = currentProvince;
    // Model 1 (rule_based) không gọi LLM nên không gửi provider
    const providerAtSend = modelAtSend !== "rule_based" ? provider : undefined;
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
  const lastUserIdx = messages.reduce((a, m, i) => (m.role === "user" ? i : a), -1);
  const oldProvinces = oldProvinceList(currentProvince);
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
    <div
      className={`chat-shell ${sidebarOpen ? "drawer-open" : ""}`}
      hidden={!visible}
    >
      <aside className="sidebar" aria-label="Lịch sử trò chuyện">
        <div className="side-head">
          <span className="side-title-h">Lịch sử</span>
          <button
            className="side-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Đóng lịch sử"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <button className="new-chat" onClick={newChat}>
          <Icon name="plus" size={16} stroke={2.2} />
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
                  <Icon name="close" size={14} stroke={2.2} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="scrim" onClick={() => setSidebarOpen(false)} />

      <div className="chat-main">
        <div className="chat-top">
          <button
            className="menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Mở lịch sử trò chuyện"
          >
            <Icon name="history" size={19} />
          </button>
          <ProvinceChips value={selectedProvince} onChange={selectProvince} />
          <div className="opts" ref={optsRef}>
            <button
              className={`opts-btn ${optsOpen ? "on" : ""}`}
              onClick={() => setOptsOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={optsOpen}
            >
              <span className={`status-dot ${statusKind}`} />
              <Icon name="sliders" size={16} />
              <span className="opts-label">Tùy chọn</span>
            </button>
            {optsOpen && (
              <div className="opts-pop" role="dialog" aria-label="Tùy chọn trả lời">
                <div className="opts-row">
                  <span className="opts-cap">Mô hình trả lời</span>
                  <div className="seg col" role="radiogroup" aria-label="Mô hình trả lời">
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
                </div>
                <label className="opts-row">
                  <span className="opts-cap">Nhà cung cấp LLM</span>
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
                <div
                  className={`status ${statusKind}`}
                  title={isLive ? `API: ${API_BASE_URL}` : undefined}
                >
                  {statusText}
                </div>
              </div>
            )}
          </div>
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
                <div className="hero" style={{ "--c": currentProvince.color }}>
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
                      <Icon name="arrow" size={22} />
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
                    <div className="user-col">
                      <div className="user-bubble">{m.content}</div>
                      <div className="msg-actions">
                        <button
                          className="act"
                          onClick={() => copyAnswer(i)}
                          aria-label="Sao chép câu hỏi"
                          title={copiedIndex === i ? "Đã sao chép" : "Sao chép"}
                        >
                          <Icon name={copiedIndex === i ? "check" : "copy"} size={15} />
                        </button>
                        {i === lastUserIdx && !busy && (
                          <button
                            className="act"
                            onClick={() => editLast(i)}
                            aria-label="Sửa câu hỏi"
                            title="Sửa câu hỏi"
                          >
                            <Icon name="edit" size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="turn bot">
                    <div className="avatar">
                      <SealMark size={20} />
                    </div>
                    <div className="bot-body">
                      {m.kind === "no-answer" ? (
                        <div className="no-answer" role="status">
                          <Icon name="alert" size={16} stroke={2} />
                          <span>{m.content}</span>
                        </div>
                      ) : (
                        <div className="answer-text">
                          {formatAnswerText(m.content)}
                        </div>
                      )}

                      {m.kind === "no-answer" && i === messages.length - 1 && !busy && (
                        <div className="msg-actions inline retry">
                          <button className="act text" onClick={regenerate}>
                            <Icon name="refresh" size={15} />
                            Thử lại
                          </button>
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
                                const icon = <Icon name="file" size={13} />;
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
                            <span className="msg-actions inline">
                              <button
                                className="act"
                                onClick={() => copyAnswer(i)}
                                aria-label="Sao chép câu trả lời"
                                title={copiedIndex === i ? "Đã sao chép" : "Sao chép"}
                              >
                                <Icon name={copiedIndex === i ? "check" : "copy"} size={15} />
                              </button>
                              {i === messages.length - 1 && !busy && (
                                <button
                                  className="act"
                                  onClick={regenerate}
                                  aria-label="Hỏi lại"
                                  title="Hỏi lại (tạo câu trả lời mới)"
                                >
                                  <Icon name="refresh" size={15} />
                                </button>
                              )}
                            </span>
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
                <Icon name="send" size={18} stroke={2.4} />
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
