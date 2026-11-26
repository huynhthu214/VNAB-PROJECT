# Tổng kết tiến độ nghiên cứu và bàn giao VNAB

**Mốc chốt 26/11/2026, giờ Việt Nam.** Task 01–10 đã hoàn tất. Phiên bản dữ liệu đóng băng là pilot v1.1 và dataset thực nghiệm v1.0. Các gói phục vụ phát triển và thử pipeline. Task 11–12, tập test mới và kết quả huấn luyện chưa hoàn thành.

## Hiện trạng trước khi chuyển hướng

Đồ án ban đầu xây dựng hệ thống hỏi đáp địa giới hành chính sau sắp xếp cho tám tỉnh/thành miền Nam. Hệ thống có frontend React/Vite, backend Node/Express, dịch vụ Python/FastAPI, PostgreSQL/pgvector và bốn cách trả lời gồm tra cứu theo luật, Naive RAG, Advanced RAG và Modular RAG. Báo cáo v4 ghi thực nghiệm dùng Gemini và Cohere với 588 câu kiểm thử và 4.704 dòng kết quả. Kho truy hồi 3.263 chunk là số của lượt chạy lịch sử. 36 câu pilot hiệu chỉnh được lấy từ benchmark cũ và chưa có tập test mới độc lập. Các số này mô tả hệ thống và thực nghiệm cũ, không phải kết quả của dataset v1.0. Định hướng mới ưu tiên đóng góp dataset và thiết kế thực nghiệm có thể tái lập. `Báo cáo v4` · `Kế hoạch nghiên cứu` · `Đối chiếu legacy`

## Nguồn và chuẩn hóa

Snapshot v1.0 gồm tám workbook và chín tệp TXT nghị quyết. Đọc workbook theo sheet và header thực tế, lưu số dòng Excel, ghi SHA-256 nguồn và dữ liệu xuất. Ghép mỗi dòng `XaPhuong` với `Sheet1` theo tên cũ, huyện cũ, tên mới và tỉnh mới sau chuẩn hóa có kiểm soát; chỉ chấp nhận ghép 1:1. Kiểm cặp tỉnh với `Tinh`. ID mapping theo nguồn, sheet và dòng; ID cũ gồm định danh theo tỉnh, huyện và tên, ID mới dùng tỉnh và mã đơn vị. Nhãn Excel lưu riêng ở `merge_type_raw`. Nhãn nghiên cứu tách toàn bộ, một phần, không sắp xếp, chuyển đổi và chưa xác định. Kiểm kê và xuất snapshot sử dụng nguồn file. Đối chiếu PostgreSQL hiện hành chưa chạy. `Manifest nguồn` · [Kiểm kê](inventory.csv) · [Cấu trúc nguồn](source_structure.json) · `Audit nguồn`

| Tỉnh/thành | Dòng cấp xã | Mã mới trong Sheet1 | Dòng cấp tỉnh |
|---|---:|---:|---:|
| TP.HCM | 493 | 168 | 3 |
| Đồng Nai | 271 | 95 | 2 |
| Tây Ninh | 302 | 96 | 2 |
| Cần Thơ | 266 | 103 | 3 |
| Vĩnh Long | 359 | 124 | 3 |
| Đồng Tháp | 308 | 102 | 2 |
| An Giang | 302 | 102 | 2 |
| Cà Mau | 186 | 64 | 2 |
| **Tổng** | **2.487** | **854** | **19** |

Có 2.486 dòng nối được, 2.375 ID cũ và 853 ID mới trên phần đã nối. Một mã trong Sheet1 chưa gắn được với mapping Côn Đảo. Phân bố nhãn snapshot gồm 2.247 toàn bộ, 213 một phần, 26 không sắp xếp, một chuyển đổi và không có dòng `unknown`. Đây là nhãn của snapshot tại thời điểm kiểm kê, trước khi phát hiện năm dòng gán sai nhãn ở khoản 164.

## Gom nhóm, sinh QA và MRC

