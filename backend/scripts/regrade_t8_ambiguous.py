# regrade_t8_ambiguous.py — CHỈ ĐỌC. Chấm lại nhóm T8_ambiguous (tên đơn vị trùng ở nhiều nơi).
# Vì sao: must_contain của nhóm này chỉ là chữ "quận", nên (a) sai với các tỉnh dùng "huyện", "thị xã",
# (b) không kiểm tra được việc hệ thống có thật sự hỏi lại hay liệt kê đủ các đơn vị trùng tên.
# Quy tắc ĐÚNG: câu trả lời (1) hỏi lại / yêu cầu cung cấp thêm quận-huyện, HOẶC (2) nêu từ 2 nơi khác nhau trở lên
# kèm đơn vị mới của từng nơi. SAI: khẳng định một đơn vị duy nhất, hoặc không trả lời (no_answer).
# Chạy từ thư mục backend:
#   python scripts/regrade_t8_ambiguous.py "data/results/official_588/*/results_*.xlsx" [file_ra.xlsx]
import glob, os, re, sys, unicodedata
import pandas as pd

pattern = sys.argv[1] if len(sys.argv) > 1 else "data/results/official_588/*/results_*.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "regrade_t8_ambiguous.xlsx"
files = sorted(glob.glob(pattern, recursive=True))
if not files: sys.exit(f"Không thấy file nào khớp: {pattern}")

def norm(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(s)).lower()).strip()

CLARIFY = re.compile(
    r"(vui lòng|cung cấp thêm|cho (tôi|mình) biết|cho biết thêm|bạn muốn hỏi|bạn đang hỏi|làm rõ|cụ thể hơn|"
    r"thuộc (quận|huyện|thành phố|thị xã|tỉnh) nào|nhiều .{0,40}(cùng tên|ở các|khác nhau)|có nhiều)")
STOP = {"cũ", "nay", "thuộc", "theo", "vẫn", "giờ", "hiện", "là", "sau", "trong", "của", "và", "còn", "được", "cùng", "ở", "nên"}

def parent_labels(a):
    out = set()
    for m in re.finditer(r"(quận|huyện|thị xã|thành phố)\s+((?:[a-zà-ỹ0-9]+\s?){1,4})", a):
        words = []
        for w in m.group(2).split():
            if w in STOP: break
            words.append(w)
        if words and "hồ chí minh" not in " ".join(words):
            out.add(m.group(1) + " " + " ".join(words[:3]))
    return out

def grade(answer, answer_type):
    if answer_type == "no_answer" or str(answer).strip().lower() in ("", "nan", "none"):
        return False, "không trả lời"
    a = norm(answer)
    n = len(parent_labels(a))
    if CLARIFY.search(a): return True, "hỏi lại / nêu có nhiều nơi trùng tên"
    if n >= 2: return True, f"nêu {n} nơi khác nhau"
    return False, "khẳng định một đơn vị duy nhất"

parts = []
for f in files:
    d = pd.read_excel(f)
    d["_dir"] = os.path.basename(os.path.dirname(f)); d["_file"] = os.path.basename(f)
    m = re.search(r"(\d{4}-\d\d-\d\dT[\d-]+Z)", f); d["_run"] = m.group(1) if m else ""
    parts.append(d)
d = pd.concat(parts, ignore_index=True)
for c in ["test_id", "model", "llm_provider", "category", "answer", "answer_type", "pass", "success"]:
    if c not in d.columns: sys.exit(f"Thiếu cột {c}")
d = d[(d.category == "T8_ambiguous") & (d.success == True)].sort_values("_run").drop_duplicates(["test_id", "model", "llm_provider"], keep="last").copy()
res = d.apply(lambda r: grade(r["answer"], r["answer_type"]), axis=1)
d["pass_moi"] = [x[0] for x in res]; d["ly_do"] = [x[1] for x in res]

tot = d.groupby(["llm_provider", "model"]).agg(n=("pass", "size"), dat_cu=("pass", "sum"), dat_moi=("pass_moi", "sum")).reset_index()
tot["chenh"] = tot.dat_moi - tot.dat_cu
mau = d.sample(n=min(30, len(d)), random_state=11)[["_dir", "test_id", "model", "llm_provider", "question", "answer_type", "answer", "pass", "pass_moi", "ly_do"]].copy()
mau["nhan_tay"] = ""   # Đ nếu hệ thống xử lý đúng việc trùng tên, S nếu không
with pd.ExcelWriter(OUT) as w:
    tot.to_excel(w, sheet_name="tong_hop", index=False)
    mau.to_excel(w, sheet_name="mau_kiem_tay", index=False)
    d[["_dir", "test_id", "model", "llm_provider", "question", "answer_type", "answer", "pass", "pass_moi", "ly_do"]].to_excel(w, sheet_name="chi_tiet", index=False)
print(f"{len(files)} file, {len(d)} dòng T8_ambiguous.\n"); print(tot.to_string(index=False))
print(f"\nĐã ghi {OUT}. KIỂM TAY: sheet mau_kiem_tay ({len(mau)} dòng), điền nhan_tay = Đ hoặc S, rồi so với cột pass_moi.")
print("Độ khớp = số dòng nhan_tay trùng với pass_moi / tổng số dòng đã gán. Chỉ dùng khi độ khớp gần 100%.")
