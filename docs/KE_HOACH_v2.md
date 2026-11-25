# KẾ HOẠCH TRIỂN KHAI ĐỒ ÁN (v2, cập nhật 17/11/2026)

Nhóm Done Team (Thư: backend, AI/RAG, dữ liệu, frontend; Vi: dữ liệu các tỉnh) | GVHD: Thầy Trần Thanh Phước
**Hạn nộp: 30/11/2026** (còn 13 ngày kể từ 17/11)

Bản này thay `KE_HOACH.md`. Ba tiêu chí chấm của giảng viên giữ nguyên: (1) dùng dữ liệu và mô hình sẵn có, (2) thực nghiệm được trên dữ liệu, (3) phân tích và so sánh ưu nhược điểm.

## 1. Thứ tự 4 mô hình (không đổi)

| Model | Kỹ thuật thêm so với model trước |
|---|---|
| 1 Rule-based | Tra `unit_mapping` trực tiếp, không LLM |
| 2 Naive RAG | Vector search + LLM |
| 3 Advanced RAG | Query rewriting + rerank (`bge-reranker-v2-m3`) |
| 4 Modular RAG | Router + hybrid retrieval + RRF |

## 2. Trạng thái (theo ghi chú đến 3/11, cần Thư xác nhận lại)

| Hạng mục | Trạng thái |
|---|---|
| Batch Gemini × 4 model | Xong. TP.HCM: M1 96,9%, M2 90,7%, M3 90,7%, M4 96,9% (161 câu) |
| Batch Cohere × 4 model | Xong (M1 96,9%, M2 91,2%, M3 88,2%, M4 96,9%) |
| Batch Groq | Chưa đầy đủ ở thời điểm ghi chú, cần kiểm tra |
| Batch 7 tỉnh còn lại (Gemini) | Đã chạy xong ngày 10/10, cần gộp số liệu |
| `RERANK_THRESHOLD` | Chốt 0,9; `RERANK_THRESHOLD_NEW2OLD` = 0,45 |
| Bộ test TP.HCM | Đã đóng băng, chỉ pilot được đổi |
| Frontend demo | Đang dùng được (đã kiểm tra ngày 17/11) |
| Việc còn mở | Kiểm tra `runBatchTest.js` ghi cột token ra Excel; xóa tham chiếu `"openrouter"` còn sót; thêm mục `MIGRATION v1.4` vào `schema.sql` |

## 3. Lịch còn lại (17/11 đến 30/11, 13 ngày)

Không đủ thời gian cho phần mở rộng. Viết chương 1, 2 song song ngay từ tuần đầu, vì chương 3 đến 6 cần phần lớn thời gian của tuần sau.

| Ngày | Việc | Tiêu chí | Sản phẩm |
|---|---|---|---|
| 17/11 – 19/11 | Chốt số liệu Gemini và Cohere (TP.HCM). Xử lý 3 việc còn mở ở mục 2. Kiểm tra Groq: chưa đủ thì bỏ, ghi vào hạn chế. Song song: viết nháp chương 1, 2 | 2 | Bảng accuracy model × nhóm T1 đến T8 |
| 20/11 – 22/11 | Phân tích: so sánh cặp M1→M2→M3→M4, lỗi T4, T7, T8; đối chiếu tay 3 đến 5 câu có số khoản trích dẫn; tra nguồn chip "synthetic" | 3 | Bảng cặp + danh sách lỗi có ví dụ |
| 23/11 – 27/11 | Viết chương 3, 4, 5, 6. Chương 4 gồm thảo luận và mục hạn chế ở mục 4 bên dưới | 1, 2, 3 | Bản nháp đầy đủ |
| 28/11 – 30/11 | Rà số liệu, sửa chính tả, slide, quay demo, nộp | | Nộp bài 30/11 |

Cắt khỏi phạm vi nộp bài (ghi vào hướng phát triển, mục 6.2):

| Việc | Lý do cắt |
|---|---|
| Gộp và phân tích kết quả 7 tỉnh | Cần thêm ít nhất 2 đến 3 ngày, không phải kết quả chính |
| NORMALIZE_VN (M1+, M4+) | Dòng bổ sung ngoài chuỗi ablation; chỉ nhắc ngắn nếu đã có số |
| Thí nghiệm Groq (nếu chưa đủ) | Chạy lại mất thời gian, so sánh provider chỉ là thí nghiệm phụ |
| Gợi ý `suggestion` cho câu cấp huyện | Đổi code sát hạn là rủi ro, không đáng |

## 4. Hạn chế đã biết: câu hỏi cấp huyện hoặc thành phố

Dữ liệu chỉ có cấp xã/phường cũ. Câu như "Thành phố Mỹ Tho hiện tại thuộc đơn vị nào" khớp cùng lúc 14 đơn vị nên điểm rerank thấp (0,61 và 0,32, dưới ngưỡng 0,9), hệ thống trả `no_answer`. Câu cụ thể ("Phường 1, Thành phố Mỹ Tho cũ nay là phường nào?") trả đúng.

Quyết định: giữ làm hạn chế trong báo cáo, không sửa mô hình, vì bộ test đã đóng băng và sửa sẽ làm kết quả đã chạy không còn so sánh được. Không làm thêm gợi ý ở field `suggestion` trước hạn nộp; để vào hướng phát triển.

## 5. Nguyên tắc thực nghiệm (không đổi)

- `no_answer` cho câu ngoài phạm vi là đúng; `success: false` là lỗi hạ tầng, loại khỏi mẫu số.
- Cố định một LLM provider (Gemini) cho ablation chính; so sánh provider là thí nghiệm phụ.
- Web search nằm trong hướng phát triển (mục 6.2), không dùng trong ablation vì dữ liệu internet không lặp lại được.
- Đơn vị `mot_phan` và tên trùng (ví dụ "Phường 7") xử lý riêng, phân biệt bằng `parent_name`.
- Phạm vi báo cáo: TP.HCM là kết quả chính; 7 tỉnh còn lại trình bày như mở rộng, nói rõ nguồn của từng tỉnh.
