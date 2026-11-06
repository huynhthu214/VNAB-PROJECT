const UNIT_RE =
  /(Phường|Xã|Thị trấn|Đặc khu|Quận|Huyện|Thị xã|Thành phố|Tỉnh)\s+([^\s,?]+(?:\s[^\s,?]+){0,3}?)(?=\s+(?:cũ|nay|hiện|được|gồm|thuộc|trước|là|sau)(?:\s|$)|,|\?|$)/giu;
const LEVEL_WORDS = [
  "tỉnh nào",
  "quận nào",
  "huyện nào",
  "thành phố nào",
  "cấp huyện",
  "cấp quận",
  "cấp tỉnh",
  "cấp thành phố",
  "cấp xã",
  "cấp phường",
  "tỉnh/thành",
  "(hoặc",
];

function safeRewrite(original, rewritten) {
  const o = original.toLowerCase();
  const r = (rewritten || "").toLowerCase();
  if (!r.trim()) return { text: original, fallback: "empty" };
  for (const m of original.matchAll(UNIT_RE)) {
    const name = `${m[1]} ${m[2]}`.trim().toLowerCase();
    if (!r.includes(name))
      return { text: original, fallback: "lost_entity:" + name };
  }
  for (const w of LEVEL_WORDS) {
    if (r.includes(w) && !o.includes(w))
      return { text: original, fallback: "level_changed:" + w };
  }
  return { text: rewritten, fallback: null };
}
module.exports = { safeRewrite };
if (require.main === module) {
  const t = [
    [
      "Xã Mỹ Hòa, Huyện Ba Tri nay thuộc đơn vị hành chính nào?",
      "Xã Mỹ Hòa, huyện Ba Tri hiện nay thuộc tỉnh nào?",
    ],
    [
      "Phường Bến Thành, Quận 1 nay thuộc đơn vị hành chính nào?",
      "Phường Bến Thành hiện thuộc quận nào?",
    ],
    [
      "Phường Bến Nghé, Quận 1 nay thuộc đơn vị hành chính nào?",
      "Phường Bến Nghé, Quận 1, hiện nay thuộc đơn vị hành chính nào?",
    ],
    [
      "Phường Cô Giang, Quận 1 nay thuộc đơn vị hành chính nào?",
      "Phường Cô Giang, Quận 1 hiện nay thuộc đơn vị hành chính cấp nào?",
    ],
    ["ben nghe cu gio la p nao", "Phường Bến Nghé cũ bây giờ là phường nào?"],
    [
      "Phường 5, Quận 3 nay thuộc đơn vị hành chính nào?",
      "Phường 5, Quận 3 hiện nay thuộc đơn vị hành chính cấp quận nào?",
    ],
  ];
  for (const [a, b] of t) console.log(JSON.stringify(safeRewrite(a, b)));
}
