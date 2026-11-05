# relaxed_rescore.py — CHỈ ĐỌC. Đo xem bao nhiêu câu bị chấm sai chỉ vì câu trả lời viết gọn kiểu
# "các xã Hòn Tre, Lại Sơn, An Sơn" (mất chữ "xã" trước tên thứ hai trở đi) trong khi must_contain đòi "Xã Lại Sơn".
# Chạy từ thư mục backend:
#   python scripts/relaxed_rescore.py "data/batch_results/pilot_v2/*/results_gemini_*.xlsx"
#   python scripts/relaxed_rescore.py "data/batch_results/official_batch/*/results_*.xlsx"
# Tham số thứ 2 (tùy chọn): tên file ra, ví dụ relaxed_thr05.xlsx. Mặc định relaxed_rescore.xlsx.
# Ghi ra các sheet tong_hop, theo_nhom, cac_dong_doi, chi_tiet. Không sửa file kết quả nào.
import glob, os, re, sys, unicodedata
import pandas as pd

pattern = sys.argv[1] if len(sys.argv) > 1 else "data/results/pilot_v2_60/gemini/*/results_gemini_*.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "relaxed_rescore.xlsx"
files = sorted(glob.glob(pattern, recursive=True))
if not files: sys.exit(f"Không thấy file nào khớp: {pattern}")

def norm(s):
    s = unicodedata.normalize("NFC", str(s)).lower()
    return re.sub(r"\s+", " ", s).strip()

TYPE = re.compile(r"^(xã|phường|thị trấn|đặc khu|quận|huyện|thành phố|thị xã)\s+(.+)$")
# Từ chỉ cấp cha: nếu tên đơn vị chỉ xuất hiện ngay sau các từ này (vd "Thành phố Dĩ An", "Huyện Vĩnh Hưng")
# thì đó là tên cha, không phải đơn vị cần tìm. Sửa lỗi khớp lõi tên trong ngoặc cha (T2, T7).
PARENT_WORDS = ["thành phố", "thị xã", "huyện", "quận", "tỉnh"]
UNIT_TYPES = ["xã", "phường", "thị trấn", "đặc khu"]

def entity_regex(item):
    """Tên đơn vị bỏ loại ('xã', 'phường'...) và phần ngoặc cha. Tên chỉ là số (Phường 7) thì giữ nguyên loại.
    Không khớp khi tên đứng ngay sau từ chỉ cấp cha, hoặc sau một loại đơn vị khác loại cần tìm
    (must_contain 'Xã Đông Thành' không khớp 'Phường Đông Thành')."""
    it = re.sub(r"\s*\([^)]*\)", "", norm(item)).strip()
    m = TYPE.match(it)
    own = None
    if m and not m.group(2).strip().isdigit():
        own, name = m.group(1), m.group(2)
    else:
        name = it
    bad = [w for w in PARENT_WORDS if w != own] + [t for t in UNIT_TYPES if t != own]
    lookbehinds = "".join(f"(?<!{re.escape(w)} )" for w in bad)
    # không khớp nếu theo sau là hậu tố 1 chữ cái (Hưng Điền B) hay chữ/số khác
    return re.compile(lookbehinds + r"(?<!\w)" + re.escape(name) + r"(?!\w)(?!\s+[abc]\b)")

def relaxed_ok(must_contain, answer):
    a = norm(answer)
    items = [x.strip() for x in str(must_contain).split("|") if x.strip()]
    return bool(items) and all(entity_regex(x).search(a) for x in items)

parts = []
for f in files:
    d = pd.read_excel(f)
    d["_file"] = os.path.basename(f); d["_dir"] = os.path.basename(os.path.dirname(f))
    m = re.search(r"(\d{4}-\d\d-\d\dT[\d-]+Z)", f); d["_run"] = m.group(1) if m else ""
    parts.append(d)
