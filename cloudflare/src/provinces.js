// ★ 省份归一化（M12）：灌入的演示数据曾以英文/中文存 province，
//   导致前端 provinceDisplay（只认标准越南语名）无法按语言切换显示。
//   本模块把任何已知变体（英文含/不含 City/Province 后缀、中文、无音标近似拼写）
//   归一化到系统标准值（= 编辑下拉框的 option value，越南语名），
//   迁移一次入库后，前端三语切换即刻生效。

// [标准越南语名, 中文, 英文] —— 与 index.html provinceDisplay 的 ps 表完全一致
const PROVINCES = [
  ["Hà Nội", "河内市", "Hanoi City"],
  ["Hải Phòng", "海防市", "Hai Phong City"],
  ["Huế", "顺化市", "Hue City"],
  ["Đà Nẵng", "岘港市", "Da Nang City"],
  ["TP. Hồ Chí Minh", "胡志明市", "Ho Chi Minh City"],
  ["Cần Thơ", "芹苴市", "Can Tho City"],
  ["Cao Bằng", "高平省", "Cao Bang Province"],
  ["Tuyên Quang", "宣光省", "Tuyen Quang Province"],
  ["Điện Biên", "奠边省", "Dien Bien Province"],
  ["Lai Châu", "莱州省", "Lai Chau Province"],
  ["Sơn La", "山罗省", "Son La Province"],
  ["Lào Cai", "老街省", "Lao Cai Province"],
  ["Thái Nguyên", "太原省", "Thai Nguyen Province"],
  ["Lạng Sơn", "谅山省", "Lang Son Province"],
  ["Quảng Ninh", "广宁省", "Quang Ninh Province"],
  ["Bắc Ninh", "北宁省", "Bac Ninh Province"],
  ["Phú Thọ", "富寿省", "Phu Tho Province"],
  ["Hưng Yên", "兴安省", "Hung Yen Province"],
  ["Ninh Bình", "宁平省", "Ninh Binh Province"],
  ["Thanh Hóa", "清化省", "Thanh Hoa Province"],
  ["Nghệ An", "义安省", "Nghe An Province"],
  ["Hà Tĩnh", "河静省", "Ha Tinh Province"],
  ["Quảng Trị", "广治省", "Quang Tri Province"],
  ["Quảng Ngãi", "广义省", "Quang Ngai Province"],
  ["Gia Lai", "嘉莱省", "Gia Lai Province"],
  ["Khánh Hòa", "庆和省", "Khanh Hoa Province"],
  ["Đắk Lắk", "得乐省", "Dak Lak Province"],
  ["Lâm Đồng", "林同省", "Lam Dong Province"],
  ["Đồng Nai", "同奈省", "Dong Nai Province"],
  ["Tây Ninh", "西宁省", "Tay Ninh Province"],
  ["Đồng Tháp", "同塔省", "Dong Thap Province"],
  ["Vĩnh Long", "永隆省", "Vinh Long Province"],
  ["An Giang", "安江省", "An Giang Province"],
  ["Cà Mau", "金瓯省", "Ca Mau Province"],
];

// 去音标 + đ→d（"Hà Nội"→"ha noi"，可匹配 "Ha Noi" 等手输变体）
function fold(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

// key(折叠小写) → 标准名；含：标准名/中文/英文/英文去后缀/标准名折叠
const LOOKUP = new Map();
function put(key, canonical) {
  const k = fold(String(key)).toLowerCase();
  if (k && !LOOKUP.has(k)) LOOKUP.set(k, canonical);
}
for (const [vi, zh, en] of PROVINCES) {
  put(vi, vi);
  put(zh, vi);
  put(en, vi);
  put(en.replace(/ (City|Province)$/, ""), vi); // "Hanoi" / "Bac Ninh"
}

/**
 * 归一化省份值 → 标准越南语名；未知值原样返回。
 */
export function normProvince(v) {
  if (v === null || v === undefined) return v;
  const s = String(v).trim();
  if (!s) return v;
  return LOOKUP.get(fold(s).toLowerCase()) || v;
}

/**
 * 数据迁移：把 table 里 province 非标准值的行批量改写为标准值（幂等，可反复调用）。
 * defaultUnknown：传入时，【无法匹配标准表的省份值】统一改写为该默认省
 *   （用户指定：CRM/WON 不在标准表的一律归入西宁省 Tây Ninh；LOST 归清化省 Thanh Hóa）。
 * 空值/NULL 不动。返回改写行数。
 */
export async function migrateProvinceColumn(env, table, defaultUnknown) {
  const rs = await env.DB.prepare("SELECT id, province FROM " + table).all();
  const rows = (rs && rs.results) || [];
  const stmts = [];
  for (const r of rows) {
    let fixed = normProvince(r.province);
    if (
      defaultUnknown &&
      fixed === r.province &&
      r.province !== null && r.province !== undefined &&
      String(r.province).trim() !== "" &&
      !LOOKUP.has(fold(r.province).toLowerCase())
    ) {
      fixed = defaultUnknown;   // 无匹配 → 默认省
    }
    if (fixed !== r.province) {
      stmts.push(env.DB.prepare("UPDATE " + table + " SET province=? WHERE id=?").bind(fixed, r.id));
    }
  }
  if (stmts.length) {
    // D1 batch 单次最多 100 条，分批执行
    for (let i = 0; i < stmts.length; i += 90) {
      await env.DB.batch(stmts.slice(i, i + 90));
    }
  }
  return stmts.length;
}

// ============================================================
// BU（业务单元）归一化迁移：假数据 BU-1/BU-2/BU-3 等 → 随机真实场
// 用户指定四种随机：蛋鸡场 chicken_egg_farm / 猪场 pig_farm /
//                   肉鸡场 broiler_farm / 蛋鸭场 duck_egg_farm
// 合法 key 集合内的值（含 duck_farm/others）保持不动；空值不动。
// 幂等：每次列表加载自动跑，新灌入的假数据也会被立即修正。
// ============================================================
const VALID_BU = new Set([
  "pig_farm", "broiler_farm", "chicken_egg_farm",
  "duck_farm", "duck_egg_farm", "others",
]);
const BU_RANDOM = ["chicken_egg_farm", "pig_farm", "broiler_farm", "duck_egg_farm"];

export async function migrateBuColumn(env, table) {
  const rs = await env.DB.prepare("SELECT id, bu FROM " + table).all();
  const rows = (rs && rs.results) || [];
  const stmts = [];
  for (const r of rows) {
    const v = r.bu == null ? "" : String(r.bu).trim();
    if (!v || VALID_BU.has(v)) continue;
    const pick = BU_RANDOM[Math.floor(Math.random() * BU_RANDOM.length)];
    stmts.push(env.DB.prepare("UPDATE " + table + " SET bu=? WHERE id=?").bind(pick, r.id));
  }
  for (let i = 0; i < stmts.length; i += 90) {
    await env.DB.batch(stmts.slice(i, i + 90));
  }
  return stmts.length;
}
