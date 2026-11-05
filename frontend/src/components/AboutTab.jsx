import {
  PROVINCES,
  NATIONAL_BASIS,
  oldProvinceList,
  formatDate,
} from "../data.js";
import { Icon, LineageFlow } from "./shared.jsx";

const EX_FULL = {
  newName: "Phường X",
  newType: "Phường",
  oldUnits: [{ name: "Phường A", parent: "Quận 1 cũ", merge: "toan_bo" }],
};
const EX_PART = {
  newName: "Phường X",
  newType: "Phường",
  oldUnits: [
    { name: "Phường A", parent: "Quận 1 cũ", merge: "toan_bo" },
    { name: "Phường B", parent: "Quận 1 cũ", merge: "mot_phan" },
  ],
};

const STEPS = [
  {
    icon: "map",
    title: "Chọn tỉnh, thành phố",
    text: "Bấm vào bản đồ ở trang Tổng quan, hoặc chọn trong danh sách ở mỗi trang.",
  },
  {
    icon: "search",
    title: "Nhập tên đơn vị",
    text: "Gõ tên phường, xã cũ hoặc mới. Hệ thống tìm không phân biệt dấu.",
  },
  {
    icon: "file",
    title: "Đối chiếu căn cứ",
    text: "Mỗi kết quả kèm nghị quyết. Hãy mở văn bản gốc khi dùng cho thủ tục pháp lý.",
  },
];

const FAQ = [
  {
    q: "Tôi chỉ biết tên phường, xã cũ. Làm sao biết nay thuộc đơn vị nào?",
    a: "Vào tab Tra cứu, nhập tên đơn vị cũ (có thể kèm quận, huyện cũ để phân biệt các đơn vị trùng tên như “Phường 1”). Kết quả hiển thị đơn vị mới và các đơn vị cùng được hợp nhất.",
  },
  {
    q: "Vì sao có tên phường, xã xuất hiện ở nhiều kết quả?",
    a: "Một số đơn vị cũ được chia ra nhiều đơn vị mới (nhãn “Một phần”). Khi đó mỗi đơn vị mới chỉ nhận một phần địa giới của đơn vị cũ.",
  },
  {
    q: "Phường, xã “không sắp xếp” được hiển thị thế nào?",
    a: "Đơn vị giữ nguyên địa giới được xem là chuyển “Toàn bộ” sang đơn vị mới cùng tên.",
  },
  {
    q: "Tôi nên tra cứu hay hỏi đáp?",
    a: "Tra cứu cho kết quả tức thì khi bạn đã biết tên đơn vị. Hỏi đáp phù hợp với câu hỏi mở, ví dụ hỏi ngược từ đơn vị mới hoặc nhờ giải thích căn cứ.",
  },
];

export default function AboutTab({ docs, stats, actions }) {
  return (
    <div className="page ab">
      <div className="wrap narrow">
        <header className="page-head">
          <h1>Giới thiệu & văn bản pháp lý</h1>
          <p>
            Công cụ giúp tra cứu sự thay đổi của các đơn vị hành chính cấp xã
            sau đợt sắp xếp năm 2025 tại 8 tỉnh, thành phố miền Nam.
          </p>
        </header>

        <section className="ab-sec">
          <h2>Cách sử dụng</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="steps-n">{i + 1}</span>
                <span className="steps-icon">
                  <Icon name={s.icon} size={20} />
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="ab-sec">
          <h2>Cách đọc kết quả</h2>
          <div className="two">
            <div className="ex-card">
              <div className="ex-card-head">
                <span className="mbadge full">Toàn bộ</span>
                <h3>Chuyển nguyên đơn vị</h3>
              </div>
              <LineageFlow unit={EX_FULL} />
              <p>
                Toàn bộ địa giới và dân cư của đơn vị cũ nằm trong đơn vị mới.
                Gồm cả trường hợp nhiều đơn vị cũ nhập lại và trường hợp không
                sắp xếp.
              </p>
            </div>
            <div className="ex-card">
              <div className="ex-card-head">
                <span className="mbadge part">Một phần</span>
                <h3>Chỉ một phần địa giới</h3>
              </div>
              <LineageFlow unit={EX_PART} />
              <p>
                Đơn vị cũ được chia, một phần nhập vào đơn vị này và phần còn
                lại thuộc đơn vị khác. Cần xem thêm kết quả của đơn vị cũ đó.
              </p>
            </div>
          </div>
        </section>

        <section className="ab-sec">
          <h2>Phạm vi dữ liệu</h2>
          <div className="scope">
            {PROVINCES.map((p) => (
              <button
                key={p.code}
                className="scope-card"
                style={{ "--c": p.color }}
                onClick={() => actions.explore(p.code)}
              >
                <span className="scope-bar" />
                <strong>{p.name}</strong>
                <span className="scope-from">
                  {oldProvinceList(p).join(" · ")}
                </span>
                <span className="scope-n">
                  {(stats.perProvince[p.code]?.newUnits ?? 0).toLocaleString("vi-VN")}{" "}
                  đơn vị cấp xã mới
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="ab-sec">
          <h2>Văn bản căn cứ</h2>
          <ul className="docs">
            <li className="doc national">
              <span className="doc-icon">
                <Icon name="file" size={20} />
              </span>
              <div className="doc-body">
                <strong>Nghị quyết {NATIONAL_BASIS.code}</strong>
                <span>{NATIONAL_BASIS.title}</span>
                <span className="doc-meta">
                  Cả nước · có hiệu lực từ 01/07/2025
                </span>
              </div>
            </li>
            {docs
              .filter((d) => d.code !== NATIONAL_BASIS.code)
              .map((d) => (
                <li className="doc" key={d.code}>
                  <span className="doc-icon">
                    <Icon name="file" size={20} />
                  </span>
                  <div className="doc-body">
                    <strong>Nghị quyết {d.code}</strong>
                    <span>{d.title}</span>
                    <span className="doc-meta">
                      {[d.scope, d.date ? `ban hành ${formatDate(d.date)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {d.url ? (
                    <a
                      className="doc-link"
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Xem văn bản <Icon name="external" size={14} />
                    </a>
                  ) : (
                    <span className="doc-link off">Chưa có liên kết</span>
                  )}
                </li>
              ))}
          </ul>
        </section>

        <section className="ab-sec">
          <div className="callout">
            <Icon name="alert" size={22} />
            <div>
              <h3>Lưu ý khi sử dụng</h3>
              <p>
                Thông tin trên trang mang tính tra cứu, tham khảo. Khi dùng cho
                thủ tục hành chính hay pháp lý, hãy đối chiếu với văn bản gốc
                của cơ quan có thẩm quyền, vì địa giới có thể được điều chỉnh
                tiếp sau thời điểm cập nhật dữ liệu.
              </p>
            </div>
          </div>
        </section>

        <section className="ab-sec">
          <h2>Câu hỏi thường gặp</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <Icon name="chevron" size={18} />
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
