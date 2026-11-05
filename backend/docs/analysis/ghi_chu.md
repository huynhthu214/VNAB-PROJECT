## Việc 1: kiểm tay chấm nới (mẫu 30 trên 33 dòng đổi)

- Bản chấm của Thư: 24 Đ, 6 S. Bản chấm thứ hai: 22 Đ, 8 S. Đồng thuận 26/30.
- Lỗi tập trung ở T2 và T7 (script khớp lõi tên đơn vị nằm trong ngoặc cha, vd "Thành phố Dĩ An" khớp "Phường Dĩ An").
- 4 dòng bất đồng: TN-T2-04-2, VL-T2-01-2, VL-T5-07, HCM-T3-04.
- Việc tiếp: sửa relaxed_rescore.py, chạy lại, kiểm tay toàn bộ dòng đổi còn lại.

## Việc 1 (chạy lại, script đã vá khớp tên cha)

- 25 dòng đổi (trước 33). 8 dòng bị loại: 4 HCM-T7-05, HCM-T2-07-2, TN-T2-04-2, VL-T2-01-2, VL-T5-07. Kiểm tay toàn bộ 25 dòng: 25 Đ / 25.
- Quy tắc nới sửa sau khi đã thấy 8 dòng sai, nên độ chính xác 100% là trên mẫu đã dùng để chỉnh quy tắc. Báo cáo cả hai cách chấm cạnh nhau.
- Số liệu: xem sheet tong_hop của relaxed_official_v2.xlsx.

## Việc 3: T8_ambiguous

- Lần chấm đầu lệch 2 dòng (HCM-T8-01 modular_rag cohere, AG-T8-08 rule_based cohere), đã chấm lại, xem dòng dưới
- Lý do đổi cách chấm: must_contain cũ chỉ là chữ "quận", câu trả lời đúng của các tỉnh dùng "huyện/thị xã" bị chấm sai, câu của HCM chỉ cần có chữ "quận" là qua.
- Quy tắc mới: đúng khi hỏi lại, nêu có nhiều nơi trùng tên, hoặc nêu từ 2 nơi khác nhau kèm đơn vị mới. Sai khi khẳng định 1 đơn vị duy nhất hoặc no_answer.
- Kết quả (cũ -> mới, trên n câu): gemini rule_based 57->57, modular 57->57, naive 27->17, advanced 19->11 (n=57); cohere rule_based 57->57, modular 49->49, naive 14->14, advanced 13->6 (n=49, thiếu 8 câu AG).
- Cohere thiếu AG ở 3 model RAG (không có dòng nào trong chi_tiet): so Cohere với Gemini phải tính trên cùng tập câu.
- Độ khớp script regrade_t8_ambiguous.py với bản chấm tay: 30/30 (lần chấm đầu 28/30; 2 dòng HCM-T8-01 modular_rag cohere và AG-T8-08 rule_based cohere được chấm lại từ S sang Đ sau khi đối chiếu quy tắc "nêu rõ có nhiều nơi trùng tên"; HCM-T8-01 trước đó chấm không nhất quán với dòng rule_based có câu trả lời giống hệt).
- Kết luận: dùng cách chấm mới làm cách chấm chính cho T8; giữ số cũ (dat_cu) cạnh số mới (dat_moi).
- Hai câu CT sai nêu trong tài liệu xử lý vấn đề: lọc _dir = CT, model rule_based và modular_rag, pass_moi = False không ra dòng nào (cả hai 16/16). Giả thuyết "nhận diện trùng tên chỉ xét quận/huyện cha" chưa có bằng chứng, chưa sửa code.
- Hạn chế: M1 và M4 đạt 100% vì tên trùng được xử lý bằng luật cứng (phát hiện nhiều dòng rồi hỏi lại), nên T8 không phân biệt được M1 với M4.

## Việc 5: chẩn đoán T7

