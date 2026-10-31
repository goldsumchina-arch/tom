// ⛔ FROZEN (2026-09-06) V2026.09.06.20：本文件逻辑已锁定，未经用户明确同意禁止修改。CRM 表格逻辑（含三语/切语言/权限）均正确，仅数据可为演示数据。
// ==================== CRM 潜在项目表格 (Potential Projects) ====================
// CRM columns: 48 total
// 0-11: 基本信息, 12-16: 日期, 17-19: 汇率/贸易, 20-40: 报价Q1-Q7, 41: 安装费, 42-44: PDF, 45-46: 销售, 47: 操作
var CRM_COL_KEYS = [
  'idx','quote_no','project_name','province','customer','bu','construction',
  'startup_pct','sign_pct','manager','manager_phone','company_info',
  'initial_quote_date','est_purchase_date','est_ship_date','quote_version','last_quote_date',
  'rate_rmb_vnd','rate_usd_vnd','incoterm',
  'q1_rmb','q1_usd','q1_vnd','q2_rmb','q2_usd','q2_vnd',
  'q3_rmb','q3_usd','q3_vnd','q4_rmb','q4_usd','q4_vnd',
  'q5_rmb','q5_usd','q5_vnd','q6_rmb','q6_usd','q6_vnd',
  'q7_rmb','q7_usd','q7_vnd',
  'install_quoted','pdf_equip','pdf_install','pdf_both',
  'salesperson','remark','id'
];

// 列索引->字段名映射(用于排序)
var CRM_COL_KEY_MAP = {
  0:'idx',1:'quote_no',2:'project_name',3:'province',4:'customer',5:'bu',
  6:'construction',7:'startup_pct',8:'sign_pct',9:'manager',10:'manager_phone',
  11:'company_info',12:'initial_quote_date',13:'est_purchase_date',14:'est_ship_date',
  15:'quote_version',16:'last_quote_date',17:'rate_rmb_vnd',18:'rate_usd_vnd',
  19:'incoterm',20:'q1_rmb',21:'q1_usd',22:'q1_vnd',
  23:'q2_rmb',24:'q2_usd',25:'q2_vnd',26:'q3_rmb',27:'q3_usd',28:'q3_vnd',
  29:'q4_rmb',30:'q4_usd',31:'q4_vnd',32:'q5_rmb',33:'q5_usd',34:'q5_vnd',
  35:'q6_rmb',36:'q6_usd',37:'q6_vnd',38:'q7_rmb',39:'q7_usd',40:'q7_vnd',
  41:'install_quoted',42:'pdf_equip',43:'pdf_install',44:'pdf_both',
  45:'salesperson',46:'remark',47:'id'
};

// 报价单 PDF 字段值兼容：完整 URL（云端 /api/files/.. 或本地 /uploads/..）直接用；
// 纯文件名（旧版本地数据）→ /uploads/<名>
function crmPdfHref(v){
  var s = String(v || '');
  if (!s) return '#';
  if (/^https?:\/\//i.test(s) || s.charAt(0) === '/') return s;
  return '/uploads/' + encodeURIComponent(s);
}
// CRM 表格「查看」：同款 PDF.js 预览（双指缩放/全屏），无预览组件时降级新开页
window.crmTableView = function(v){
  var url = crmPdfHref(v);
  var name = decodeURIComponent(url.split('/').pop() || 'PDF');
  if (window.openPdfPreview) window.openPdfPreview(url, name);
  else window.open(url, '_blank');
};

// 列分组定义（用于折叠）——每个一级表头字段一个分组，除 编号(0)/报价编号(1)/操作(47) 外全部可折叠
var CRM_GROUPS = [
  { label:'c2',   labelKey:'crm_project_name',     c:[2] },
  { label:'c3',   labelKey:'crm_province',         c:[3] },
  { label:'c4',   labelKey:'crm_customer',         c:[4] },
  { label:'c5',   labelKey:'crm_bu',               c:[5] },
  { label:'c6',   labelKey:'crm_construction',     c:[6] },
  { label:'c7',   labelKey:'crm_startup_pct',      c:[7] },
  { label:'c8',   labelKey:'crm_sign_pct',         c:[8] },
  { label:'c9',   labelKey:'crm_manager',          c:[9] },
  { label:'c10',  labelKey:'crm_manager_phone',    c:[10] },
  { label:'c11',  labelKey:'crm_company_info',     c:[11] },
  { label:'c12',  labelKey:'crm_initial_quote_date',c:[12] },
  { label:'c13',  labelKey:'crm_est_purchase_date',c:[13] },
  { label:'c14',  labelKey:'crm_est_ship_date',    c:[14] },
  { label:'c15',  labelKey:'crm_quote_version',    c:[15] },
  { label:'c16',  labelKey:'crm_last_quote_date',  c:[16] },
  { label:'rate', labelKey:'crm_rate_title',       c:[17,18] },
  { label:'c19',  labelKey:'crm_incoterm',         c:[19] },
  { label:'Q1',   labelKey:'crm_q1',               c:[20,21,22] },
  { label:'Q2',   labelKey:'crm_q2',               c:[23,24,25] },
  { label:'Q3',   labelKey:'crm_q3',               c:[26,27,28] },
  { label:'Q4',   labelKey:'crm_q4',               c:[29,30,31] },
  { label:'Q5',   labelKey:'crm_q5',               c:[32,33,34] },
  { label:'Q6',   labelKey:'crm_q6',               c:[35,36,37] },
  { label:'Q7',   labelKey:'crm_q7',               c:[38,39,40] },
  { label:'c41',  labelKey:'crm_install_quoted',   c:[41] },
  { label:'doc',  labelKey:'crm_pdf_title',        c:[42,43,44] },
  { label:'c45',  labelKey:'crm_salesperson',      c:[45] },
  { label:'c46',  labelKey:'crm_remark',           c:[46] },
];

// 折叠状态：true 表示该分组当前处于"已折叠/隐藏"状态
var crmGroupState = {};
CRM_GROUPS.forEach(function(g){ crmGroupState[g.label] = false; });

// 永不允许折叠/隐藏的列：编号(0)、报价编号(1)、操作(47)
var CRM_NEVER_HIDE_COLS = new Set([0, 1, 47]);

// 全局数据
var globalCrmData = [];
var originalCrmData = [];
var crmSortState = [];

// ==================== 排序 ====================
function crmCompareMulti(a, b, list) {
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var key = CRM_COL_KEY_MAP[s.col] || 'id';
    var valA = a[key];
    var valB = b[key];
    if (valA === null || valA === undefined || valA === '') valA = (typeof valB === 'number' ? 0 : '');
    if (valB === null || valB === undefined || valB === '') valB = (typeof valA === 'number' ? 0 : '');
    var cmp;
    if (typeof valA === 'number' && typeof valB === 'number') {
      cmp = valA - valB;
    } else {
      var strA = String(valA !== undefined ? valA : '').toLowerCase();
      var strB = String(valB !== undefined ? valB : '').toLowerCase();
      cmp = strA < strB ? -1 : (strA > strB ? 1 : 0);
    }
    if (cmp !== 0) return s.asc ? cmp : -cmp;
  }
  return 0;
}

function applyCrmSort() {
  var data = globalCrmData.slice();
  if (crmSortState.length) {
    var list = crmSortState.slice();
    data.sort(function(a, b) { return crmCompareMulti(a, b, list); });
  }
  _crmSetTbodyHtml(renderCrmData(data));
  // 兜底：渲染包装器已处理，但排序后再显式确保行内按钮按权限隐藏
  if (typeof applyCrmRowPerms === 'function') applyCrmRowPerms();
  updateCrmSortIndicators();
}

function updateCrmSortIndicators() {
  var tbl = document.getElementById('crmTable');
  if (!tbl) return;
  tbl.querySelectorAll('.sort-indicator').forEach(function(el) {
    el.classList.remove('active');
    el.textContent = '\u21c5';
  });
  crmSortState.forEach(function(s, idx) {
    tbl.querySelectorAll('.sort-indicator[data-col="' + s.col + '"]').forEach(function(el) {
      el.classList.add('active');
      el.textContent = (s.asc ? '\u25b2' : '\u25bc') + (idx + 1);
    });
  });
}

function sortCrmTable(colIndex, ev) {
  if (colIndex === 0 || colIndex === 47) return;
  if (globalCrmData.length === 0) return;
  var useMulti = ev && ev.ctrlKey;
  var foundIdx = -1;
  for (var i = 0; i < crmSortState.length; i++) {
    if (crmSortState[i].col === colIndex) { foundIdx = i; break; }
  }
  if (foundIdx >= 0) {
    // 已在排序组合中：循环 升序 -> 降序 -> 移除
    if (crmSortState[foundIdx].asc) {
      crmSortState[foundIdx].asc = false;
    } else {
      crmSortState.splice(foundIdx, 1);
    }
  } else {
    if (useMulti) {
      // Ctrl+点击：追加为次级排序（组合排序）
      crmSortState.push({ col: colIndex, asc: true });
    } else {
      // 普通点击：重置为单列排序
      crmSortState = [{ col: colIndex, asc: true }];
    }
  }
  if (crmSortState.length === 0) {
    var tb0 = document.getElementById('crmTbody');
    if (tb0) tb0.innerHTML = renderCrmData(originalCrmData.slice());
    // 兜底：取消排序后显式按权限隐藏行内按钮
    if (typeof applyCrmRowPerms === 'function') applyCrmRowPerms();
    updateCrmSortIndicators();
    return;
  }
  applyCrmSort();
}

// ==================== 辅助显示函数 ====================
function crmInstallDisplay(v) {
  var t = T();
  if (v === 1 || v === '1' || v === true || v === '是' || v === 'Yes' || v === 'yes' || v === 'Y') return t.crm_yes || 'Yes';
  if (v === 0 || v === '0' || v === false || v === '否' || v === 'No' || v === 'no' || v === 'N') return t.crm_no_yes || 'No';
  return '';
}

// ==================== colgroup ====================
function buildCrmColGroup() {
  var html = '';
  for (var i = 0; i < 48; i++) {
    // 固定列宽度必须精确匹配 .col-fixed-2 的 left:40px 偏移，避免两列之间出现空隙
    var w = '';
    if (i === 0) w = ' width="40"';
    else if (i === 1) w = ' width="90"';
    html += '<col data-col="' + i + '" class="col-' + i + '"' + w + '>';
  }
  return html;
}

// ==================== 列可见性单一事实源（根治表头/数据错位） ====================
// 根因：renderCrmData 每次重新生成 tbody（新 td 不带 .col-hidden），而 thead/colgroup
// 的折叠类还在 → 表头与数据可见列数不一致 → 错位。
// 方案：全表 48 列按"期望隐藏集合"（用户列组折叠状态）统一应用，th/td/col 永远一致；
// 由 renderCrmData 包装器在每次 tbody 再生后自动调用。
function syncCrmColVisibility() {
  var tbl = document.getElementById('crmTable');
  if (!tbl) return;
  var hidden = {};
  CRM_GROUPS.forEach(function(g) {
    if (crmGroupState[g.label]) g.c.forEach(function(c) { if (!CRM_NEVER_HIDE_COLS.has(c)) hidden[c] = 1; });
  });
  for (var c = 0; c < 48; c++) {
    if (CRM_NEVER_HIDE_COLS.has(c)) continue;
    var want = !!hidden[c] || (typeof curHiddenFor === 'function' && curHiddenFor(c, 'q'));
    tbl.querySelectorAll('[data-col="' + c + '"]').forEach(function(el) {
      if (el.tagName === 'TH') return;   // 一级表头绝不随单列隐藏，统一由下方组头逻辑处理
      el.classList.toggle('col-hidden', want);
    });
  }
  // 组头单一事实源：仅当组内全部子列都被隐藏时一级表头才隐藏；
  // 否则一级表头保持原位显示，colspan 自动收缩为剩余可见子列数（3→2→1），
  // 文字/位置/配色零改动（货币开关仅收窄其覆盖宽度，剩余子列自动撑满）。
  CRM_GROUPS.forEach(function(g) {
    var first = -1;
    for (var i = 0; i < g.c.length; i++) { if (!CRM_NEVER_HIDE_COLS.has(g.c[i])) { first = g.c[i]; break; } }
    if (first < 0) return;
    var vis = 0;
    g.c.forEach(function(c) {
      if (CRM_NEVER_HIDE_COLS.has(c)) { vis++; return; }
      if (!hidden[c] && !(typeof curHiddenFor === 'function' && curHiddenFor(c, 'q'))) vis++;
    });
    var th = tbl.querySelector('thead th[data-col="' + first + '"]');
    if (th) {
      if (vis === 0) th.classList.add('col-hidden');
      else { th.classList.remove('col-hidden'); th.colSpan = vis; th.classList.toggle('hdr-shrink', vis < g.c.length); }
      var b = th.querySelector('.won-col-toggle');
      if (b) {
        // ★ CRM-PATCH-TBODY-20261029：innerText 会被当成结构变更（且 setter 可能触发布局），
        //   这里改成原地改文本节点，内容已一致时零 DOM 操作。
        var _bt = hidden[first] ? '[+]' : '[\u2212]';
        if (b.textContent !== _bt) {
          var _bo = (b.childNodes.length === 1) ? b.firstChild : null;
          if (_bo && _bo.nodeType === 3) _bo.nodeValue = _bt;
          else b.textContent = _bt;
        }
      }
    }
  });
  updateCrmCollapsedBar();
}

