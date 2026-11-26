# VNAB — dữ liệu nghiên cứu cho Thư

Hai bản đã đóng băng thuộc Task 01–10. [Pilot v1.1](handoff/pilot-v1.1/vnab-pilot-v1.1.zip) có 20 QA/MRC, split 16/4. [Dataset thực nghiệm v1.0](handoff/v1.0/vnab-dataset-v1.0.zip) có 249 Full QA và 163 MRC. Cả hai gói dùng metadata MRC v1.1. [SHA-256](reports/handoff_archives.sha256) · [Tổng kết Task 01–10](reports/research_progress_summary.md)

## Tạo nhánh nghiên cứu

Sau khi nhánh `research/dataset` đã được đưa lên remote, chạy từ clone của repository chung. Làm trên worktree sạch trước khi chuyển nhánh.

```powershell
git fetch origin
git switch -c research/mrc-experiments --no-track origin/research/dataset
```

Nếu nhánh cục bộ `research/mrc-experiments` đã tồn tại, mở bằng `git switch research/mrc-experiments`. Chỉ tạo upstream cho nhánh thí nghiệm khi nhóm quyết định chia sẻ nhánh đó.

## Kiểm checksum và giải nén

```powershell
Get-Content research/reports/handoff_archives.sha256 | ForEach-Object {
    $sha, $path = $_ -split '  ', 2
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash -ne $sha) {
        throw "Checksum mismatch: $path"
    }
}
Expand-Archive -LiteralPath research/handoff/pilot-v1.1/vnab-pilot-v1.1.zip -DestinationPath research/data/local/pilot-v1.1
Expand-Archive -LiteralPath research/handoff/v1.0/vnab-dataset-v1.0.zip -DestinationPath research/data/local/v1.0
```

Mỗi gói có `qa_train.jsonl`, `qa_dev.jsonl`, `mrc_train.jsonl`, `mrc_dev.jsonl`, hai schema, `split_manifest.csv`, `validation_report.json`, `README.md` và `checksums.sha256`. Dataset v1.0 còn có `data_card.md`, `dataset_statistics.json` và `CHANGELOG.md`.

## Smoke test và thực nghiệm

Tạo môi trường Python riêng có `datasets`, `transformers` và PyTorch theo môi trường do Thư quản lý. Chạy pilot trước để kiểm nạp JSONL, Unicode offset, tokenizer fast và một batch. Dùng split đã phát hành cho cả hai gói. Ví dụ này nạp pilot và kiểm cấu trúc span, chưa tải mô hình.

```python
from pathlib import Path
from datasets import load_dataset

folder = Path("research/data/local/pilot-v1.1")
mrc = load_dataset("json", data_files={
    "train": str(folder / "mrc_train.jsonl"),
    "validation": str(folder / "mrc_dev.jsonl"),
})
for split in mrc.values():
    for row in split:
        for answer, start in zip(row["answers"]["text"], row["answers"]["answer_start"]):
            assert row["context"][start:start + len(answer)] == answer
```

MRC dùng bản ghi phẳng SQuAD UTF-8. `answer_start` là chỉ số ký tự Unicode Python từ 0, tính trên `context` nguyên văn. MRC cũng có `group_id`, `province`, `type`, `source_doc`, `article_clause`, `context_origin`, `answerable` và `review_status`. Full QA giữ quan hệ, provenance và review. Dùng manifest để giữ các mẫu liên quan cùng tập khi mở rộng.

Thư có thể dùng `AutoTokenizer.from_pretrained(model_id, use_fast=True)` với `nguyenvulebinh/vi-mrc-base` hoặc `deepset/xlm-roberta-base-squad2` theo kế hoạch thực nghiệm của nhóm. Kiểm offset mapping với từng tokenizer trước khi fine-tune. Lưu checkpoint và kết quả trung gian ở vùng riêng. Ghi checkpoint, cấu hình, seed, số mẫu và log thực tế. Pilot và train/dev là dữ liệu phát triển. Vi giữ test chính và challenge riêng, chỉ chạy test sau khi khóa cấu hình trên dev và báo hai phần riêng.

Mã tạo và validation dữ liệu nằm trong [scripts](scripts/). Chạy `python -B research/scripts/test_prepare_dataset.py -v` để kiểm fixture. Tái tạo release từ đầu cần nguồn và review nội bộ đã cấp quyền. Đọc hai ZIP đã phát hành không cần các file riêng đó.