- rule_based: mọi câu T7 sai đều là no_answer. Nguyên nhân: ILIKE trên admin_units_old.name / admin_units_new.name (có dấu) không khớp câu hỏi không dấu.
- modular_rag khớp được một phần nhờ nhánh hybrid/RAG (embedding bge-m3 chịu được mất dấu); câu sai còn lại gồm no_answer và HCM-T7-05 (trả thành phần của Phường Tân Đông Hiệp mới, thiếu Phường Dĩ An).
- Số T7 chính thức lấy từ sheet theo_nhom của relaxed_official_v2.xlsx (đã bỏ lượt chạy trùng), không lấy từ lệnh pandas thô.
- Cách sửa: cột name_norm + biến môi trường NORMALIZE_VN (mặc định tắt), xem mục 4.
- Sau migration name_norm: bảng cũ có 44 nhóm, bảng mới có 15 nhóm tên khác nhau chỉ ở dấu (ví dụ Tân Quý / Tân Quy). Bản vá phải xử lý nhóm này (hỏi lại thay vì chọn một tên), nếu không M1+ có thể trả nhầm đơn vị.
- Một số câu T7 trùng tên sau khi bỏ dấu sẽ được hỏi lại thay vì trả đáp án; đó là hành vi đúng nhưng có thể bị chấm sai so với must_contain. Cần đếm riêng số câu này khi báo cáo M1+/M4+.
- 590 đơn vị mới có đơn vị cũ trùng tên khi bỏ dấu (mẫu số: [điền]). Nếu isAggregationIntent chỉ hiểu tiếng có dấu thì câu tổng hợp không dấu đi nhánh khớp đơn vị cũ trước và trả lời sai chiều. Do đó isAggregationIntent và isLikelyOutOfScopeTopic cũng được chuẩn hóa dưới cùng cờ NORMALIZE_VN.
- tryOldProvinceMatch chưa được chuẩn hóa (T7 là cấp xã/phường); ghi vào mục hạn chế.
- T7 có 24 câu; 7 câu là chiều cũ sang mới ("truoc day nay duoc sap xep ra sao"), chỉ HCM-T7-05 là hướng tổng hợp ("gom nhung don vi nao").
- Sau khi chuẩn hóa isAggregationIntent, HCM-T7-05 vẫn sai ở M1+ giống bản có dấu. Nguyên nhân là cách hiểu ý định tổng hợp của hệ thống, không phải dấu. Không tính câu này vào hiệu quả của chuẩn hóa dấu.
- 590/854 đơn vị mới có tên trùng đơn vị cũ khi bỏ dấu. Rủi ro sai chiều với câu tổng hợp không dấu ngoài bộ test. Ghi vào mục hạn chế.
- tryOldProvinceMatch chưa chuẩn hóa (T7 là cấp xã/phường).

## Việc 5: kiểm tra Postman (cờ tắt / bật, rule_based)

- VL-T1-08: tắt "Không tìm thấy Xã Bình Minh" (khớp nhầm "thị xã Bình Minh"), bật "Xã Mỹ Hòa (cũ) thuộc Phường Cái Vồn". Lỗi khớp tên đã sửa.
- HCM-T7-05: tắt no_answer, bật trả thành phần của Phường Tân Đông Hiệp mới, thiếu Phường Dĩ An. Lỗi nằm ở hướng của câu hỏi ("gom nhung don vi"), không phải ở dấu. Không tính vào hiệu quả chuẩn hóa dấu.
- Tân Quý (không dấu, có "quan Tan Phu"): tắt no_answer, bật một đáp án đúng (2 phần: Tân Sơn Nhì, Phú Thọ Hòa), không nhầm sang Tân Quy (Quận 7).
- Bến Nghé (có dấu): tắt và bật giống hệt. Không hồi quy trên câu có dấu.

## Việc 5: hồi quy 588 câu rule_based, cờ bật (Gemini)

- 531 cặp (trừ T8_ambiguous kiểm riêng, 57/57 không đổi): 24 dòng sai thành đúng (T7 +23, T1 +1), 0 dòng đúng thành sai. T2-T6 và T8_out_of_scope không đổi.
- M1: 563/588 (95,7%). M1+: 587/588 (99,8%). Câu còn sai: HCM-T7-05 (hướng câu hỏi "gom nhung don vi", không phải lỗi dấu).
- modular_rag (bộ rút gọn): +1 T1 và +2 T7 quy được cho cờ (answer_type đổi sang structured_lookup); +3 T8_out_of_scope là nhiễu LLM (rag_generated hoặc no_answer, không có dòng nào sang structured_lookup). Chưa chạy hồi quy 588 câu cho modular_rag.
- Hạn chế: sửa sau khi thấy lỗi trên bộ test đóng băng, T7 sinh từ cùng bảng đơn vị; M1+ và M4+ là hàng phụ, không nằm trong thứ tự ablation.
- Chạy so sánh cờ tắt và bật (bộ rút gọn T1+T7+T8, 207 câu, Gemini, PROMPT_VERSION v2; 300 cặp): rule_based T7 0 -> 23/24, T1 82 -> 83, T8_out_of_scope 43/43 không đổi, T8_ambiguous 57/57 không đổi, 0 dòng đúng thành sai.
- Nhiễu LLM: modular_rag T7 chính thức 18/24, cờ tắt chạy lại 21/24 cùng code. Chênh +3 của T8_out_of_scope (rag_generated hoặc no_answer) quy cho nhiễu.

## Việc 7: bỏ qua (không có tập câu hỏi độc lập). Dùng đoạn hạn chế trong báo cáo.

