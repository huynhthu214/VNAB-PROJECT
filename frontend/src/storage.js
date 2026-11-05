// Trạng thái giao diện lưu ở localStorage (khóa giữ nguyên để không mất lịch sử cũ).
// Nhiều thành phần cùng ghi vào UI_KEY nên saveUi luôn gộp với giá trị đang lưu.
export const STORE_KEY = "vnab_conversations_v1";
export const UI_KEY = "vnab_ui_v1";

export function loadUi() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export function saveUi(patch) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ ...loadUi(), ...patch }));
  } catch {
    /* trình duyệt chặn lưu trữ: bỏ qua */
  }
}