Sau khi cách ly ba dòng có vấn đề ban đầu, đồ thị hai phía dùng namespace old/new tạo 762 thành phần liên thông trên 2.484 quan hệ. Kích thước theo số quan hệ có min/trung vị/max là 1/3/45. Có 49 nhóm chứa quan hệ một phần. ID nhóm là hash danh sách nút đã sắp thứ tự. Đồ thị phản ánh snapshot ở thời điểm dựng, còn danh sách cách ly bổ sung được áp dụng khi chốt release. Sàng lọc lịch sử dùng hai bộ matrix 588 câu, pilot cũ và câu hỏi batch thu được. Có 684 nhóm có tín hiệu tên khi tính cả batch unmatched và 110 lượt chưa nhận diện được nhóm. Tín hiệu tên có thể gộp các tên đồng âm hoặc trùng địa danh. [Thống kê nhóm](group_summary.json) · `Đối chiếu batch theo artifact` · [Thống kê tín hiệu lịch sử](legacy_signal_summary.json)

Sinh QA từ mapping theo loại T1–T7; hai dạng T8 được chọn và kiểm riêng trong pilot. Với quan hệ xuôi, đảo chiều, nhiều đích, nhiều nguồn và đếm, dùng ID để giữ đúng quan hệ và đếm thực thể. Câu hỏi mới bỏ mã hành chính khỏi văn phong nhưng giữ dữ liệu trong provenance. Full QA có thể dùng context `mapping` hoặc `legal_original`. Khi dùng TXT, bộ dò tìm đoạn trong đúng nghị quyết, kiểm tên nguồn và đích trong câu mô tả quan hệ, dò trên NFC trong bộ nhớ và quy chiếu về nguyên văn. Chỉ xuất MRC nếu đáp án là span liên tục; offset là chỉ số Unicode Python từ 0. MRC v1.1 giữ bản ghi phẳng SQuAD và kế thừa tám trường metadata từ Full QA. [Schema QA](../schema/qa.schema.json) · [Schema MRC v1.1](../schema/mrc.v1.1.schema.json) · `Thiết kế bàn giao MRC`

## Kiểm chứng và chia tập

Ứng viên ban đầu là `pending`. Vi xem xét và xác nhận quyết định từ CSV có hỗ trợ AI. Công cụ nhập chạy check-only trước, đối chiếu ID đầy đủ, hash và nội dung hiển thị, rồi lưu quyết định, thời điểm, người duyệt và ghi chú. Batch có 228 approve, 2 revise và 10 reject. 82 QA mapping đã duyệt giữ căn cứ ghi trong `reviewer_note` và vẫn dùng context mapping. Mẫu đã đổi nội dung cần hash mới và duyệt lại. Quy trình này đo được phần kiểm kỹ thuật và phục vụ kiểm chứng có giám sát, chưa có số liệu đồng thuận từ hai người chấm độc lập. `Nhật ký review và phát hành`

Khóa 40 nhóm test chính và 12 nhóm challenge trước khi sinh batch. Khi chia theo seed 20261127, giữ chung thành phần liên thông, thực thể, mapping, câu đảo chiều, context trùng và khoảng bằng chứng chồng lấn. Pilot giữ nguyên 16 train/4 dev; khối liên kết của 20 mẫu pilot chiếm 54 QA train và 12 QA dev trước khi phân bổ phần còn lại. Hợp nhất chỉ lấy mẫu đã duyệt, loại mẫu trùng và giữ ba P0 dùng chung đúng một lần. Đã xác nhận train/dev không giao theo group, ID thực thể, mapping và reservation. Vi giữ riêng reservation. Test chính và challenge cần báo cáo riêng, vì một phần challenge có tín hiệu lịch sử. `Manifest pilot` · `Manifest v1.0` · `Validation report`

## Kết quả dữ liệu và vấn đề đã phát hiện

| Tập | Full QA | MRC | Group ID chính của QA | Context QA pháp lý / mapping |
|---|---:|---:|---:|---:|
| Train | 199 | 126 | 137 | 127 / 72 |
| Dev | 50 | 37 | 39 | 39 / 11 |
| **Tổng** | **249** | **163** | **176** | **166 / 83** |