function toggleCrmColumnGroupByLabel(label) {
  var grp = null;
  for (var g = 0; g < CRM_GROUPS.length; g++) {
    if (CRM_GROUPS[g].label === label) { grp = CRM_GROUPS[g]; break; }
  }
  if (!grp) return;
  var cols = grp.c.filter(function(c) { return !CRM_NEVER_HIDE_COLS.has(c); });
  if (cols.length === 0) { crmGroupState[label] = false; return; }
  crmGroupState[label] = !crmGroupState[label];
  syncCrmColVisibility();   // 单一事实源统一应用（th/td/col/按钮/折叠条）
}

function injectCrmToggleBtns() {
  var t = T();
  var tbl = document.getElementById('crmTable');
  if (!tbl) return;
  CRM_NEVER_HIDE_COLS.forEach(function(c) {
    tbl.querySelectorAll('thead th[data-col="' + c + '"]').forEach(function(th) {
      var old = th.querySelector('.won-col-toggle');
      if (old) old.remove();
    });
  });
  CRM_GROUPS.forEach(function(grp) {
    var c = grp.c[0];
    if (CRM_NEVER_HIDE_COLS.has(c)) return;
    var th = tbl.querySelector('thead th[data-col="' + c + '"]');
    if (!th || th.querySelector('.won-col-toggle')) return;
    var btn = document.createElement('span');
    btn.className = 'won-col-toggle';
    btn.innerText = '[\u2212]';
    btn.title = '\u6298\u53e0/\u5c55\u5f00\u8be5\u5217\u7ec4(\u6574\u7ec4\u4e00\u8d77\u9690\u85cf)';
    btn.addEventListener('click', function(e) { e.stopPropagation(); toggleCrmColumnGroupByLabel(grp.label); });
    // 排序标识放在折叠标识的右侧：折叠按钮插入到排序箭头之前
    var sortInd = th.querySelector('.sort-indicator');
    if (sortInd) th.insertBefore(btn, sortInd);
    else th.appendChild(btn);
  });
}

// ==================== 折叠条 ====================
function updateCrmCollapsedBar() {
  var bar = document.getElementById('crm-collapsed-bar');
  if (!bar) return;
  var t = T();
  var tags = '', has = false;
  CRM_GROUPS.forEach(function(g) {
    if (crmGroupState[g.label]) {
      has = true;
      var labelText = g.labelKey && t[g.labelKey] ? t[g.labelKey] : g.label;
      tags += '<span class="tag"><span>' + labelText + '</span>' +
              '<span class="restore-btn" data-restore="' + g.label + '">[+]</span></span>';
    }
  });
  if (has) {
    bar.style.display = 'flex';
    bar.innerHTML = '<span style="font-weight:bold;color:#666;font-size:12px;">' + (t.hiddenColumns || 'Hidden:') + '</span> ' + tags;
    bar.querySelectorAll('.restore-btn').forEach(function(b) {
      b.onclick = function() { toggleCrmColumnGroupByLabel(b.dataset.restore); };
    });
  } else {
    bar.style.display = 'none';
    bar.innerHTML = '';
  }
}

// ==================== 一级表头 ====================
// 返回 <tr class="won-thead">...</tr>（不含<thead>标签）
function renderCrmThead() {
  var t = T();
  var html = '<tr class="won-thead">';
  var hdr = function(i, label, cls, cs, sortable) {
    cs = cs || 1;
    cls = cls || '';
    if (i === 0) cls += ' col-fixed col-never-hide';
    else if (i === 1) cls += ' col-fixed-2 col-never-hide';
    if (i === 47) cls += ' col-never-hide';
    // 固定列宽度精确锁定，与 .col-fixed-2 的 left:40px 偏移对齐，消除两列间空隙
    var w = '';
    if (i === 0) w = ' style="width:40px;min-width:40px;max-width:40px;"';
    else if (i === 1) w = ' style="width:90px;min-width:90px;max-width:90px;"';
    var sortHtml = sortable ? ' <span class="sort-indicator" data-col="' + i + '" onclick="sortCrmTable(' + i + ',event)">\u21c5</span>' : '';
    return '<th class="' + cls + '"' + w + ' colspan="' + cs + '" data-col="' + i + '">' +
           '<span class="th-label">' + label + '</span>' + sortHtml + '</th>';
  };

  // 基本信息(0-5) 浅青色
  html += hdr(0,  t.crm_no || 'No.',            'won-cyan', 1, false);
  html += hdr(1,  t.crm_quote_no,               'won-cyan', 1, true);
  html += hdr(2,  t.crm_project_name,            'won-cyan', 1, true);
  html += hdr(3,  t.crm_province,                'won-cyan', 1, true);
  html += hdr(4,  t.crm_customer,                'won-cyan', 1, true);
  html += hdr(5,  t.crm_bu,                     'won-cyan', 1, true);
  // 建设/概率(6-8) 浅粉色
  html += hdr(6,  t.crm_construction,            'won-pink', 1, true);
  html += hdr(7,  t.crm_startup_pct,             'won-pink', 1, true);
  html += hdr(8,  t.crm_sign_pct,               'won-pink', 1, true);
  // 负责人/联系(9-11) 浅蓝色
  html += hdr(9,  t.crm_manager,                'won-blue', 1, true);
  html += hdr(10, t.crm_manager_phone,           'won-blue', 1, true);
  html += hdr(11, t.crm_company_info,           'won-blue', 1, true);
  // 日期(12-16) 浅黄色
  html += hdr(12, t.crm_initial_quote_date,     'won-yellow', 1, true);
  html += hdr(13, t.crm_est_purchase_date,      'won-yellow', 1, true);
  html += hdr(14, t.crm_est_ship_date,          'won-yellow', 1, true);
  html += hdr(15, t.crm_quote_version,          'won-yellow', 1, true);
  html += hdr(16, t.crm_last_quote_date,        'won-yellow', 1, true);
  // 汇率(17-18, colspan=2) —— 一级标题"报价时汇率"
  html += hdr(17, t.crm_rate_title || 'Exchange Rate', 'rate', 2, false);
  // 贸易术语(19)
  html += hdr(19, t.crm_incoterm,               'hdr', 1, true);
  // Q1-Q7(每项 colspan=3) —— 深黄色一级表头
  html += hdr(20, t.crm_q1 || 'Q1',             'won-qhdr', 3, false);
  html += hdr(23, t.crm_q2 || 'Q2',             'won-qhdr', 3, false);
  html += hdr(26, t.crm_q3 || 'Q3',             'won-qhdr', 3, false);
  html += hdr(29, t.crm_q4 || 'Q4',             'won-qhdr', 3, false);
  html += hdr(32, t.crm_q5 || 'Q5',             'won-qhdr', 3, false);
  html += hdr(35, t.crm_q6 || 'Q6',             'won-qhdr', 3, false);
  html += hdr(38, t.crm_q7 || 'Q7',             'won-qhdr', 3, false);
  // 已报安装费(41) 浅绿色
  html += hdr(41, t.crm_install_quoted,         'won-p1', 1, true);
  // PDF(colspan=3) 浅粉色
  html += hdr(42, t.crm_pdf_title || 'Quote PDF','won-pink', 3, false);
  // 销售(45-46) 浅蓝色
  html += hdr(45, t.crm_salesperson,            'won-blue', 1, true);
  html += hdr(46, t.crm_remark,                 'won-blue', 1, true);
  // 操作(47) 黄色
  html += hdr(47, t.crm_action || 'Action',     'won-action-yellow', 1, false);

  html += '</tr>';
  return html;
}

// ==================== 二级假表头 ====================
function renderCrmFakeSubHeaderRow() {
  var t = T();
  var html = '<tr class="fake-header-row">';
  for (var i = 0; i < 48; i++) {
    var cls = 'fake-hdr ';
    var label = '';
    if      (i>=0 && i<=5)  { cls+='won-cyan'; }
    else if (i>=6 && i<=8)  { cls+='won-pink'; }
    else if (i>=9 && i<=11) { cls+='won-blue'; }
    else if (i>=12 && i<=16){ cls+='won-yellow'; }
    else if (i===17) { cls+='rate';    label='RMB-VND'; }
    else if (i===18) { cls+='rate';    label='USD-VND'; }
    else if (i===20||i===23||i===26||i===29||i===32||i===35||i===38) { cls+='won-rmb'; label=t.crm_rmb || 'RMB'; }
    else if (i===21||i===24||i===27||i===30||i===33||i===36||i===39) { cls+='won-usd'; label=t.crm_usd || 'USD'; }
    else if (i===22||i===25||i===28||i===31||i===34||i===37||i===40) { cls+='won-vnd'; label=t.crm_vnd || 'VND'; }
    else if (i===41) { cls+='won-p1'; }
    else if (i===42) { cls+='won-pink'; label=t.crm_pdf_equip||'Equip'; }
    else if (i===43) { cls+='won-pink'; label=t.crm_pdf_install||'Install'; }
    else if (i===44) { cls+='won-pink'; label=t.crm_pdf_both||'Both'; }
    else if (i===45) { cls+='won-blue'; }
    else if (i===46) { cls+='won-blue'; }
    else if (i===47) { cls+='won-action-yellow'; }
    // 固定列(0/1)与操作列(47)不参与折叠
    if (i===0) cls += ' col-fixed col-never-hide';
    else if (i===1) cls += ' col-fixed-2 col-never-hide';
    else if (i===47) cls += ' col-never-hide';
    // 固定列宽度精确锁定，与 .col-fixed-2 的 left:40px 偏移对齐
    var st = '';
    if (i===0) st = ' style="width:40px;min-width:40px;max-width:40px;"';
    else if (i===1) st = ' style="width:90px;min-width:90px;max-width:90px;"';
    // 可排序的二级子表头：汇率(17,18)、Q1-Q7(20-40)、PDF(42,43,44)
    var sortable = (i>=17 && i<=18) || (i>=20 && i<=40) || (i>=42 && i<=44);
    if (sortable) {
      cls += ' sortable-cell';
      html += '<td class="' + cls + '"' + st + ' data-col="' + i + '">' + label +
              ' <span class="sort-indicator" data-col="' + i + '" onclick="sortCrmTable(' + i + ',event)">\u21c5</span></td>';
    } else {
      html += '<td class="' + cls + '"' + st + ' data-col="' + i + '">' + label + '</td>';
    }
  }
  html += '</tr>';
  return html;
}