## Việc 2: loại câu trùng pilot

- Pilot còn lưu: 30 câu (pilot_v1_36\pilot_test_set.xlsx), không phải 33 hay 36 như bản nháp mục 4.5.7.
- 7 câu trùng nguyên văn (T1: 2, T2: 4, T6: 1); 42 câu cùng đơn vị (T2: 27, T8_ambiguous: 7, T4: 3, T1: 3, T6: 2).
- Loại 7 câu trùng nguyên văn: advanced_rag -0,1 (Gemini), -0,3 (Cohere); rule_based 0,0. Loại 42 câu cùng đơn vị: advanced_rag +0,5 / +0,2, naive_rag +0,8 / +0,3, rule_based -0,3.
- Kết luận: không thấy dấu hiệu ngưỡng 0,9 và 0,45 bị chỉnh theo pilot.
- Lỗi cần nhớ: bảng accuracy trong phan_tich_pilot.xlsx cho 0,0 ở mọi model (bỏ qua, chưa tìm nguyên nhân); số trong bao_cao_loai_pilot.xlsx đúng.

## Việc 4: câu T1 sai (VL-T1-08)

- Câu hỏi: "Xã Mỹ Hòa, Thị xã Bình Minh nay thuộc đơn vị hành chính nào?", đáp án mong đợi Phường Cái Vồn (toàn bộ). Cả rule_based và modular_rag đều sai.
- Nguyên nhân: tryOldUnitMatch khớp ILIKE theo chuỗi con, nên "Xã Bình Minh" khớp nhầm bên trong "Thị xã Bình Minh" và thắng "Xã Mỹ Hòa" vì tên dài hơn. Lỗi hệ thống, đáp án trong bộ test đúng.
- Đã sửa trong bản vá NORMALIZE_VN (hàm onlyInsideThiXa). Với cờ bật: T1 83/83 ở cả rule_based và modular_rag. Bộ test đóng băng không sửa.

## Việc 6: 103 câu sai thật ở T4 và T5 (naive_rag, advanced_rag)

- Thành phần: 95 no_answer (92%), 8 rag_generated (8%). advanced_rag no_answer: 65 câu (Gemini 27, Cohere 38).
- Gemini: nối với qa_logs theo (câu hỏi, provider), cửa sổ 24 giờ trước thời điểm lưu file kết quả chính thức (12/10), log lệch +7 giờ. Tách "bị chặn ở cổng ngưỡng" với "LLM từ chối" bằng input_tokens: đường bị chặn chỉ có token của bước viết lại (213 đến 227, mẫu 127 dòng), đường gọi LLM có 1004 đến 1408 (mẫu 1181 dòng rag_generated), hai khoảng không chồng nhau.
- Kết quả (27 câu): bị chặn ở cổng 21 (T4: 13, T5: 8, trong đó 3 câu dưới 0,45); LLM từ chối 6 (đều T5, điểm 0,73 đến 0,87, top chunk là SYNTHETIC-NEW2OLD vì đã qua cổng với điểm dưới 0,9). Mã 6 câu: [điền].
- 10/13 câu T4 bị chặn có điểm 0,85 đến 0,895, sát ngưỡng 0,9.
- Cơ chế (qa.controller.js): ngưỡng 0,45 nếu top chunk là SYNTHETIC-NEW2OLD, còn lại 0,9. Xác nhận bằng log tạm [rerank-debug] (hỏi lại, điểm lệch nhẹ do câu hỏi viết lại): DN-T5-06 top NEW2OLD 0,117 < 0,45 (câu bị viết lại "Phường Biên Hòa" thành "thành phố Biên Hòa"); CT-T5-03 0,4426 < 0,45; CM-T5-01 top OLD2NEW (sai hướng) 0,6615 < 0,9; CM-T4-04 0,8947 (chính thức, bị chặn) thành 0,9334 (hỏi lại, trả lời được).
- Nhóm nguyên nhân: (1) retrieval hoặc viết lại sai; (2) điểm sát ngưỡng; (3) top chunk sai hướng nên áp ngưỡng 0,9; (4) LLM từ chối sau khi qua cổng (6 câu T5).
- Cohere (38 câu): chưa phân loại vì log Cohere không nằm trong DB này. naive_rag và 8 dòng rag_generated chưa phân loại.
- Hạn chế: điểm rerank của cùng một câu dao động giữa các lượt (ví dụ CM-T4-04: 0,8947 và 0,9334).
- Ngưỡng 0,9 và 0,45 giữ nguyên. Đã báo nhóm 1 (điểm sát ngưỡng ở T4, top chunk sai hướng, viết lại đổi loại đơn vị).