MRC có 163 câu T1 pháp lý. Pilot có 20 QA/MRC, split 16/4. Gói thực nghiệm gồm hai loại dữ liệu, hai schema, thống kê, manifest, báo cáo validation, README, data card, changelog và checksum. `Thống kê theo tỉnh, type, origin và group` · `Data card` · [Pilot ZIP](../handoff/pilot-v1.1/vnab-pilot-v1.1.zip) · [Dataset ZIP](../handoff/v1.0/vnab-dataset-v1.0.zip)

- Côn Đảo thiếu định danh để nối giữa hai sheet. Cặp Tiền Giang → Tây Ninh ở dòng 36 vắng trong `Tinh`. Thổ Châu có nhãn chuyển đổi cần xác minh riêng. Đã cách ly cả ba trường hợp.
- So nhãn hai sheet cho 98 dòng tách chi tiết và 26 dòng giữ nguyên cho thấy cần giữ nguyên ngữ nghĩa nguồn. Đơn vị trùng tên được xử lý bằng ID và địa phương.
- Điều 1 khoản 164 của Nghị quyết 1685 xác định Thới Hòa, Long Sơn, Hòa Hiệp, Bình Châu và Thạnh An không thực hiện sắp xếp. Snapshot ghi `toan_bo` cho cả năm dòng self-mapping. Hai QA rank 235 và 239 được cách ly vì dựa vào các nhãn đó. Bản dẫn xuất sau này có thể đổi nhãn sau kiểm chứng, giữ nguyên snapshot hiện tại.
- Mười câu batch khớp mapping, đáp án và bằng chứng với pilot đã duyệt được loại vì dư thừa. Unicode tổ hợp trong TXT Cà Mau từng làm bộ dò bỏ sót Điều 1; phiên bản hiện tại dò trên NFC và vẫn giữ slice gốc. `Vấn đề nguồn` · `Vấn đề phát hành` · `Lịch sử cập nhật pilot`

## Hạn chế khoa học

- Tám tỉnh/thành là phạm vi nghiên cứu. Các mẫu sinh theo template từ mapping và nghị quyết chưa đại diện cho phân bố câu hỏi tự nhiên của người dùng. MRC toàn T1, chưa đánh giá đầy đủ câu nhiều bằng chứng, một phần, đếm hoặc làm rõ. Hai mẫu T8 chỉ có ở dev.
- Full QA dùng hai loại context, nên khi báo cáo cần phân biệt bằng chứng cấu trúc và trích nguyên văn. Kiểm tra span, schema và checksum là kiểm kỹ thuật. Tính đúng ngữ nghĩa, đại diện và độ tin cậy nhãn cần báo theo quy trình kiểm chứng có hỗ trợ AI và mức độ xác nhận của Vi.
- Tồn tại hai phiên bản benchmark cũ, provenance batch chưa được xác định hoàn toàn, và nhiều câu chưa gắn chắc vào nhóm. So sánh với số lịch sử phải nêu khác biệt về nguồn câu, cài đặt và cách chấm. Kết quả train/dev hay benchmark cũ chưa chứng minh cải thiện mô hình.
- Việc tách nhóm giảm leakage đã phát hiện; độc lập còn phụ thuộc câu test, bằng chứng, biến thể tên và quy trình chấm. Trong challenge có 10/12 nhóm có tín hiệu lịch sử. Test giữ riêng mới ở mức khóa nhóm. Chưa tạo kết quả đánh giá test, chưa có metric model mới và chưa chạy tokenizer, batch hay huấn luyện trong phiên này.

## Công việc còn lại Task 11–12