// ==================== 表体渲染 ====================
function renderCrmData(list) {
  var t = T();
  var html = renderCrmFakeSubHeaderRow();
  list.forEach(function(p, rowIdx) {
    var rowNo = rowIdx + 1;
    html += '<tr class="won-data-row' + (rowIdx % 2 === 1 ? ' zebra-even' : '') + '">';
    for (var i = 0; i < 48; i++) {
      var cls = 'hdr';
      var val = p[CRM_COL_KEYS[i]];
      var dc = ' data-col="' + i + '"';
      var st = '';
      var esc = function(v) { return v === undefined || v === null ? '' : String(v); };

      switch(i) {
        case 0:  cls='won-cyan col-fixed col-never-hide'; val=rowNo; st=' style="width:40px;min-width:40px;max-width:40px;"'; break;
        case 1:  cls='won-cyan col-fixed-2 col-never-hide'; val=esc(val); st=' style="width:90px;min-width:90px;max-width:90px;"'; break;
        case 2:  cls='won-cyan'; val=esc(val); break;
        case 3:  cls='won-cyan'; val=(typeof provinceDisplay === 'function') ? provinceDisplay(val) : esc(val); break;
        case 4:  cls='won-cyan'; val=esc(val); break;
        case 5:  cls='won-cyan'; val=buDisplay(val); break;
        case 6:  cls='won-pink'; val=constructionDisplay(val); break;
        case 7:  cls='won-pink'; val=(val !== undefined && val !== null && val !== '') ? val+'%' : ''; break;
        case 8:  cls='won-pink'; val=(val !== undefined && val !== null && val !== '') ? val+'%' : ''; break;
        case 9:  cls='won-blue'; val=esc(val); break;
        case 10: cls='won-blue'; val=esc(val); break;
        case 11: cls='won-blue'; val=esc(val); break;
        case 12: cls='won-yellow'; val=ymdToDmy(val); break;
        case 13: cls='won-yellow'; val=ymdToDmy(val); break;
        case 14: cls='won-yellow'; val=ymdToDmy(val); break;
        case 15: cls='won-yellow'; val=esc(val); break;
        case 16: cls='won-yellow'; val=ymdToDmy(val); break;
        // ★ 2026-10-29：toLocaleString('en-US') 每次调用都会新建 Intl.NumberFormat（大表渲染的主要耗时），
        //   改用 index.html 的纯字符串 fmtThousands，输出完全一致。
        case 17: cls='rate'; val=(val !== undefined && val !== null && val !== '') ? ((typeof fmtThousands === 'function') ? fmtThousands(val) : (Math.round(Number(val)||0)).toLocaleString('en-US')) : ''; break;
        case 18: cls='rate'; val=(val !== undefined && val !== null && val !== '') ? ((typeof fmtThousands === 'function') ? fmtThousands(val) : (Math.round(Number(val)||0)).toLocaleString('en-US')) : ''; break;
        case 19: cls='hdr'; val=esc(val); break;
        case 20: case 23: case 26: case 29: case 32: case 35: case 38: {
          var qMap={20:1,23:2,26:3,29:4,32:5,35:6,38:7};
          var q=qMap[i];
          var rmb=fmtMoney(p['q'+q+'_rmb'],'rmb');
          var usd=fmtMoney(p['q'+q+'_usd'],'usd');
          var vnd=fmtMoney(p['q'+q+'_vnd'],'vnd');
          // 三个子列必须各自携带正确列号：若共用同一个 data-col，按币种隐藏时会一次命中 3 个单元格，数据整行左移错位
          html+='<td class="won-rmb" data-col="'+i+'">'+rmb+'</td>';
          html+='<td class="won-usd" data-col="'+(i+1)+'">'+usd+'</td>';
          html+='<td class="won-vnd" data-col="'+(i+2)+'">'+vnd+'</td>';
          continue;
        }
        case 21: case 24: case 27: case 30: case 33: case 36: case 39:
        case 22: case 25: case 28: case 31: case 34: case 37: case 40:
          continue; // 已由上面的case 20/23等渲染
        case 41: {
          var insRaw = val;
          var insYes = (insRaw === '是' || insRaw === '1' || insRaw === 1 || insRaw === true ||
                        insRaw === 'Yes' || insRaw === 'yes' || insRaw === 'Y');
          var insColor = insYes ? '#d0021b' : '#000000';
          html += '<td class="won-p1"' + dc + '><span style="color:' + insColor + ';font-weight:' + (insYes ? '700' : '400') + ';">' + crmInstallDisplay(insRaw) + '</span></td>';
          continue;
        }
        case 42: {
          cls='won-pink';
          if (val && val !== '0' && val !== 'null' && val !== 'none') {
            html+='<td class="won-pink"'+dc+'><a href="javascript:void(0)" onclick="crmTableView(\''+String(val).replace(/'/g,"\\'")+'\')" style="color:#2c5fa8;text-decoration:underline;cursor:pointer">'+(t.crm_view||'View')+'</a> <a href="'+crmPdfHref(val)+'" download target="_blank" style="color:#3b7dd8;text-decoration:underline;margin-left:4px">'+(t.crm_download||'下载')+'</a></td>';
          } else {
            html+='<td class="won-pink"'+dc+'><span style="color:#aaa">'+(t.crm_no_pdf||'No PDF')+'</span></td>';
          }
          continue;
        }
        case 43: {
          cls='won-pink';
          if (val && val !== '0' && val !== 'null' && val !== 'none') {
            html+='<td class="won-pink"'+dc+'><a href="javascript:void(0)" onclick="crmTableView(\''+String(val).replace(/'/g,"\\'")+'\')" style="color:#2c5fa8;text-decoration:underline;cursor:pointer">'+(t.crm_view||'View')+'</a> <a href="'+crmPdfHref(val)+'" download target="_blank" style="color:#3b7dd8;text-decoration:underline;margin-left:4px">'+(t.crm_download||'下载')+'</a></td>';
          } else {
            html+='<td class="won-pink"'+dc+'><span style="color:#aaa">'+(t.crm_no_pdf||'No PDF')+'</span></td>';
          }
          continue;
        }
        case 44: {
          cls='won-pink';
          if (val && val !== '0' && val !== 'null' && val !== 'none') {
            html+='<td class="won-pink"'+dc+'><a href="javascript:void(0)" onclick="crmTableView(\''+String(val).replace(/'/g,"\\'")+'\')" style="color:#2c5fa8;text-decoration:underline;cursor:pointer">'+(t.crm_view||'View')+'</a> <a href="'+crmPdfHref(val)+'" download target="_blank" style="color:#3b7dd8;text-decoration:underline;margin-left:4px">'+(t.crm_download||'下载')+'</a></td>';
          } else {
            html+='<td class="won-pink"'+dc+'><span style="color:#aaa">'+(t.crm_no_pdf||'No PDF')+'</span></td>';
          }
          continue;
        }
        case 45: cls='won-blue'; val=esc(val); break;
        // 备注(46)：三语按当前表头语言显示（数据含 remark_zh/en/vi；旧单语数据回退 p.remark）
        case 46: cls='won-blue'; val=esc(typeof rmLangVal==='function' ? rmLangVal(p, 'remark') : val); break;
        case 47: {
          var viewBtn='<button class="btn-sm btn-view" onclick="viewCrm('+p.id+')">'+(t.crm_view||'View')+'</button>';
          // ★ 编辑/删除/转到失败 按钮的显隐完全由 CRM-D2/D3/F1 权限决策控制
          //   （渲染后由 applyCrmRowPerms 按 permVisible 处理），
          //   数据范围内的行都可操作 —— 与权限标签"可编辑数据范围内的CRM项目"一致；
          //   服务端按 可见范围 + 决策闸（permGate）双重校验。
          var writeBtns = ' <button class="btn-sm btn-edit" onclick="openCrmModal('+p.id+')">'+(t.crm_edit||'Edit')+'</button>'
              +' <button class="btn-sm btn-del" onclick="deleteCrm('+p.id+')">'+(t.crm_del||'Del')+'</button>'
              +' <button class="btn-sm btn-fail" onclick="moveCrmToFailed('+p.id+')">'+(t.crm_failed||'Failed')+'</button>';
          html+='<td class="won-action-yellow col-never-hide"'+dc+'>'+viewBtn+writeBtns+'</td>';
          continue;
        }
        default: val=esc(val);
      }
      html+='<td class="'+cls+'"'+st+dc+'>'+val+'</td>';
    }
    html+='</tr>';
  });
  if (list.length === 0) {
    html+='<tr><td colspan="48" style="text-align:center;padding:40px;color:#999">'+(t.crm_empty||'No data')+'</td></tr>';
  }
  return html;
}

// ==================== 加载数据 ====================
function crmApiBase() {
  // 注意：不能用 (API_BASE && ...) 判断，因为 API_BASE 为空字符串(同源)是合法值但为 falsy，
  // 那样会错误地 fallback 到 127.0.0.1，导致手机通过局域网 IP 访问时请求全部失败。
  return (typeof API_BASE !== 'undefined') ? API_BASE : '';
}

function loadCrm(isAuto) {
  var cg = document.getElementById('crmColGroup');
  var th = document.getElementById('crmThead');
  var tb = document.getElementById('crmTbody');
  if (!cg || !th || !tb) return;
  bindCrmCrossHighlight();

  // 首次进入时按当前语言更新标题与"+ New CRM / 导出 Excel"按钮
  var t0 = T();
  var crmTitleEl = document.getElementById('crmTitle');
  var btnAddCrm = document.getElementById('btnAddCrm');
  var btnCrmOverview = document.getElementById('btnCrmOverview');
  var btnExportCrmExcel = document.getElementById('btnExportCrmExcel');
  if (crmTitleEl) crmTitleEl.innerText = t0.crmTitle;
  if (btnAddCrm) btnAddCrm.innerText = t0.btnAddCrm;
  if (btnCrmOverview) btnCrmOverview.innerText = t0.btnCrmOverview;
  if (btnExportCrmExcel) btnExportCrmExcel.innerText = t0.btnExportCrmExcel;

  // ★ HEAD-LOCK-20261030（复制签约项目 loadWon 的做法）：表头/colgroup 结构只建一次。
  //   数据重载（保存后刷新 / 备注补翻重拉 / 切语言重取数）绝不再重建 thead，
  //   已存在时只做【纯文字刷新】→ 一级/二级表头锁死不动，只有文字随语言变化。
  //   （签约项目 loadWon 同样只 renderWonData，从不碰 thead。）
  if (!cg.children.length) cg.innerHTML = buildCrmColGroup();
  if (!th.children.length) {
    th.innerHTML = renderCrmThead();
    injectCrmToggleBtns();
  } else if (typeof updateCrmTheadTextOnly === 'function') {
    updateCrmTheadTextOnly();
  }
  updateCrmCollapsedBar();
  // thead 重建后立即按单一事实源恢复列可见性与组头 colspan（含无数据路径）
  if (typeof syncCrmColVisibility === 'function') syncCrmColVisibility();

  var emptyRow = '<tr><td colspan="48" style="text-align:center;padding:40px;color:#999">' + ((T().crm_empty) || 'No data') + '</td></tr>';

  // 加载数据（后端返回普通数组；为兼容旧格式也接受 {status:'ok',data:[...]}）
  fetch(crmApiBase() + '/api/crm-projects', { credentials:'include', headers: (typeof authHeaders==='function'?authHeaders():{}) })
    .then(function(r){ return r.json(); })
    .then(function(data) {
      var list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : null);
      if (list) {
        globalCrmData = list.slice();
        originalCrmData = list.slice();
        globalCrmData.forEach(function(row,i){ row.idx = i+1; });
        originalCrmData.forEach(function(row,i){ row.idx = i+1; });
        _crmSetTbodyHtml(renderCrmData(globalCrmData));   // ★ 复用二级表头行节点
      } else {
        tb.innerHTML = emptyRow;
      }
      applyCrmRowPerms();   // 渲染完成后立即按权限隐藏按钮（不依赖外部 setTimeout 猜测延时）
      // V28：服务端补翻缺的三语备注并写库；filled>0 时重拉一次（重拉后 filled=0 即止，无递归）
      if (typeof autoFillRemarks === 'function') {
        // 非自动重拉（switchView/reloadSession 直调）清零链计数；自动重拉回调传 true 累加
        if (!isAuto) { try { (window.__autoFillChain = window.__autoFillChain || {}).crm_projects = 0; } catch(e){} }
        autoFillRemarks('crm_projects', function(){ loadCrm(true); });
      }
    })
    .catch(function() {
      tb.innerHTML = emptyRow;
    });
}

// CRM 行内按钮（查看/编辑/删除/转到失败项目）按权限隐藏
// 注意：必须在表格渲染完成后调用，否则新渲染的按钮会绕过隐藏（此前依赖外部 setTimeout 350ms，慢于渲染时失效）
function applyCrmRowPerms(){
  if (typeof applyRowPerms !== 'function') return;
  applyRowPerms('crmTbody', [
    { bid: 'CRM-D1', sel: '.btn-view' },
    { bid: 'CRM-D2', sel: '.btn-edit' },
    { bid: 'CRM-D3', sel: '.btn-del' },
    { bid: 'CRM-F1', sel: '.btn-fail' }
  ]);
}

// ==================== 语言应用 ====================
// ★ 100% 复刻 WON 的 applyWonLang 逻辑（WON 切语言正常、CRM/LOST 白板的根因即在此）：
//   WON 切语言【从不重建】表头结构（updateTheadTextOnly 纯文本更新，折叠状态/列宽/
//   开关按钮/排序指示全部保留），行重渲染仅在视图可见时进行，不可见时打轻标
//   _viewLangStale.won 由 switchView 消费。
//   旧 CRM/LOST 每次切语言都 cg.innerHTML + th.innerHTML 重建表头：
//   重建后折叠类丢失、开关按钮重置，与行的可见列瞬间错位 → 用户看到"一片空白"。
// ★ 表头锁定 · HEAD-LOCK-20261030（用户要求：100% 复制「签约项目」的表头处理逻辑）
//   与 index.html 签约项目的 updateTheadTextOnly() 完全同构，三条不变量：
//   ① 结构只建一次（首次进入视图 / loadCrm）；② 每个 th 带 data-col 当定位锚点；
//   ③ 切语言只做【纯文字替换】——绝不重建 th、绝不改 colspan/class 结构、
//      折叠按钮(.won-col-toggle)、排序箭头(.sort-indicator)、sticky 层级、列宽全部原地保留。
//   因此一级表头与二级表头在切语言时"锁死不动"，只有文字变化。
//   ⛔ 不得把 th.innerHTML = renderCrmThead() 改回切语言主路径：重建会让折叠状态/
//      按钮/排序箭头整体复位，用户看到"表头跳一下 / 闪一下"。
// 取（必要时就地补）th 内的文字容器 .th-label —— 只插入节点，不删除任何结构节点
function _crmTheadLabelNode(thEl) {
  var lab = thEl.querySelector('.th-label');
  if (lab) return lab;
  lab = document.createElement('span');
  lab.className = 'th-label';
  if (thEl.firstChild) thEl.insertBefore(lab, thEl.firstChild);
  else thEl.appendChild(lab);
  return lab;
}
// 原地改文字：单文本节点时只改 nodeValue（零结构变更），否则重建文本容器内部文本
function _crmSetLabelText(node, txt) {
  var only = (node.childNodes.length === 1) ? node.firstChild : null;
  if (only && only.nodeType === 3) {
    if (only.nodeValue !== txt) only.nodeValue = txt;
    return;
  }
  if (node.textContent === txt) return;
  while (node.firstChild) node.removeChild(node.firstChild);
  node.appendChild(document.createTextNode(txt));
}

function updateCrmTheadTextOnly() {
  var th = document.getElementById('crmThead');
  if (!th || typeof renderCrmThead !== 'function') return;
  try {
    // 唯一允许建结构的场景：thead 完全空白（首次进入视图，HTML 初始 <thead> 为空）。
    // 此时没有任何既有结构可破坏，等同签约项目首次 renderWonThead。
    if (!th.children.length) {
      console.warn('[crm-lang] thead first-time init (empty on view entry) -> build');
      th.innerHTML = renderCrmThead();
      if (typeof injectCrmToggleBtns === 'function') injectCrmToggleBtns();
      if (typeof syncCrmColVisibility === 'function') syncCrmColVisibility();
      return;
    }
    // 真损坏（有内容但一个 th[data-col] 都没有）→ 无从打补丁，只能重建自愈。
    // 正常路径永远不会命中：renderCrmThead 生成的每个 th 都带 data-col。
    if (!th.querySelector('th[data-col]')) {
      console.warn('[crm-lang] thead DAMAGED (no th[data-col]) -> full rebuild');
      th.innerHTML = renderCrmThead();
      if (typeof injectCrmToggleBtns === 'function') injectCrmToggleBtns();
      if (typeof syncCrmColVisibility === 'function') syncCrmColVisibility();
      return;
    }
    // 期望文案：同一套渲染函数在【游离 thead】里生成（不进文档流，不触发布局/绘制）
    var tmp = document.createElement('thead');
    tmp.innerHTML = renderCrmThead();
    var newThs = tmp.querySelectorAll('th[data-col]');
    var oldMap = {};
    th.querySelectorAll('th[data-col]').forEach(function(el){ oldMap[el.getAttribute('data-col')] = el; });
    for (var k = 0; k < newThs.length; k++) {
      var c = newThs[k].getAttribute('data-col');
      var src = newThs[k].querySelector('.th-label');
      var old = oldMap[c];
      if (!old || !src) continue;                       // 结构对不上就跳过，绝不重建
      _crmSetLabelText(_crmTheadLabelNode(old), src.textContent);
    }
  } catch (e) { console.warn('[crm-lang] thead text sync failed:', e); }
}

// 表格侧备注补翻兜底（录入侧 rmOnInput 已三语落库；此处处理历史单语数据）。
// 行定位用 tr.won-data-row 的序号（行无 data-id），单元格用 td[data-col="46"]。
function _crmFillMissingRemarks(tb) {
  if (typeof ptTranslateText !== 'function') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  var L = (typeof CUR_LANG !== 'undefined') ? CUR_LANG : 'en';
  var trs = tb ? tb.querySelectorAll('tr.won-data-row') : [];
  (typeof globalCrmData !== 'undefined' ? globalCrmData : []).forEach(function(row, i){
    if (!row || !row.remark) return;
    // 行级失败标记：本会话内翻译失败过的行不再重试（防止每次切语言重复轰炸失败接口）
    row.__rmFail = row.__rmFail || {};
    var o = (row.remark_zh || row.remark_en || row.remark_vi)
      ? { zh: row.remark_zh || '', en: row.remark_en || '', vi: row.remark_vi || '' }
      : { zh: String(row.remark || ''), en: '', vi: '' };
    if ((o[L] || '').trim()) return;
    if (row.__rmFail[L]) return;
    var srcLang = null, srcText = '';
    ['zh', 'en', 'vi'].forEach(function(l){
      if (l === L || srcLang) return;
      var v = (o[l] || '').trim();
      if (v) { srcLang = l; srcText = v; }
    });
    if (!srcLang) return;
    ptTranslateText(srcText, L).then(function(res){
      if (!res) { row.__rmFail[L] = Date.now(); return; }
      o[L] = res;
      row.remark_zh = o.zh; row.remark_en = o.en; row.remark_vi = o.vi;
      var tr = trs[i];
      if (tr) {
        var cell = tr.querySelector('td[data-col="46"]');
        if (cell) cell.textContent = res;
      }
    }).catch(function(){ row.__rmFail[L] = Date.now(); });
  });
}

// ==================================================================
// tbody / 二级表头【文本级补丁】—— CRM-PATCH-TBODY-20261029
// 用户授权（2026-10-29）：切语言时不再销毁重建 tbody，改为"只改文字"。
//
// 根因（白闪）：
//   ① tb.innerHTML = renderCrmData(...) 把 60行×48列=2880 个单元格全部丢弃重建，
//      字符串拼接 ~609ms + 全表重排 ~212ms；表宽 5428px，Chromium 需重绘整层瓦片，
//      重绘期间容器背景 #fff 露出来 → 用户看到"白一下"。
//   ② fake.outerHTML = fh 只为改 12 个标签（RMB/USD/VND/Equip/Install/Both）就把整行
//      position:sticky 的 48 个 <td> 删掉重插 → 341ms 全表重排，且该行无粘性表头覆盖，
//      容器背景直接露白。
//
// 方案（与 updateCrmTheadTextOnly 完全同构）：用【同一套渲染函数】在游离节点里生成
//   "期望内容"（不参与布局/绘制，零重排），再逐节点把文本/属性搬到现有 DOM 上，
//   单元格节点本身不销毁 → 无重排、无整层重绘、无白闪，滚动位置也保持不变。
// ★ 不复制任何渲染逻辑（省份/币种/PDF/按钮文案全部仍由 renderCrmData 决定），
//   因此不可能与整体重建的显示结果产生分歧。
// 回退：行数/列数/子节点结构对不上（空态行、数据增删、历史脏 DOM）→ 返回 false，
//   调用方退回原来的整体重建，行为与旧版逐字节一致（安全网，不是主路径）。
// ==================================================================
var CRM_PATCH_ATTRS = ['class', 'style', 'colspan', 'data-col', 'href', 'target', 'download', 'onclick', 'title'];

function _crmParseFragment(html) {
  // template 内容为惰性文档片段：解析 tr/td 不会被 foster-parenting 打散，也不触发布局/绘制
  var tpl = document.createElement('template');
  if (tpl.content) {
    tpl.innerHTML = html;
    return tpl.content;
  }
  var tb = document.createElement('table');   // 极端兜底（无 template 支持）
  tb.innerHTML = html;
  return tb;
}

function _crmPatchSyncAttrs(oldEl, newEl) {
  // class 以新生成的为准，但【保留】运行时才有的 col-hidden：
  // 列折叠类不在渲染 HTML 里，由 syncCrmColVisibility 维护，抹掉会让隐藏列闪一下再被隐藏。
  var keepHidden = oldEl.classList && oldEl.classList.contains('col-hidden') &&
                   !newEl.classList.contains('col-hidden');
  for (var i = 0; i < CRM_PATCH_ATTRS.length; i++) {
    var name = CRM_PATCH_ATTRS[i];
    var nv = newEl.getAttribute(name);
    var ov = oldEl.getAttribute(name);
    if (nv === ov) continue;
    if (nv === null) oldEl.removeAttribute(name);
    else oldEl.setAttribute(name, nv);
  }
  if (keepHidden) oldEl.classList.add('col-hidden');
}

// 逐节点把 newN 的文本/属性搬到 oldN 上；结构不一致返回 false（调用方整体重建）
function _crmPatchTree(oldN, newN) {
  if (!oldN || !newN) return false;
  if (oldN.nodeType !== newN.nodeType) return false;
  if (oldN.nodeType === 3) {                     // 文本节点：只改值
    if (oldN.nodeValue !== newN.nodeValue) oldN.nodeValue = newN.nodeValue;
    return true;
  }
  if (oldN.nodeType !== 1) return true;          // 注释等：无需处理
  _crmPatchSyncAttrs(oldN, newN);
  var oc = oldN.childNodes, nc = newN.childNodes;
  var oHasEl = false, nHasEl = false, i;
  for (i = 0; i < oc.length; i++) { if (oc[i].nodeType === 1) { oHasEl = true; break; } }
  for (i = 0; i < nc.length; i++) { if (nc[i].nodeType === 1) { nHasEl = true; break; } }
  // 纯文本元素（td/span/a/button 内无嵌套元素）：优先【原地改文本节点 nodeValue】，
  // 不销毁重建文本节点（textContent= 会删旧节点+插新节点，等于一次 DOM 结构变更）；
  // 只有节点形态不规整时才退回 textContent 赋值。
  if (!oHasEl && !nHasEl) {
    var oTxt = oldN.textContent, nTxt = newN.textContent;
    if (oTxt !== nTxt) {
      var only = (oldN.childNodes.length === 1) ? oldN.firstChild : null;
      if (only && only.nodeType === 3) only.nodeValue = nTxt;
      else oldN.textContent = nTxt;
    }
    return true;
  }
  if (oHasEl !== nHasEl || oc.length !== nc.length) return false;
  for (i = 0; i < oc.length; i++) {
    if (!_crmPatchTree(oc[i], nc[i])) return false;
  }
  return true;
}

// 返回 true = 已原地更新（DOM 未销毁）；false = 需调用方退回 innerHTML 整体重建
function patchCrmTbodyTextOnly(list) {
  var tb = document.getElementById('crmTbody');
  if (!tb || typeof renderCrmData !== 'function') return false;
  var oldRows = tb.querySelectorAll('tr');
  if (!oldRows.length) return false;                 // 首次渲染/空 tbody → 整体重建
  var _t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  var frag = _crmParseFragment(renderCrmData(list)); // 调用真实渲染函数 → 渲染语言戳/列同步钩子照常生效
  var newRows = frag.querySelectorAll('tr');
  if (oldRows.length !== newRows.length) return false;   // 行数变化（数据增删/空态行）
  for (var r = 0; r < oldRows.length; r++) {
    var o = oldRows[r], n = newRows[r];
    if (o.tagName !== n.tagName) return false;
    if (o.children.length !== n.children.length) return false;   // 单元格数量不一致
    if (!_crmPatchTree(o, n)) return false;
  }
  var _t1 = (window.performance && performance.now) ? performance.now() : Date.now();
  try { window.__crmTbPatch = { mode: 'patch', rows: oldRows.length, ms: Math.round((_t1 - _t0) * 10) / 10 }; } catch (e) {}
  return true;
}

// 二级假表头行：只改标签文字，整行 DOM（含 sticky 定位/排序箭头/列宽/折叠状态）原样保留
// ★ HEAD-LOCK-20261030：不再以"子节点数量必须一致"为前提——数量对不上时按 data-col 逐格
//   原地搬文字，绝不整行 outerHTML 重建（重建会瞬间抽掉 sticky 行，用户看到表头闪一下）。
function patchCrmFakeHeaderRowTextOnly() {
  var tb = document.getElementById('crmTbody');
  if (!tb || typeof renderCrmFakeSubHeaderRow !== 'function') return false;
  var fake = tb.querySelector('tr.fake-header-row');
  if (!fake) return false;                              // 无该行 → 交给调用方插入（无任何销毁）
  var frag = _crmParseFragment(renderCrmFakeSubHeaderRow());
  var nrow = frag.querySelector('tr.fake-header-row');
  if (!nrow) return false;
  var olds = {};
  Array.prototype.forEach.call(fake.children, function(td){ olds[td.getAttribute('data-col')] = td; });
  Array.prototype.forEach.call(nrow.children, function(ntd){
    var old = olds[ntd.getAttribute('data-col')];
    if (!old) return;
    // 逐节点搬文字与属性；class 里运行时才有的 col-hidden 由 _crmPatchSyncAttrs 保留
    _crmPatchTree(old, ntd);
  });
  return true;
}

// ==================================================================
// ★ HEAD-LOCK-20261030（二）：tbody 整体重建时【复用二级表头行节点】
//   诊断窗里 rebuild=fake-row 的含义 = tr.fake-header-row 被删掉重建，
//   该 sticky 行瞬间消失 → 用户看到二级表头闪一下/跳一下。
//   这里在 innerHTML 之前先把旧节点摘出来，重建后原样放回（节点身份不变，
//   ::sticky / 行高 / 列宽全部沿用），再把文字按当前语言补一遍。
//   ★ 所有"用字符串整体重排表格"的地方都必须走这里，不要直接 tb.innerHTML=。
// ==================================================================
function _crmSetTbodyHtml(html) {
  var tb = document.getElementById('crmTbody');
  if (!tb) return;
  var oldFake = tb.querySelector('tr.fake-header-row');
  tb.innerHTML = html;
  if (!oldFake) return;
  var newFake = tb.querySelector('tr.fake-header-row');
  if (!newFake) { tb.insertBefore(oldFake, tb.firstChild); return; }
  if (newFake !== oldFake) {
    newFake.parentNode.replaceChild(oldFake, newFake);
    if (typeof patchCrmFakeHeaderRowTextOnly === 'function') patchCrmFakeHeaderRowTextOnly();
  }
}

// ⛔⛔⛔ 锁死声明（V2026.09.07）：CRM 切语言/表头/数据行渲染历经多次回归修复才稳定，
// 任何"优化/重构/简化"必须先取得用户明确同意，禁止私自改动！
// ★ 例外记录：2026-10-29 用户明确同意「白闪治理」——只把 tbody / 假表头行的更新方式
//   从"销毁重建"改成"文本级补丁"（上面的 patchCrmTbodyTextOnly / patchCrmFakeHeaderRowTextOnly），
//   所有门控条件、语言戳守卫、备注补翻、权限兜底一律保留；
//   ⛔ 不得把这两处改回 innerHTML / outerHTML 作为主路径（补丁失败时的回退分支除外）。
function applyCrmLang() {
  var t = T();
  // 更新潜在项目页标题与"+ New CRM / 导出 Excel"按钮（三语跟随系统语言）
  var crmTitleEl = document.getElementById('crmTitle');
  var btnAddCrm = document.getElementById('btnAddCrm');
  var btnCrmOverview = document.getElementById('btnCrmOverview');
  var btnExportCrmExcel = document.getElementById('btnExportCrmExcel');
  // ★ 每一步独立 try/catch（V36）：任何一步抛异常都不得阻断后续步骤，
  //   尤其不能阻断末尾的【数据行语言守卫】。曾出现"表头已切新语言、数据行不刷新"
  //   ——正是中途某步异常导致守卫从未执行（表头在异常前已更新完毕）。
  try {
    if (crmTitleEl) crmTitleEl.innerText = t.crmTitle;
    if (btnAddCrm) btnAddCrm.innerText = t.btnAddCrm;
    if (btnCrmOverview) btnCrmOverview.innerText = t.btnCrmOverview;
    if (btnExportCrmExcel) btnExportCrmExcel.innerText = t.btnExportCrmExcel;
  } catch (e) { console.warn('[crm-lang] title/buttons step failed:', e); }
  var th = document.getElementById('crmThead');
  var tb = document.getElementById('crmTbody');

  // ★ WON 模式：绝不重建 colgroup/thead 结构，只做文本级更新
  try { updateCrmTheadTextOnly(); } catch (e) { console.warn('[crm-lang] thead step failed:', e); }
  try { updateCrmCollapsedBar(); } catch (e) { console.warn('[crm-lang] collapsed bar step failed:', e); }

  // ==================================================================
  // ⛔⛔⛔ 已锁定实现 —— V2026.09.03.39 / PERM_BUILD Z58 用户验证通过
  //    【禁止】加回 visible 门控；【禁止】删除 !hasCache 重取数兜底
  //    动此段前必须取得用户明确同意。
  //    （完整的根因链条见 index.html loadDashboard 内 V39 锁定说明）
  // ==================================================================
  // var visible 仅为诊断日志保留，【不得】用于门控数据行重渲染。
  var sec = document.getElementById('view-crm');
  var visible = sec && sec.classList.contains('active');
  var hasCache = (typeof globalCrmData !== 'undefined' && globalCrmData && globalCrmData.length);
  console.warn('[crm-lang] visible=' + !!visible + ' hasCache=' + !!hasCache + ' lang=' + CUR_LANG);
  //
  // 历史：V38 回归修复（用户定位：9/1 与 8 月底版本本功能完全正常，是后期改动丢失的）
  //   数据行按当前语言重渲染 —— 恢复旧版的无条件渲染行为。
  // 旧版（见 electron/dist/crm_table.js 的 applyCrmLang）：
  //     if (tb) tb.innerHTML = renderCrmData(globalCrmData || []);
  //   → 无条件重渲染 tbody，语言切换 100% 跟随。
  // V21（"100% 复制 WON 模式"重构）改为 visible + hasCache 双重门控：
  //   → visible 或 hasCache 任一不成立，数据行【完全不重渲染】
  //   → 省份/BU/备注/建设情况停留旧语言（回归 bug，三浏览器 + 无痕复现）。
  // 本修复：去掉 visible 门控（不可见时重渲染仅一次 30~80ms，换取确定性）；
  //   保留 hasCache 保护（未加载数据不清空白板，沿用 V18 白板修复）；
  //   不再打 _viewLangStale 轻标。
  //
  // V39 补充：!hasCache 且 DOM 有数据行时（globalCrmData 被外部清空），
  //   【绝不能】renderCrmData([])（会白板）→ 防抖重取数 loadCrm() 按新语言渲染。
  try {
    if (tb && hasCache) {
      // ★ CRM-PATCH-TBODY-20261029：先走【文本级补丁】（2880 个单元格不销毁 → 无白闪）；
      //   结构对不上（行数/列数变化、空态行、历史脏 DOM）才退回整体重建。
      if (!patchCrmTbodyTextOnly(globalCrmData)) {
        _crmSetTbodyHtml(renderCrmData(globalCrmData)); // 包装器自动 setTimeout(syncCrmColVisibility)
      }
      if (typeof applyCrmRowPerms === 'function') applyCrmRowPerms();
      _crmFillMissingRemarks(tb);
    } else if (tb && !hasCache) {
      // 缓存为空但 DOM 里还有数据行（globalCrmData 被外部清空，见 V39 说明）→
      // 此时【绝不能】renderCrmData([])（会白板），必须重新取数才能按新语言渲染。
      var _hasRows = tb.querySelectorAll('tr.won-data-row').length > 0;
      if (_hasRows && typeof loadCrm === 'function' && !window.__crmLangRefetching) {
        window.__crmLangRefetching = true;
        setTimeout(function(){ window.__crmLangRefetching = false; }, 3000);
        console.warn('[crm-lang] cache empty but rows present -> reload data for new lang');
        loadCrm();
      }
    }
  } catch (e) { console.warn('[crm-lang] rows re-render step failed:', e); }

  // ==================================================================
  // ⛔ 已锁定实现 —— 用户于 V2026.09.03.34 / PERM_BUILD Z53 验证通过，禁止修改
  //    （若要动此段，必须先取得用户明确同意；任何"优化/简化/重构"都在此禁用）
  //
  // ★ 假表头行语言守卫（无条件兜底）：二级假表头行（tbody 首行 tr.fake-header-row）
  //   的 PDF 三子列等标签由 renderCrmFakeSubHeaderRow 按当前语言生成。正常路径下
  //   visible+hasCache 分支整体重渲染 tbody 时它会随语言更新；但任何其他路径
  //   （无缓存/未重建/竞态）都会让它残留旧语言 → 一级表头已是新语言、二级还是旧语言
  //   的"错位"（用户截图 exactly 这个形态）。此处无条件按当前语言重盖这一行，
  //   数据行零影响；内容已一致时跳过 DOM 操作。
  //
  //   为什么必须【无条件】放在分支之外：
  //   二级假表头行不在 thead 内，不被 updateCrmTheadTextOnly 的文本级更新覆盖，
  //   唯一的常规更新途径就是"tbody 整体重渲染"。凡是会跳过整体重渲染的条件
  //   （hasCache 为空、时序竞态、外部直接调 applyCrmLang）都必须由这里兜住。
  //   曾因缺少此守卫出现"一级新语言 / 二级旧语言"的错位（V34 修复，已验证）。
  // ==================================================================
  try {
    if (tb && typeof renderCrmFakeSubHeaderRow === 'function') {
      var fake = tb.querySelector('tr.fake-header-row');
      if (fake) {
        // ★ HEAD-LOCK-20261030：二级表头与一级表头同一规则——【只改文字，绝不重建】。
        //   整行 DOM（sticky 定位 / 列宽 / 排序箭头 / 折叠状态）原样保留，
        //   已删除 outerHTML 重建分支（曾造成切语言时该粘性行瞬间消失 → 白闪）。
        patchCrmFakeHeaderRowTextOnly();
      }
    }
  } catch (e) { console.warn('[crm-lang] fake-header-row guard failed:', e); }

  // ==================================================================
  // ⛔ 数据行语言一致性守卫（无条件兜底）——V35 新增，根治"省份/BU/备注切语言
  //    不即时更新、需刷新或切标签才恢复"的问题
  // ==================================================================
  // 原理：数据列显示文本由【渲染时刻】的 CUR_LANG 决定。正常路径 visible+hasCache
  // 分支整体重渲染 tbody；但用户实测出现"表头已切新语言、数据行仍是旧语言 DOM"
  // 的残留（需刷新网页或切标签再回来才恢复）——说明某些真实环境下该分支未生效。
  // 本守卫用第一个"省份/BU 非空"的数据行做语言指纹校验：DOM 文本 ≠ 当前语言
  // 预期渲染值 → 强制整体重渲染；刚渲染过则指纹一致，零开销跳过。
  // 省份/BU 是确定性映射（provinceDisplay/buDisplay），最适合做指纹；
  // 备注/失败原因/其余所有列随同一次 innerHTML 重渲染一并刷新。
  // 判断依据【渲染语言戳】（V36 升级，替代 V35 的 DOM 文本指纹）：
  // tbody 当前 HTML 是 __crmRenderLang 时渲染的，若它与 CUR_LANG 不同 → 数据列
  // （省份/BU/备注/建设情况…全部随语言变化的列）必然是旧语言 → 强制整体重渲染。
  // 比指纹方案更稳：不依赖 data-col 索引、不依赖行序与数据序一致、不依赖
  // provinceDisplay 的返回值形态（V35 指纹方案在用户环境失效，故升级为确定性判断）。
  try {
    if (tb && hasCache && typeof renderCrmData === 'function') {
      var _renderLang = window.__crmRenderLang;
      if (_renderLang !== undefined && _renderLang !== CUR_LANG) {
        console.warn('[crm-lang] data rows stale (rendered in ' + _renderLang + ', now ' + CUR_LANG + ') -> force re-render');
        // ★ 同样先走文本级补丁，补丁失败才整体重建（CRM-PATCH-TBODY-20261029）
        if (!patchCrmTbodyTextOnly(globalCrmData)) {
          _crmSetTbodyHtml(renderCrmData(globalCrmData));
        }
        if (typeof applyCrmRowPerms === 'function') applyCrmRowPerms();
        _crmFillMissingRemarks(tb);
      }
    }
  } catch (e) { console.warn('[crm-lang] data rows lang guard failed:', e); }

  // 模态框打开时，立即按当前语言刷新表单（保留已输入值）
  if (typeof refreshCrmModalLang === 'function') refreshCrmModalLang(t);
  // 报告打开时，按当前语言刷新报告
  if (CRM_REPORT_ROW && typeof refreshCrmReport === 'function') refreshCrmReport();
}

// ==================== CRUD ====================
// openCrmModal / closeCrmModal / saveCrm 在 index.html 中实现（新建与编辑共用二级模态框）。
// 此处不再覆盖，仅保留 deleteCrm 与导出逻辑。

// 删除 CRM 项目：按决策分流（与转到失败项目一致）
//   保留默认/特别授权 → 普通确认框（无红字）→ 直接删除，无需审批
//   发起审批 → 确认框带红字「单次生效」→ 提交单次审批，审批人通过后由轮询自动删除
function deleteCrm(id) {
  var t = T();
  var dec = (typeof normDecision === 'function' && typeof curRawDecision === 'function') ? normDecision(curRawDecision('CRM-D3')) : 'def';
  var isApprove = (dec === 'approve');
  showCrmOrangeConfirm((t.crm_del_title || 'Confirm Delete'), (t.crm_del_msg || 'Delete this potential project?'), function() {
    if (isApprove) {
      var sentMsg = (t.user_single_use_sent || 'Single-use approval request sent. Please wait for the approver to confirm.');
      if (typeof singleUseGuard === 'function') {
        singleUseGuard('CRM-D3', String(id), t.crm_del_action || '删除CRM项目', function() {
          fetchDeleteCrm(id, t);   // 审批通过后自动执行
        }, null, { onSent: function() { showAlert(sentMsg); } });
      }
    } else {
      // hide 决策兜底拦截（正常情况下按钮已隐藏）
      if (typeof permVisible === 'function' && !permVisible('CRM-D3')) {
        showToast(t.user_perm_hidden || 'No permission: this module is hidden');
        return;
      }
      fetchDeleteCrm(id, t);
    }
  }, isApprove ? { persist: 'single-use' } : {});
}

// 执行真正的删除接口调用
function fetchDeleteCrm(id, t){
  t = t || T();
  fetch(crmApiBase() + '/api/crm-projects/' + id, {
    method:'DELETE', credentials:'include', headers:(typeof authHeaders==='function'?authHeaders({'Content-Type':'application/json'}):{'Content-Type':'application/json'})
  })
  .then(function(r){ return r.json(); })
  .then(function(res) {
    if (res && (res.ok || res.status === 'ok')) {
      showSaveOk(t.crm_del_ok || 'Deleted');
      loadCrm();
    } else {
      showAlert('Error: ' + ((res && res.message) || 'Failed'));
    }
  })
  .catch(function() { showAlert('Network error'); });
}

// 查看：生成报告
function viewCrm(id) {
  if (typeof permGuard === 'function' && !permGuard('CRM-D1')) return;
  openCrmReport(id);
}

// 移动到失败项目：打开失败原因弹窗
var _mtlPendingId = null;
function moveCrmToFailed(id) {
  // 入口先按「转到失败项目 CRM-F1」拦截隐藏决策（按钮本身已被隐藏，此处防其它路径进入）；
  // approve 决策放行到确认回调，由 singleUseGuard 走单次审批
  if (typeof permVisible === 'function' && !permVisible('CRM-F1')) {
    try {
      var _tt = (typeof T === 'function') ? T() : {};
      showToast(_tt.usr_perm_no_right || 'No permission: this item is not open to you');
    } catch (e) {}
    return;
  }
  _mtlPendingId = id;
  _bindMtlEvents();   // 兜底：确保按钮事件已绑定（本文件为动态注入加载，见下方说明）
  var t = T();
  var modal = document.getElementById('crmMoveToLostModal');
  if (!modal) return;
  document.getElementById('crmMtlTitle').textContent = t.crm_fail_reason_title || '选择失败原因';
  document.getElementById('crmMtlSub').textContent = t.crm_fail_reason_subtitle || '请选择此项目失败的原因';
  document.getElementById('crmMtlLabel').textContent = t.crm_fail_reason_label || '失败原因';
  document.getElementById('crmMtlCancel').textContent = t.btnCancel || t.ecCancel || '取消';
  document.getElementById('crmMtlOk').textContent = t.btnConfirm || t.ecConfirm || '确认';
  var sel = document.getElementById('crmMtlSel');
  sel.options.length = 1; // keep placeholder
  // 占位符三语（HTML 中硬编码的中文会被这里覆盖）
  if (sel.options[0]) sel.options[0].text = t.crm_fail_reason_placeholder || '-- 选择失败原因 --';
  var keys = ['fr_price_high','fr_quality','fr_relationship','fr_design','fr_cancel','fr_other'];
  var curLang = (typeof CUR_LANG !== 'undefined') ? CUR_LANG : 'zh';
  for (var i = 0; i < keys.length; i++) {
    var raw = t[keys[i]] || '';
    var parts = raw.split('\n');
    var label = (curLang === 'vi' && parts[1]) ? parts[1] : (curLang === 'en' && parts[2]) ? parts[2] : parts[0];
    // value 用稳定 key（无换行），避免 HTML option value 含 \n 导致 sel.value 为空、确认按钮锁死
    var opt = new Option(label, keys[i]);
    opt.dataset.full = raw;
    opt.dataset.key = keys[i];
    sel.add(opt);
  }
  sel.value = '';
  document.getElementById('crmMtlOk').disabled = true;
  modal.classList.add('on');
}

function _mtlCheckValid() {
  var sel = document.getElementById('crmMtlSel');
  var btn = document.getElementById('crmMtlOk');
  btn.disabled = !sel.value;
}

// 关键修复：本文件由 index.html 的 loadExternalScripts() 动态注入加载（append script），
// 动态脚本是异步执行——DOMContentLoaded 在本文件执行前就已触发完毕。
// 因此监听 DOMContentLoaded 的回调永远不会执行，导致"取消/确认"按钮事件从未绑定，
// 表现为弹窗按钮全部锁死（确认永远灰、取消点了没反应）。
// 改为：readyState 兜底立即绑定 + 防重复绑定标志。
function _bindMtlEvents() {
  if (window.__mtlBound) return;
  var selEl = document.getElementById('crmMtlSel');
  var cancelBtn = document.getElementById('crmMtlCancel');
  var okBtn = document.getElementById('crmMtlOk');
  if (!selEl || !cancelBtn || !okBtn) return;   // 元素未就绪，等下次调用
  window.__mtlBound = true;
  selEl.addEventListener('change', _mtlCheckValid);
  cancelBtn.addEventListener('click', function() {
    document.getElementById('crmMoveToLostModal').classList.remove('on');
    _mtlPendingId = null;
  });
  okBtn.addEventListener('click', function() {
    var t = T();
    var sel = document.getElementById('crmMtlSel');
    if (!sel.value) return;
    var id = _mtlPendingId;
    // sel.value 现在是稳定 key；提交时还原为完整三语文本，保持 lost_projects 数据格式
    var fail_reason = (t[sel.value] || sel.value);
    // 按决策分流：approve=发起审批（红字单次提示）；保留默认/特别授权=直接执行（无红字）
    var dec = (typeof normDecision === 'function' && typeof curRawDecision === 'function') ? normDecision(curRawDecision('CRM-F1')) : 'def';
    var isApprove = (dec === 'approve');
    showCrmOrangeConfirm(t.crm_failed_title || 'Move to Failed', (t.crm_failed_msg || 'Move this project to failed?'), function() {
      document.getElementById('crmMoveToLostModal').classList.remove('on');
      _mtlPendingId = null;
      if (isApprove) {
        // 发起审批：提交成功 → 弹橙色三语对话框（含「单次生效」说明）；
        // tom 通过后由轮询自动执行转移，拒绝则提示「申请已被拒绝」
        var sentMsg = (t.crm_transfer_apply_sent || '申请转移至失败项目已经发送，请等待审批！') + '\n' + (t.confirm_single_use || '本次申请为单次生效，下次相同操作仍需重新申请！');
        if (typeof singleUseGuard === 'function') {
          singleUseGuard('CRM-F1', String(id), t.crm_failed_action || '转到失败项目', function() {
            fetchMoveFailed(id, fail_reason, t);   // 审批通过后自动执行
          }, null, { onSent: function() { showAlert(sentMsg); } });
        }
      } else {
        // 保留默认 / 特别授权：直接执行转移（hide 决策兜底拦截）
        if (typeof permVisible === 'function' && !permVisible('CRM-F1')) {
          showToast(t.user_perm_hidden || 'No permission: this module is hidden');
          return;
        }
        fetchMoveFailed(id, fail_reason, t);
      }
    }, isApprove ? { persist: 'single-use' } : {});
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bindMtlEvents);
} else {
  _bindMtlEvents();   // 动态注入加载时 DOM 已就绪，立即绑定
}

// 执行真正的"转到失败项目"接口调用
function fetchMoveFailed(id, fail_reason, t){
  t = t || T();
  fetch(crmApiBase() + '/api/crm-projects/' + id + '/failed', {
    method:'POST', credentials:'include', headers:(typeof authHeaders==='function'?authHeaders({'Content-Type':'application/json'}):{'Content-Type':'application/json'}),
    body: JSON.stringify({fail_reason: fail_reason})
  })
  .then(function(r){ return r.json(); })
  .then(function(res) {
    if (res && (res.ok || res.status === 'ok')) {
      showSaveOk(t.crm_failed_ok || 'Moved to Failed');
      loadCrm();
    } else {
      showAlert('Error: ' + ((res && res.message) || 'Failed'));
    }
  })
  .catch(function() { showAlert('Network error'); });
}

// ==================== Excel导出 ====================
function exportCrmToExcel() {
  if (typeof permGuard === 'function' && !permGuard('CRM-E1')) return;
  var t = T();
  if (!globalCrmData || globalCrmData.length === 0) { (window.showAlert||alert)(t.noData); return; }
  window.__exportCtx = 'crm';
  openExportConfirm();
}

// 构建潜在项目 Excel 数据（确认后调用）
function buildCrmExcelData() {
  var t = T();
  var rows = [['#', t.crm_quote_no, t.crm_project_name, t.crm_province, t.crm_customer, t.crm_bu,
    t.crm_manager, t.crm_manager_phone, t.crm_construction, t.crm_startup_pct, t.crm_sign_pct,
    t.crm_initial_quote_date, t.crm_est_purchase_date, t.crm_est_ship_date, t.crm_quote_version, t.crm_last_quote_date,
    t.crm_rate_rmb_vnd, t.crm_rate_usd_vnd, t.crm_incoterm,
    'Q1 RMB','Q1 USD','Q1 VND','Q2 RMB','Q2 USD','Q2 VND','Q3 RMB','Q3 USD','Q3 VND',
    'Q4 RMB','Q4 USD','Q4 VND','Q5 RMB','Q5 USD','Q5 VND','Q6 RMB','Q6 USD','Q6 VND',
    'Q7 RMB','Q7 USD','Q7 VND', t.crm_install_quoted,
    t.crm_pdf_equip, t.crm_pdf_install, t.crm_pdf_both,
    t.crm_salesperson, t.crm_remark]];
  globalCrmData.forEach(function(p, i) {
    rows.push([
      i+1, p.quote_no, p.project_name, p.province, p.customer, p.bu,
      p.manager, p.manager_phone, constructionDisplay(p.construction), p.startup_pct, p.sign_pct,
      p.initial_quote_date, p.est_purchase_date, p.est_ship_date, p.quote_version, p.last_quote_date,
      p.rate_rmb_vnd, p.rate_usd_vnd, p.incoterm,
      p.q1_rmb,p.q1_usd,p.q1_vnd,p.q2_rmb,p.q2_usd,p.q2_vnd,p.q3_rmb,p.q3_usd,p.q3_vnd,
      p.q4_rmb,p.q4_usd,p.q4_vnd,p.q5_rmb,p.q5_usd,p.q5_vnd,p.q6_rmb,p.q6_usd,p.q6_vnd,
      p.q7_rmb,p.q7_usd,p.q7_vnd,
      p.install_quoted,
      p.pdf_equip||'',p.pdf_install||'',p.pdf_both||'',
      p.salesperson,p.remark
    ]);
  });
  return rows;
}

// ==================== CRM 十字高亮逻辑（与 WON 表一致） ====================
function bindCrmCrossHighlight(){
  var tbody = document.getElementById('crmTbody'); if(!tbody) return;
  if (window.__crmCrossBound) return;
  window.__crmCrossBound = true;
  tbody.addEventListener('mouseover', onCrmCrossOver);
  tbody.addEventListener('mouseout', onCrmCrossOut);
  // 悬浮显示 Q1-Q7 各币种列总和（自定义气泡，与 WON 表一致）
  tbody.addEventListener('mouseover', onCrmSumOver);
  tbody.addEventListener('mouseout', onCrmSumOut);
}

// ==================== CRM 报价列求和悬浮气泡（Q1-Q7 × RMB/USD/VND） ====================
var __crmSumTip = null;
function onCrmSumOver(e){
  var td = e.target.closest('td');
  if(!td) return;
  var tr = td.closest('tr');
  if(!tr || !tr.classList.contains('fake-header-row')) { hideCrmSumTip(); return; }
  // 仅 Q1-Q7 的 RMB/USD/VND 子表头 (data-col 20-40) 触发
  var colIdx = parseInt(td.dataset.col, 10);
  if (isNaN(colIdx) || colIdx < 20 || colIdx > 40) { hideCrmSumTip(); return; }
  var q = Math.floor((colIdx - 20) / 3) + 1;           // 1..7
  var kind = (colIdx - 20) % 3;                         // 0=rmb,1=usd,2=vnd
  var key = 'q'+q+'_'+['rmb','usd','vnd'][kind];

  var sum = 0;
  (globalCrmData || []).forEach(function(row){
    sum += moneyToNumber(row ? row[key] : 0);
  });

  var t = T();
  var sumLabel = (t && t['crm_sum_q'+q]) ? t['crm_sum_q'+q] : ('Q'+q+' Total');
  var sym = (kind===0 ? '¥' : (kind===1 ? '$' : '₫'));

  hideCrmSumTip();
  var tip = document.createElement('div');
  tip.className = 'won-sum-tooltip';
  tip.textContent = sumLabel + ': ' + sym + ' ' + sum.toLocaleString('en-US');
  document.body.appendChild(tip);
  __crmSumTip = tip;

  var rect = td.getBoundingClientRect();
  var left = rect.right + 6;
  var top = rect.top + (rect.height / 2);
  if (left + 160 > window.innerWidth) left = rect.left - tip.offsetWidth - 6;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function onCrmSumOut(e){
  var td = e.target.closest('td');
  if(!td){ hideCrmSumTip(); return; }
  hideCrmSumTip();
}
function hideCrmSumTip(){
  if(__crmSumTip){ __crmSumTip.remove(); __crmSumTip = null; }
}

function onCrmCrossOver(e){
  var td = e.target.closest('td');
  if(!td) return;
  var tr = td.closest('tr');
  if(!tr) return;

  if(tr.classList.contains('fake-header-row')) {
    clearCrmCross();
    return;
  }
  if(tr.closest('thead')){
    clearCrmCross();
    return;
  }

  var col=td.dataset.col; if(col===undefined) return;
  tr.querySelectorAll('td').forEach(function(c){ c.classList.add('row-hl'); });
  document.querySelectorAll('#crmTbody td[data-col="' + col + '"]').forEach(function(c){
    if(c.closest('tr.fake-header-row')) return;
    c.classList.add('col-hl');
    if(c.closest('tr')===tr) c.classList.add('cross-hl');
  });
}

function onCrmCrossOut(e){
  var td=e.target.closest('td'); if(!td) return;
  var tr=td.closest('tr'); if(!tr || tr.classList.contains('fake-header-row')) return;
  var col=td.dataset.col; if(col===undefined) return;
  tr.querySelectorAll('td').forEach(function(c){ c.classList.remove('row-hl'); });
  document.querySelectorAll('#crmTbody td[data-col="' + col + '"]').forEach(function(c){
    c.classList.remove('col-hl','cross-hl');
  });
}

function clearCrmCross(){
  document.querySelectorAll('#crmTbody td.row-hl,#crmTbody td.col-hl,#crmTbody td.cross-hl')
    .forEach(function(c){ c.classList.remove('row-hl','col-hl','cross-hl'); });
}

// ==================== 潜在项目报告 (Report) ====================
var CRM_REPORT_CUR = 'RMB';   // 当前报告币种 RMB / USD / VND
var CRM_REPORT_ROW = null;    // 当前报告数据对象
var CRM_REPORT_CHARTS = [];   // 已创建的图表，便于销毁

// 找到对应潜在项目数据
function findCrmRow(id) {
  var list = (typeof globalCrmData !== 'undefined') ? globalCrmData : [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(id)) return list[i];
  }
  return null;
}

// 生成报告入口
function openCrmReport(id) {
  var t = T();
  var row = findCrmRow(id);
  if (!row) { (window.showAlert||alert)((t.crm_not_found) || 'Project not found'); return; }
  CRM_REPORT_ROW = row;
  CRM_REPORT_CUR = 'RMB';
  var modal = el('crmReportModal');
  if (!modal) return;
  modal.style.display = 'flex';
  el('crmReportTitle').innerText = t.crm_report_title || 'Project Report';
  var sub = el('crmReportSub');
  sub.innerText = (row.project_name || '') + ' — ' + (row.quote_no || '');
  el('crmReportCurLabel').innerText = (t.crm_report_currency || 'Currency');
  el('crmReportBtnClose').innerText = t.crm_report_close || 'Close';
  el('crmReportBtnExport').innerText = '🖨 ' + (t.btn_print || '打印');
  _crmReportRender();
  _ovLoadChartLib(function(){ _crmReportCharts(); });
}

// 关闭报告并销毁图表
function closeCrmReport() {
  var modal = el('crmReportModal');
  if (modal) modal.style.display = 'none';
  CRM_REPORT_ROW = null;
  for (var i = 0; i < CRM_REPORT_CHARTS.length; i++) {
    if (CRM_REPORT_CHARTS[i]) CRM_REPORT_CHARTS[i].destroy();
  }
  CRM_REPORT_CHARTS = [];
}

// 打印报告（与「客户付款智能报告」一致：直接调系统打印，不再走 html2canvas + jsPDF 导出）
// ⚠️ index.html 内联脚本里也有同名函数，但【本文件是后加载的外部脚本，会覆盖内联定义】，
//    所以这一份才是真正生效的实现——两处必须保持同一行为，改一处要同步改另一处。
function exportCrmReportPDF(){
  if (typeof printModalById === 'function') printModalById('crmReportModal');
  else window.print();
}

// ↓ 旧版 html2canvas + jsPDF 导出实现：已停用，改名后无任何调用方（保留作历史参考）
function _legacyExportCrmReportPDF(){
  var t=T();
  var body=document.getElementById('crmReportBody');
  var btn=document.getElementById('crmReportBtnExport');
  if(!body){ showAlert(t.crm_report_pdf_failed||'PDF export failed'); return; }
  if(btn) btn.disabled=true;

  // 获取 jsPDF（兼容 2.x 和 1.x）
  function getJsPDF(){
    if(typeof jsPDF!=='undefined') return jsPDF;
    if(typeof window.jspdf!=='undefined' && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    return null;
  }

  function doExport(){
    var pdfClass=getJsPDF();
    if(!pdfClass){ showAlert(t.crm_report_pdf_load_err||'PDF library failed to load.'); if(btn) btn.disabled=false; return; }
    var titleText=document.getElementById('crmReportTitle').innerText||'Project Report';

    // 临时移除高度限制，让内容完全展开
    var origBodyOverflow=body.style.overflow;
    var origBodyMaxH=body.style.maxHeight;
    var origBodyH=body.style.height;
    body.scrollTop=0;
    body.style.overflow='visible';
    body.style.maxHeight='none';
    body.style.height='auto';

    setTimeout(function(){
      html2canvas(body,{ scale:1, useCORS:true, backgroundColor:'#fff' }).then(function(canvas){
        body.style.overflow=origBodyOverflow;
        body.style.maxHeight=origBodyMaxH;
        body.style.height=origBodyH;
        var pageW=210, pageH=297;
        var imgData=canvas.toDataURL('image/png');
        var imgW=canvas.width, imgH=canvas.height;
        var availH=pageH-20, availW=pageW-20;
        var ratio=Math.min(availW/(imgW/2), availH/(imgH/2));
        var scaledW=imgW*ratio/2, scaledH=imgH*ratio/2;
        var pdf=new pdfClass({orientation:'portrait',unit:'mm',format:'a4'});
        var pageCount=Math.ceil(scaledH/availH);
        for(var i=0;i<pageCount;i++){
          if(i>0) pdf.addPage();
          pdf.addImage(imgData,'PNG',10,-i*availH,scaledW,scaledH);
        }
        pdf.save(titleText.replace(/[^\w\u4e00-\u9fa5]/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.pdf');
        if(btn) btn.disabled=false;
        showAlert(t.crm_report_pdf_success||'Export successful!');
      }).catch(function(e){
        body.style.overflow=origBodyOverflow;
        body.style.maxHeight=origBodyMaxH;
        body.style.height=origBodyH;
        showAlert((t.crm_report_pdf_failed||'PDF export failed: ')+e.message);
        if(btn) btn.disabled=false;
      });
    },100);
  }

  if(typeof html2canvas!=='undefined'&&getJsPDF()){
    doExport();
  } else {
    var scripts=[
      {src:'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', name:'html2canvas'},
      {src:'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', name:'jsPDF'}
    ];
    var loaded=0;
    scripts.forEach(function(sc){
      var s=document.createElement('script');
      s.src=sc.src;
      s.onload=function(){ loaded++; if(loaded>=2) doExport(); };
      s.onerror=function(){ showAlert(t.crm_report_pdf_load_err||'PDF library failed to load, please check network.'); if(btn) btn.disabled=false; };
      document.head.appendChild(s);
    });
  }
}

// 语言切换时刷新报告（若打开）
function refreshCrmReport() {
  if (!CRM_REPORT_ROW) return;
  var modal = el('crmReportModal');
  if (!modal || modal.style.display === 'none') return;
  var t = T();
  el('crmReportTitle').innerText = t.crm_report_title || 'Project Report';
  el('crmReportCurLabel').innerText = (t.crm_report_currency || 'Currency');
  el('crmReportBtnClose').innerText = t.crm_report_close || 'Close';
  el('crmReportBtnExport').innerText = '🖨 ' + (t.btn_print || '打印');
  _crmReportRender();
  if (typeof Chart !== 'undefined') _crmReportCharts();
}

// 渲染报告文本部分
function _crmReportRender() {
  var t = T();
  var row = CRM_REPORT_ROW;
  var cur = CRM_REPORT_CUR;
  var esc = function(v){ return String(v==null?'':v); };
  var date = function(v){ return (typeof ymdToDmy==='function') ? ymdToDmy(v) : (v||''); };
  var pct = function(v){ return (v==null||v==='') ? '' : String(v)+'%'; };
  var yesNo = function(v){
    var sv = (v==null?'':String(v)).toLowerCase();
    if (v === true || v === 1 || sv === '1' || sv === 'yes' || sv === 'y' || sv === 'true' || sv === '是') return '✓';
    if (v === false || v === 0 || sv === '0' || sv === 'no' || sv === 'n' || sv === 'false' || sv === '否') return '✗';
    return '—';
  };

  function field(label, val) {
    return '<div class="crm-rep-field"><span class="crm-rep-label">' + label + '</span><span class="crm-rep-value">' + val + '</span></div>';
  }
  function section(title) {
    return '<div class="crm-rep-section-title">' + title + '</div>';
  }

  // ---- 报价 Q1-Q7 标签（使用现有描述性键：Q1-设备 等）----
  var qs = [
    {k:'q1', lbl: t.crm_q1 || 'Q1'},
    {k:'q2', lbl: t.crm_q2 || 'Q2'},
    {k:'q3', lbl: t.crm_q3 || 'Q3'},
    {k:'q4', lbl: t.crm_q4 || 'Q4'},
    {k:'q5', lbl: t.crm_q5 || 'Q5'},
    {k:'q6', lbl: t.crm_q6 || 'Q6'},
    {k:'q7', lbl: t.crm_q7 || 'Q7'}
  ];
  var curKey = cur.toLowerCase();

  var html = '';

  // 2.1 项目基本情况
  html += section(t.crm_report_sec_basic || 'Project Basic Info');
  html += '<div class="crm-rep-grid">';
  html += field(t.crm_quote_no || 'Quote No.', esc(row.quote_no));
  html += field(t.crm_project_name || 'Project Name', esc(row.project_name));
  // 省份/BU 随系统语言显示（使用现有翻译函数）
  var provDisp = (typeof provinceDisplay === 'function') ? provinceDisplay(row.province) : esc(row.province);
  var buDisp = (typeof buDisplay === 'function') ? buDisplay(row.bu) : esc(row.bu);
  html += field(t.crm_province || 'Province', esc(provDisp));
  html += field(t.crm_customer || 'Customer', esc(row.customer));
  html += field(t.crm_bu || 'BU', esc(buDisp));
  html += field(t.crm_manager || 'Manager', esc(row.manager));
  html += field(t.crm_manager_phone || 'Manager Phone', esc(row.manager_phone));
  html += field(t.crm_company_info || 'Company Info', esc(row.company_info));
  html += field(t.crm_salesperson || 'Salesperson', esc(row.salesperson));
  html += '</div>';

  // 2.2 项目进度情况
  html += section(t.crm_report_sec_progress || 'Project Progress');
  html += '<div class="crm-rep-grid">';
  // 建设情况随系统语言显示（使用现有翻译函数）
  var consDisp = (typeof constructionDisplay === 'function') ? constructionDisplay(row.construction) : esc(row.construction);
  html += field(t.crm_construction || 'Construction', esc(consDisp));
  html += field(t.crm_startup_pct || 'Go probability', pct(row.startup_pct));
  html += field(t.crm_sign_pct || 'Get probability', pct(row.sign_pct));
  html += field(t.crm_initial_quote_date || 'Initial Quote Date', date(row.initial_quote_date));
  html += field(t.crm_est_purchase_date || 'Est. Purchase Date', date(row.est_purchase_date));
  html += field(t.crm_est_ship_date || 'Est. Ship Date', date(row.est_ship_date));
  html += field(t.crm_quote_version || 'Quote Version', esc(row.quote_version));
  html += field(t.crm_last_quote_date || 'Last Quote Date', date(row.last_quote_date));
  html += '</div>';

  // 2.3 报价情况
  html += section(t.crm_report_sec_quote || 'Quotation');
  html += '<div class="crm-rep-grid">';
  // 汇率数值加千分符
  var fmtRate = function(v){ var n = Number(v); return (isFinite(n) && n !== 0) ? n.toLocaleString('en-US') : (v==null||v==='' ? '—' : esc(v)); };
  html += field(t.crm_report_rate || 'Exchange Rate at Quote', 'RMB/VND ' + fmtRate(row.rate_rmb_vnd) + ' | USD/VND ' + fmtRate(row.rate_usd_vnd));
  html += field(t.crm_report_incoterm || 'Incoterms', esc(row.incoterm));
  html += field(t.crm_report_install_quoted || 'Install Quoted?', yesNo(row.install_quoted));
  html += '</div>';

  // 价格详情表格 (Q1-Q7)
  html += '<div class="crm-rep-price-title">' + (t.crm_report_price_detail || 'Price Details') + ' (' + cur + ')</div>';
  html += '<table class="crm-rep-table"><thead><tr>';
  html += '<th>' + (t.crm_report_unit || 'Amount') + '</th>';
  for (var i = 0; i < qs.length; i++) { html += '<th>' + qs[i].lbl + '</th>'; }
  html += '</tr></thead><tbody><tr>';
  html += '<td class="crm-rep-td-label">' + cur + '</td>';
  // 安装费未报价（install_quoted 为否）时 Q6-安装费 显示 0
  var sv = (row.install_quoted==null?'':String(row.install_quoted)).toLowerCase();
  var installNo = (row.install_quoted === false || row.install_quoted === 0 || sv === '0' || sv === 'no' || sv === 'n' || sv === 'false' || sv === '否');
  var curSym = (typeof crmCurSym === 'function') ? crmCurSym(cur) : '';
  for (var j = 0; j < qs.length; j++) {
    var q = qs[j];
    var val = row[q.k + '_' + curKey];
    var num = (typeof moneyToNumber === 'function') ? moneyToNumber(val) : (Number(val)||0);
    if (q.k === 'q6' && installNo) num = 0;
    var amt = (num == null || num === '') ? '' : (num === 0 ? curSym + ' 0' : crmCurFmt(num, cur));
    html += '<td class="crm-rep-td-amt">' + amt + '</td>';
  }
  html += '</tr></tbody></table>';

  // 图表区
  html += '<div class="crm-rep-charts">';
  html += '<div class="crm-rep-chart-box"><div class="crm-rep-chart-title">' + (t.crm_report_chart_bar || 'Bar Chart (Q1-Q6)') + '</div><canvas id="crmRepBar"></canvas></div>';
  html += '<div class="crm-rep-chart-box"><div class="crm-rep-chart-title">' + (t.crm_report_chart_pie || 'Pie Chart (Q1-Q6)') + '</div><canvas id="crmRepPie"></canvas></div>';
  html += '</div>';

  el('crmReportBody').innerHTML = html;
  _crmReportSetCurBtns();
}

// 高亮当前货币按钮
function _crmReportSetCurBtns() {
  var cur = CRM_REPORT_CUR;
  ['RMB','USD','VND'].forEach(function(c){
    var b = el('crmReportCur' + c);
    if (b) b.classList.toggle('btn-primary', c === cur);
  });
}

// 切换报告货币
function crmReportSetCur(cur) {
  if (!CRM_REPORT_ROW) return;
  CRM_REPORT_CUR = cur;
  _crmReportRender();
  if (typeof Chart !== 'undefined') _crmReportCharts();
}

// 渲染柱状图 + 饼图 (Q1-Q6, 当前币种)
function _crmReportCharts() {
  // 销毁旧图表
  for (var i = 0; i < CRM_REPORT_CHARTS.length; i++) {
    if (CRM_REPORT_CHARTS[i]) CRM_REPORT_CHARTS[i].destroy();
  }
  CRM_REPORT_CHARTS = [];
  var row = CRM_REPORT_ROW;
  var cur = CRM_REPORT_CUR;
  var curKey = cur.toLowerCase();
  var t = T();
  var labels = [t.crm_q1||'Q1', t.crm_q2||'Q2', t.crm_q3||'Q3', t.crm_q4||'Q4', t.crm_q5||'Q5', t.crm_q6||'Q6'];
  var keys = ['q1','q2','q3','q4','q5','q6'];
  // 安装费未报价（install_quoted 为否）时 Q6-安装费 为 0
  var sv = (row.install_quoted==null?'':String(row.install_quoted)).toLowerCase();
  var installNo = (row.install_quoted === false || row.install_quoted === 0 || sv === '0' || sv === 'no' || sv === 'n' || sv === 'false' || sv === '否');
  var data = keys.map(function(k){
    var val = row[k + '_' + curKey];
    var num = (typeof moneyToNumber === 'function') ? moneyToNumber(val) : (Number(val)||0);
    if (k === 'q6' && installNo) num = 0;
    return num;
  });
  var colors = ['#2563eb','#16a34a','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
  var fmt = function(v){ return crmCurFmt(Math.round(v), cur); };

  // 柱状图
  var bar = _ovMakeChart('crmRepBar', {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: (t.crm_report_unit||'Amount') + ' ('+cur+')', data: data, backgroundColor: colors, borderColor: colors, borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        // 让全局柱顶标签插件使用当前币种符号显示金额
        ovDataLabels: { symbol: (typeof crmCurSym==='function') ? crmCurSym(cur) : '$' }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: function(v){ return v.toLocaleString('en-US'); } } } }
    }
  });
  if (bar) CRM_REPORT_CHARTS.push(bar);

  // 饼图（绝对值 + 相对值标签）
  var pie = _ovMakeChart('crmRepPie', {
    type: 'pie',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderColor: '#fff', borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        datalabels: { display: false },
        // 让全局饼图标签插件使用当前币种符号显示绝对值
        ovPieLabels: { symbol: (typeof crmCurSym==='function') ? crmCurSym(cur) : '$' }
      }
    }
  });
  if (pie) CRM_REPORT_CHARTS.push(pie);
}

// ==================== 渲染包装器：任何 tbody 再生后自动恢复列可见性 ====================
// 排序/搜索/语言切换/复制/新增 等 10 处调用点全部经由 renderCrmData 重新生成 tbody，
// 在此统一挂同步钩子（setTimeout 0：等调用方把 innerHTML 写入 DOM 后再同步），
// 未来新增调用点也自动安全，杜绝表头/数据错位。
(function(){
  var _orig = renderCrmData;
  renderCrmData = function(list){
    var html = _orig(list);
    // ★ 渲染语言戳（V36）：记下本次 tbody 渲染时用的语言。
    //   数据列的显示文本（省份/BU/备注…）在渲染那一刻由 CUR_LANG 决定并固化进 HTML，
    //   因此"tbody 当前是否匹配当前语言"只需比对这个戳，不必依赖列索引/行序/返回值，
    //   是确定性的判断依据（供 applyCrmLang 的语言守卫使用）。
    try { window.__crmRenderLang = (typeof CUR_LANG !== 'undefined') ? CUR_LANG : 'vi'; } catch(e) {}
    if (typeof syncCrmColVisibility === 'function') setTimeout(syncCrmColVisibility, 0);
    // ★ 权限兜底：任何 tbody 再生（加载/排序/搜索/语言切换/清空）后都按权限重新隐藏行内按钮，
    //   否则初始 loadCrm 隐藏掉的「编辑/删除/转到失败项目」会因排序/搜索等再渲染而重新出现。
    if (typeof applyCrmRowPerms === 'function') setTimeout(applyCrmRowPerms, 0);
    return html;
  };
})();