d = pd.concat(parts, ignore_index=True)
_thieu = [c for c in ["test_id", "model", "llm_provider", "category", "pass", "success", "answer", "must_contain"] if c not in d.columns]
if _thieu: sys.exit(f"Thiếu cột bắt buộc trong file kết quả: {_thieu}. Cột hiện có: {list(d.columns)[:25]}")
_no_reason = "evaluation_reason" not in d.columns
for _c in ["forbidden_items", "evaluation_reason", "answer_type"]:
    if _c not in d.columns:
        print(f"Cảnh báo: không có cột {_c} trong một số file, coi như rỗng (số câu đổi có thể ít hơn thực tế).")
        d[_c] = ""
_tot = len(d); _bad = d[d["success"] != True]
if len(_bad): print(f"CẢNH BÁO: {len(_bad)}/{_tot} dòng success=False (lỗi hạ tầng) bị loại khỏi mẫu số. Theo tỉnh: {_bad.groupby('_dir').size().to_dict()}")
d = d[d["success"] == True].sort_values("_run").drop_duplicates(["test_id", "model", "llm_provider"], keep="last").copy()

# Chỉ xét lật False -> True khi lý do sai là thiếu thực thể và không có từ cấm. Không đụng câu ngoài phạm vi.
_reason_ok = True if _no_reason else d["evaluation_reason"].astype(str).str.contains("MISSING_ENTITY")   # file cũ không có cột lý do: xét mọi câu sai
cand = (d["pass"] == False) & _reason_ok \
       & (d["forbidden_items"].isna() | (d["forbidden_items"].astype(str).str.strip() == "")) \
       & (d["category"] != "T8_out_of_scope") & (d["answer_type"] != "no_answer")
d["relaxed_pass"] = d["pass"]
if cand.any():
    d.loc[cand, "relaxed_pass"] = d[cand].apply(lambda r: relaxed_ok(r["must_contain"], r["answer"]), axis=1)
d["doi"] = (d["pass"] == False) & (d["relaxed_pass"] == True)

agg = d.groupby(["llm_provider", "model", "category"]).agg(n=("pass", "size"), dat_cu=("pass", "sum"), dat_moi=("relaxed_pass", "sum"), so_dong_doi=("doi", "sum")).reset_index()
tot = d.groupby(["llm_provider", "model"]).agg(n=("pass", "size"), dat_cu=("pass", "sum"), dat_moi=("relaxed_pass", "sum"), so_dong_doi=("doi", "sum")).reset_index()
_flips = d[d.doi]
mau = (_flips if len(_flips) <= 60 else _flips.sample(n=60, random_state=7))[["_dir", "test_id", "model", "llm_provider", "category", "question", "must_contain", "answer"]].copy() if len(_flips) else _flips.copy()
mau["nhan_tay"] = ""   # điền Đ nếu câu trả lời thật sự đủ ý, S nếu sai nghĩa
with pd.ExcelWriter(OUT) as w:
    mau.to_excel(w, sheet_name="mau_kiem_tay", index=False)
    tot.to_excel(w, sheet_name="tong_hop", index=False)
    agg.to_excel(w, sheet_name="theo_nhom", index=False)
    d[d.doi][["_dir", "test_id", "model", "llm_provider", "category", "question", "must_contain", "answer"]].to_excel(w, sheet_name="cac_dong_doi", index=False)
    d[["_dir", "test_id", "model", "llm_provider", "category", "answer_type", "pass", "relaxed_pass"]].to_excel(w, sheet_name="chi_tiet", index=False)
print(f"{len(files)} file, {len(d)} dòng sau khi bỏ lượt chạy trùng\n")
print(tot.to_string(index=False))
print("\nCác câu đổi từ sai sang đúng theo nhóm:")
print(agg[agg.so_dong_doi > 0].to_string(index=False))
print(f"\nĐã ghi {OUT}.")
print(f"KIỂM TAY: mở sheet mau_kiem_tay ({len(mau)} dòng, trên tổng {len(_flips)} dòng đổi; nếu không quá 60 thì là TOÀN BỘ dòng đổi), điền cột nhan_tay = Đ hoặc S.")
print("Độ chính xác của quy tắc nới = số Đ / số dòng đã gán nhãn. Chỉ dùng chấm nới khi con số này gần 100%.")