1. **Task 11.** Hoàn thiện câu hỏi test chính và challenge từ reservation đã khóa, xác minh đáp án, kiểm lại leakage và lưu riêng. Chốt cấu hình, checkpoint, prompt, ngưỡng và seed trên dev trước khi mở test. Tổ chức chấm độc lập nếu có hai người chấm, lưu bất đồng và quy tắc xử lý. Với MRC có context, báo EM/F1; với QA end-to-end, báo thực thể, quan hệ, hành động, nguồn và độ trễ. Báo test chính và challenge thành hai kết quả, lưu dự đoán, phiên bản và lỗi thực tế.
2. **Task 12.** Viết chương dữ liệu dựa trên các artifact dưới đây. Bổ sung chương phương pháp và thực nghiệm sau khi có kết quả thật. Chọn cấu hình demo trên dev, hoàn thiện tài liệu tái lập, slide và chuẩn bị bảo vệ. Chỉ trình bày training hoặc cải thiện nếu có log và thiết kế đánh giá phù hợp.

## Bằng chứng dùng để viết báo cáo mới

| Nội dung | Artifact chính xác | Cách sử dụng |
|---|---|---|
| Hiện trạng hệ thống và số lịch sử | `bao_cao_v4.docx`, `Ke_hoach.docx`, `task_04_06_audit.md` | Bối cảnh kiến trúc, bốn baseline và lý do thay đổi thiết kế thực nghiệm. |
| Bảng dữ liệu nguồn theo tỉnh và nhãn | [inventory.csv](inventory.csv), [source_structure.json](source_structure.json), `source_manifest.json`, `source_audit.md` | Số workbook, dòng, mã đơn vị, tên sheet, nguồn pháp lý, checksum và quy tắc xử lý dòng thiếu. |
| Quy trình chuẩn hóa, nhóm và sinh mẫu | [inventory_sources.py](../scripts/inventory_sources.py), [group_relations.py](../scripts/group_relations.py), [group_summary.json](group_summary.json), [build_pilot.py](../scripts/build_pilot.py), [prepare_dataset.py](../scripts/prepare_dataset.py) | Vẽ sơ đồ từ Excel/TXT đến snapshot, đồ thị, ứng viên và span Unicode. |
| Mâu thuẫn lịch sử và nguy cơ leakage | `legacy_differences.csv`, `legacy_batch_matches.csv`, [legacy_signal_summary.json](legacy_signal_summary.json) | Hai phiên bản matrix, độ phủ đối chiếu và số trường hợp chưa nhận diện. Các tệp cấp câu giữ nội bộ. |
| Quy trình reviewer và bảo toàn hash | [import_pilot_review.py](../scripts/import_pilot_review.py), `experimental_release_v1.md`, `data_card.md` | Quyết định approve/revise/reject, điều kiện kiểm và giới hạn của review có AI hỗ trợ. |
| Vấn đề dữ liệu và biện pháp cách ly | `data_issues.csv`, `data_issues_release_v1.csv` | Bảng ca lỗi, vị trí dòng Excel, thay đổi dẫn xuất đề xuất và căn cứ khoản 164. |
| Bảng train/dev và phân bố QA/MRC | `dataset_statistics.json`, `split_manifest.csv`, `candidate_preview.json` | Dùng thống kê v1.0 cho kết quả cuối. Số liệu preview chỉ minh họa quá trình chọn ứng viên. |
| Nghiệm thu và tái lập | `validation_report.json`, `validation report pilot`, [handoff_archives.sha256](handoff_archives.sha256), `README`, `CHANGELOG`, [release_experimental.py](../scripts/release_experimental.py) | Bằng chứng kiểm schema, span, split, checksum và gói đã phát hành. Không dùng để suy ra metric mô hình. |

## Phạm vi chia sẻ

Bản này chỉ ghi số liệu tổng hợp, quy trình, giới hạn và tên artifact dùng làm bằng chứng. Các tệp QA/MRC đã duyệt, manifest train/dev, thống kê, validation, data card và README của từng gói được phân phối trong hai ZIP. Workbook/TXT xuất cấp dòng, quyết định review riêng, benchmark theo câu và hồ sơ reservation do nhóm lưu nội bộ. Báo cáo tiến độ này dùng cùng [README nghiên cứu](../README.md) và [checksum hai ZIP](handoff_archives.sha256).
