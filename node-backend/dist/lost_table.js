// ⛔ FROZEN (2026-09-06) V2026.09.06.20：本文件逻辑已锁定，未经用户明确同意禁止修改。LOST 表格逻辑（含三语/切语言/权限）均正确，仅数据可为演示数据。
/* ============================================================
 * 失败项目（Lost）表格逻辑 —— 完整复刻 潜在项目(crm_table.js)
 * 列结构：CRM 48 列（0-46 相同）+ 失败原因(47) + 操作(48) = 49 列
 * 共享辅助函数(T / esc / el / moneyToNumber / provinceDisplay /
 * buDisplay / constructionDisplay / ymdToDmy / fmtMoney / crmInstallDisplay /
 * _ovLoadChartLib / _ovMakeChart / crmCurFmt / crmCurSym / showAlert /
 * showCrmOrangeConfirm)均定义于 index.html，供本文件复用。
 * ============================================================ */

// ==================== 全局状态 ====================
var globalLostData = [];
var originalLostData = [];
var lostSortState = [];
var lostGroupState = {};
var LOST_NEVER_HIDE_COLS = new Set([0, 1, 48]);

// ==================== 工具函数 ====================
// 报价单 PDF 字段值兼容：完整 URL 直接用；纯文件名（旧版本地数据）→ /uploads/<名>
function crmPdfHref(v){
  var s = String(v || '');
  if (!s) return '#';
  if (/^https?:\/\//i.test(s) || s.charAt(0) === '/') return s;
  return '/uploads/' + encodeURIComponent(s);
}

// 根据当前语言自动切换显示失败原因（三语格式：中文\n越南文\n英文）
function getFailReasonDisplay(val) {
  if (!val) return '';
  var parts = String(val).split('\n');
  var lang = (typeof CUR_LANG !== 'undefined') ? CUR_LANG : 'zh';
  if (lang === 'zh' && parts[0]) return parts[0];
  if (lang === 'vi' && parts[1]) return parts[1];
  if (lang === 'en' && parts[2]) return parts[2];
  return parts[0] || parts.join(' ');
}

// ==================== 列定义 ====================
// 失败项目 49 列：0-46 与 CRM 完全一致；47=失败原因；48=操作
var LOST_COL_KEYS = [
  'idx','quote_no','project_name','province','customer','bu','construction',
  'startup_pct','sign_pct','manager','manager_phone','company_info',
  'initial_quote_date','est_purchase_date','est_ship_date','quote_version','last_quote_date',
  'rate_rmb_vnd','rate_usd_vnd','incoterm',
  'q1_rmb','q1_usd','q1_vnd','q2_rmb','q2_usd','q2_vnd',
  'q3_rmb','q3_usd','q3_vnd','q4_rmb','q4_usd','q4_vnd',
  'q5_rmb','q5_usd','q5_vnd','q6_rmb','q6_usd','q6_vnd',
  'q7_rmb','q7_usd','q7_vnd',
  'install_quoted','pdf_equip','pdf_install','pdf_both',
  'salesperson','remark','fail_reason','id'
];

// 排序字段映射：列索引 → 数据字段名（与 CRM 一致，47=失败原因，48=操作）
var LOST_COL_KEY_MAP = {
  0:'idx',1:'quote_no',2:'project_name',3:'province',4:'customer',5:'bu',6:'construction',
  7:'startup_pct',8:'sign_pct',9:'manager',10:'manager_phone',11:'company_info',
  12:'initial_quote_date',13:'est_purchase_date',14:'est_ship_date',15:'quote_version',16:'last_quote_date',
  17:'rate_rmb_vnd',18:'rate_usd_vnd',19:'incoterm',
  20:'q1_rmb',21:'q1_usd',22:'q1_vnd',23:'q2_rmb',24:'q2_usd',25:'q2_vnd',
  26:'q3_rmb',27:'q3_usd',28:'q3_vnd',29:'q4_rmb',30:'q4_usd',31:'q4_vnd',
  32:'q5_rmb',33:'q5_usd',34:'q5_vnd',35:'q6_rmb',36:'q6_usd',37:'q6_vnd',
  38:'q7_rmb',39:'q7_usd',40:'q7_vnd',
  41:'install_quoted',42:'pdf_equip',43:'pdf_install',44:'pdf_both',
  45:'salesperson',46:'remark',47:'fail_reason',48:'id'
};

// 列分组定义（用于折叠）——与潜在项目 CRM 完全一致：rate 合并、PDF 合并、Q1-Q7 合并
var LOST_GROUPS = [
  { label:'l2',  labelKey:'crm_project_name',      c:[2] },
  { label:'l3',  labelKey:'crm_province',          c:[3] },
  { label:'l4',  labelKey:'crm_customer',          c:[4] },
  { label:'l5',  labelKey:'crm_bu',                c:[5] },
  { label:'l6',  labelKey:'crm_construction',      c:[6] },
  { label:'l7',  labelKey:'crm_startup_pct',       c:[7] },
  { label:'l8',  labelKey:'crm_sign_pct',          c:[8] },
  { label:'l9',  labelKey:'crm_manager',           c:[9] },
  { label:'l10', labelKey:'crm_manager_phone',     c:[10] },
  { label:'l11', labelKey:'crm_company_info',      c:[11] },
  { label:'l12', labelKey:'crm_initial_quote_date',c:[12] },
  { label:'l13', labelKey:'crm_est_purchase_date', c:[13] },
  { label:'l14', labelKey:'crm_est_ship_date',     c:[14] },
  { label:'l15', labelKey:'crm_quote_version',     c:[15] },
  { label:'l16', labelKey:'crm_last_quote_date',   c:[16] },
  { label:'lrate', labelKey:'crm_rate_title', c:[17,18] },
  { label:'l19', labelKey:'crm_incoterm',          c:[19] },
  { label:'lQ1', labelKey:'crm_q1', c:[20,21,22] },
  { label:'lQ2', labelKey:'crm_q2', c:[23,24,25] },
  { label:'lQ3', labelKey:'crm_q3', c:[26,27,28] },
  { label:'lQ4', labelKey:'crm_q4', c:[29,30,31] },
  { label:'lQ5', labelKey:'crm_q5', c:[32,33,34] },
  { label:'lQ6', labelKey:'crm_q6', c:[35,36,37] },
  { label:'lQ7', labelKey:'crm_q7', c:[38,39,40] },
  { label:'l41', labelKey:'crm_install_quoted',    c:[41] },
  { label:'ldoc', labelKey:'crm_pdf_title', c:[42,43,44] },
  { label:'l45', labelKey:'crm_salesperson',       c:[45] },
  { label:'l46', labelKey:'crm_remark',            c:[46] },
  { label:'l47', labelKey:'won_fail_reason', label:'失败原因', c:[47] }
];

LOST_GROUPS.forEach(function(g){ lostGroupState[g.label] = false; });

// ==================== colgroup ====================
function buildLostColGroup() {
  var html = '<colgroup>';
  for (var i = 0; i < 49; i++) {
    var cls = '';
    if (i === 0) cls = ' class="col-fixed col-never-hide"';
    else if (i === 1) cls = ' class="col-fixed-2 col-never-hide"';
    else if (i === 48) cls = ' class="col-never-hide"';
    var st = '';
    if (i === 0) st = ' style="width:40px;min-width:40px;max-width:40px;"';
    else if (i === 1) st = ' style="width:90px;min-width:90px;max-width:90px;"';
    html += '<col data-col="' + i + '"' + cls + st + '>';
  }
  html += '</colgroup>';
  return html;
}

// ==================== 列可见性单一事实源（根治表头/数据错位） ====================
// 与 CRM/Won 同款修复：renderLostData 再生 tbody 后由包装器自动调用，
// 全表 49 列按期望隐藏集合统一应用，th/td/col 永远一致。
function syncLostColVisibility() {
  var tbl = document.getElementById('lostTable');
  if (!tbl) return;
  var hidden = {};
  LOST_GROUPS.forEach(function(g) {
    if (lostGroupState[g.label]) g.c.forEach(function(c) { if (!LOST_NEVER_HIDE_COLS.has(c)) hidden[c] = 1; });
  });
  for (var c = 0; c < 49; c++) {
    if (LOST_NEVER_HIDE_COLS.has(c)) continue;
    var want = !!hidden[c] || (typeof curHiddenFor === 'function' && curHiddenFor(c, 'q'));
    tbl.querySelectorAll('[data-col="' + c + '"]').forEach(function(el) {
      if (el.tagName === 'TH') return;   // 一级表头绝不随单列隐藏，统一由下方组头逻辑处理
      el.classList.toggle('col-hidden', want);
    });
  }
  // 组头单一事实源：仅当组内全部子列都被隐藏时一级表头才隐藏；
  // 否则一级表头保持原位显示，colspan 自动收缩为剩余可见子列数（3→2→1），
  // 文字/位置/配色零改动（货币开关仅收窄其覆盖宽度，剩余子列自动撑满）。
  LOST_GROUPS.forEach(function(g) {
    var first = -1;
    for (var i = 0; i < g.c.length; i++) { if (!LOST_NEVER_HIDE_COLS.has(g.c[i])) { first = g.c[i]; break; } }
    if (first < 0) return;
    var vis = 0;
    g.c.forEach(function(c) {
      if (LOST_NEVER_HIDE_COLS.has(c)) { vis++; return; }
      if (!hidden[c] && !(typeof curHiddenFor === 'function' && curHiddenFor(c, 'q'))) vis++;
    });
    var th = tbl.querySelector('thead th[data-col="' + first + '"]');
    if (th) {
      if (vis === 0) th.classList.add('col-hidden');
      else { th.classList.remove('col-hidden'); th.colSpan = vis; th.classList.toggle('hdr-shrink', vis < g.c.length); }
      var b = th.querySelector('.won-col-toggle');
      if (b) b.textContent = hidden[first] ? '[+]' : '[−]';
    }
  });
  updateLostCollapsedBar();
}

function toggleLostColumnGroupByLabel(label) {
  var grp = null;
  for (var g = 0; g < LOST_GROUPS.length; g++) {
    if (LOST_GROUPS[g].label === label) { grp = LOST_GROUPS[g]; break; }
  }
  if (!grp) return;
  var cols = grp.c.filter(function(c) { return !LOST_NEVER_HIDE_COLS.has(c); });
  if (cols.length === 0) { lostGroupState[label] = false; return; }
  lostGroupState[label] = !lostGroupState[label];
  syncLostColVisibility();   // 单一事实源统一应用（th/td/col/按钮/折叠条）
}

function injectLostToggleBtns() {
  var th = document.getElementById('lostThead');
  if (!th) return;
  LOST_GROUPS.forEach(function(grp) {
    if (grp.c[0] === undefined) return;
    var i = grp.c[0];
    if (LOST_NEVER_HIDE_COLS.has(i)) return;
    var thEl = th.querySelector('th[data-col="' + i + '"]');
    if (!thEl) return;
    if (thEl.querySelector('.won-col-toggle')) return;
    var btn = document.createElement('span');
    btn.className = 'won-col-toggle';
    btn.textContent = '[−]';
    btn.title = '折叠/展开该列组(整组一起隐藏)';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleLostColumnGroupByLabel(grp.label);
    });
    // 插入到排序箭头之前（与潜在项目一致）
    var sortEl = thEl.querySelector('.sort-indicator');
    if (sortEl) thEl.insertBefore(btn, sortEl);
    else thEl.appendChild(btn);
  });
}

function updateLostCollapsedBar() {
  var bar = document.getElementById('lost-collapsed-bar');
  if (!bar) return;
  var t = T();
  var tags = '', has = false;
  LOST_GROUPS.forEach(function(g) {
    if (lostGroupState[g.label]) {
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
      b.onclick = function() { toggleLostColumnGroupByLabel(b.dataset.restore); };
    });
  } else {
    bar.style.display = 'none';
    bar.innerHTML = '';
  }
}

// ==================== 一级表头 ====================
function renderLostThead() {
  var t = T();
  var html = '<tr class="won-thead">';
  var hdr = function(i, label, cls, cs, sortable) {
    cs = cs || 1;
    cls = cls || '';
    if (i === 0) cls += ' col-fixed col-never-hide';
    else if (i === 1) cls += ' col-fixed-2 col-never-hide';
    if (i === 48) cls += ' col-never-hide';
    var w = '';
    if (i === 0) w = ' style="width:40px;min-width:40px;max-width:40px;"';
    else if (i === 1) w = ' style="width:90px;min-width:90px;max-width:90px;"';
    var sortHtml = sortable ? ' <span class="sort-indicator" data-col="' + i + '" onclick="sortLostTable(' + i + ',event)">\u21c5</span>' : '';
    return '<th class="' + cls + '"' + w + ' colspan="' + cs + '" data-col="' + i + '">' +
           '<span class="th-label">' + label + '</span>' + sortHtml + '</th>';
  };

  html += hdr(0,  t.crm_no || 'No.',             'won-cyan', 1, false);
  html += hdr(1,  t.crm_quote_no,                'won-cyan', 1, true);
  html += hdr(2,  t.crm_project_name,            'won-cyan', 1, true);
  html += hdr(3,  t.crm_province,                'won-cyan', 1, true);
  html += hdr(4,  t.crm_customer,                'won-cyan', 1, true);
  html += hdr(5,  t.crm_bu,                      'won-cyan', 1, true);
  html += hdr(6,  t.crm_construction,            'won-pink', 1, true);
  html += hdr(7,  t.crm_startup_pct,             'won-pink', 1, true);
  html += hdr(8,  t.crm_sign_pct,                'won-pink', 1, true);
  html += hdr(9,  t.crm_manager,                 'won-blue', 1, true);
  html += hdr(10, t.crm_manager_phone,           'won-blue', 1, true);
  html += hdr(11, t.crm_company_info,            'won-blue', 1, true);
  html += hdr(12, t.crm_initial_quote_date,      'won-yellow', 1, true);
  html += hdr(13, t.crm_est_purchase_date,       'won-yellow', 1, true);
  html += hdr(14, t.crm_est_ship_date,           'won-yellow', 1, true);
  html += hdr(15, t.crm_quote_version,           'won-yellow', 1, true);
  html += hdr(16, t.crm_last_quote_date,         'won-yellow', 1, true);
  html += hdr(17, t.crm_rate_title || 'Exchange Rate', 'rate', 2, false);
  html += hdr(19, t.crm_incoterm,                'hdr', 1, true);
  html += hdr(20, t.crm_q1 || 'Q1',              'won-qhdr', 3, false);
  html += hdr(23, t.crm_q2 || 'Q2',              'won-qhdr', 3, false);
  html += hdr(26, t.crm_q3 || 'Q3',              'won-qhdr', 3, false);
  html += hdr(29, t.crm_q4 || 'Q4',              'won-qhdr', 3, false);
  html += hdr(32, t.crm_q5 || 'Q5',              'won-qhdr', 3, false);
  html += hdr(35, t.crm_q6 || 'Q6',              'won-qhdr', 3, false);
  html += hdr(38, t.crm_q7 || 'Q7',              'won-qhdr', 3, false);
  html += hdr(41, t.crm_install_quoted,          'won-p1', 1, true);
  html += hdr(42, t.crm_pdf_title || 'Quote PDF','won-pink', 3, false);
  html += hdr(45, t.crm_salesperson,             'won-blue', 1, true);
  html += hdr(46, t.crm_remark,                  'won-blue', 1, true);
  // 失败信息（本模块特有）
  html += hdr(47, t.won_fail_reason || '失败原因', 'won-pink', 1, true);
  html += hdr(48, t.crm_action || 'Action',      'won-action-yellow', 1, false);

  html += '</tr>';
  return html;
}

// ==================== 二级假表头 ====================
function renderLostFakeSubHeaderRow() {
  var t = T();
  var html = '<tr class="fake-header-row">';
  for (var i = 0; i < 49; i++) {
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
    else if (i===47) { cls+='won-pink'; }
    else if (i===48) { cls+='won-action-yellow'; }
    if (i===0) cls += ' col-fixed col-never-hide';
    else if (i===1) cls += ' col-fixed-2 col-never-hide';
    else if (i===48) cls += ' col-never-hide';
    var st = '';
    if (i===0) st = ' style="width:40px;min-width:40px;max-width:40px;"';
    else if (i===1) st = ' style="width:90px;min-width:90px;max-width:90px;"';
    var sortable = (i>=17 && i<=18) || (i>=20 && i<=40) || (i>=42 && i<=44);
    if (sortable) {
      cls += ' sortable-cell';
      html += '<td class="' + cls + '"' + st + ' data-col="' + i + '">' + label +
              ' <span class="sort-indicator" data-col="' + i + '" onclick="sortLostTable(' + i + ',event)">\u21c5</span></td>';
    } else {
      html += '<td class="' + cls + '"' + st + ' data-col="' + i + '">' + label + '</td>';
    }
  }
  html += '</tr>';
  return html;
}

// ==================== 表体渲染 ====================
function renderLostData(list) {
  var t = T();
  var html = renderLostFakeSubHeaderRow();
  list.forEach(function(p, rowIdx) {
    var rowNo = rowIdx + 1;
    html += '<tr class="won-data-row' + (rowIdx % 2 === 1 ? ' zebra-even' : '') + '">';
    for (var i = 0; i < 49; i++) {
      var cls = 'hdr';
      var val = p[LOST_COL_KEYS[i]];
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
        case 17: cls='rate'; val=(val !== undefined && val !== null && val !== '') ? (Math.round(Number(val)||0)).toLocaleString('en-US') : ''; break;
        case 18: cls='rate'; val=(val !== undefined && val !== null && val !== '') ? (Math.round(Number(val)||0)).toLocaleString('en-US') : ''; break;
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
          continue;
        case 41: {
          var insRaw = val;
          var insYes = (insRaw === '是' || insRaw === '1' || insRaw === 1 || insRaw === true ||
                        insRaw === 'Yes' || insRaw === 'yes' || insRaw === 'Y');
          var insColor = insYes ? '#d0021b' : '#000000';
          html += '<td class="won-p1"' + dc + '><span style="color:' + insColor + ';font-weight:' + (insYes ? '700' : '400') + ';">' + crmInstallDisplay(insRaw) + '</span></td>';
          continue;
        }
        case 42: case 43: case 44: {
          // 附件不随 CRM→LOST 展示：LOST 界面一律显示"无PDF"；
          // 数据保留在行内，转回 CRM 后可重新查看；删除 LOST 时同步删除附件文件
          cls='won-pink';
          html+='<td class="won-pink"'+dc+'><span style="color:#aaa">'+(t.crm_no_pdf||'No PDF')+'</span></td>';
          continue;
        }
        case 45: cls='won-blue'; val=esc(val); break;
        // 备注(46)：三语按当前表头语言显示（转失败项目继承 CRM 三语列时生效；旧单语数据回退 p.remark）
        case 46: cls='won-blue'; val=esc(typeof rmLangVal==='function' ? rmLangVal(p, 'remark') : val); break;
        case 47: cls='won-pink'; val=esc(getFailReasonDisplay(val)); break; // 失败原因（按语言切换）
        case 48: {
          var viewBtn='<button class="btn-sm btn-view" onclick="viewLost('+p.id+')">'+(t.crm_view||t.lostView||'View')+'</button>';
          // 失败项目操作按钮统一全部渲染；显隐完全由 LOST-D3 / LOST-R1 权限决策控制
          // （applyLostRowPerms 兜底隐藏），不再按 canWriteRow 在行生成阶段阉割。
          // 实际删除/转回仍由服务端 canModifyRow + permGate 守卫。
          var writeBtns = ' <button class="btn-sm btn-del" onclick="deleteLost('+p.id+')">'+(t.crm_del||'Delete')+'</button>'
              +' <button class="btn-sm btn-restore" onclick="restoreLost('+p.id+')">'+(t.lostRestore||'Restore')+'</button>';
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
    html+='<tr><td colspan="49" style="text-align:center;padding:40px;color:#999">'+(t.crm_empty||'No data')+'</td></tr>';
  }
  return html;
}

// ==================== 排序（与潜在项目 CRM 完全一致：支持多列组合排序） ====================
function lostCompareMulti(a, b, list) {
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var key = LOST_COL_KEY_MAP[s.col];
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

function applyLostSort() {
  var data = globalLostData.slice();
  if (lostSortState.length) {
    var list = lostSortState.slice();
    data.sort(function(a, b) { return lostCompareMulti(a, b, list); });
  }
  var tb = document.getElementById('lostTbody');
  if (tb) tb.innerHTML = renderLostData(data);
  // 兜底：渲染包装器已处理，但排序后再显式确保行内按钮按权限隐藏
  if (typeof applyLostRowPerms === 'function') applyLostRowPerms();
  updateLostSortIndicators();
}

function updateLostSortIndicators() {
  var tbl = document.getElementById('lostTable');
  if (!tbl) return;
  tbl.querySelectorAll('.sort-indicator').forEach(function(el) {
    el.classList.remove('active');
    el.textContent = '\u21c5';
  });
  lostSortState.forEach(function(s, idx) {
    tbl.querySelectorAll('.sort-indicator[data-col="' + s.col + '"]').forEach(function(el) {
      el.classList.add('active');
      el.textContent = (s.asc ? '\u25b2' : '\u25bc') + (idx + 1);
    });
  });
}

function sortLostTable(col, ev) {
  if (col === 0 || col === 48) return;
  if (globalLostData.length === 0) return;
  var useMulti = ev && ev.ctrlKey;
  var foundIdx = -1;
  for (var i = 0; i < lostSortState.length; i++) {
    if (lostSortState[i].col === col) { foundIdx = i; break; }
  }
  if (foundIdx >= 0) {
    // 已在排序组合中：循环 升序 -> 降序 -> 移除
    if (lostSortState[foundIdx].asc) {
      lostSortState[foundIdx].asc = false;
    } else {
      lostSortState.splice(foundIdx, 1);
    }
  } else {
    if (useMulti) {
      // Ctrl+点击：追加为次级排序（组合排序）
      lostSortState.push({ col: col, asc: true });
    } else {
      // 普通点击：重置为单列排序
      lostSortState = [{ col: col, asc: true }];
    }
  }
  if (lostSortState.length === 0) {
    var tb0 = document.getElementById('lostTbody');
    if (tb0) tb0.innerHTML = renderLostData(originalLostData.slice());
    // 兜底：取消排序后显式按权限隐藏行内按钮
    if (typeof applyLostRowPerms === 'function') applyLostRowPerms();
    updateLostSortIndicators();
    return;
  }
  applyLostSort();
}

// ==================== 加载数据 ====================
function lostApiBase() {
  // 注意：不能用 (API_BASE && ...) 判断，因为 API_BASE 为空字符串(同源)是合法值但为 falsy，
  // 那样会错误地 fallback 到 127.0.0.1，导致手机通过局域网 IP 访问时请求全部失败。
  return (typeof API_BASE !== 'undefined') ? API_BASE : '';
}

function loadLost(isAuto) {
  var cg = document.getElementById('lostColGroup');
  var th = document.getElementById('lostThead');
  var tb = document.getElementById('lostTbody');
  if (!cg || !th || !tb) return;
  bindLostCrossHighlight();

  var t0 = T();
  var titleEl = document.getElementById('lostTitle');
  var btnAdd = document.getElementById('btnAddLost');
  var btnOverview = document.getElementById('btnLostOverview');
  var btnExport = document.getElementById('btnExportLostExcel');
  if (titleEl) titleEl.innerText = t0.lostTitle || t0.crmTitle;
  if (btnAdd) btnAdd.innerText = t0.btnAddLost || t0.btnAddCrm;
  if (btnOverview) btnOverview.innerText = t0.btnLostOverview || t0.btnCrmOverview;
  if (btnExport) btnExport.innerText = t0.btnExportLostExcel || t0.btnExportCrmExcel;

  cg.innerHTML = buildLostColGroup();
  th.innerHTML = renderLostThead();
  injectLostToggleBtns();
  updateLostCollapsedBar();
  // thead 重建后立即按单一事实源恢复列可见性与组头 colspan（含无数据路径）
  if (typeof syncLostColVisibility === 'function') syncLostColVisibility();

  var emptyRow = '<tr><td colspan="49" style="text-align:center;padding:40px;color:#999">' + ((T().lost_empty) || ((T().crm_empty) || 'No data')) + '</td></tr>';

  fetch(lostApiBase() + '/api/lost-projects', { credentials: 'include', headers: (typeof authHeaders==='function'?authHeaders():{}) })
    .then(function(r){ return r.json(); })
    .then(function(data) {
      var list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : null);
      if (list) {
        globalLostData = list.slice();
        originalLostData = list.slice();
        globalLostData.forEach(function(row,i){ row.idx = i+1; });
        originalLostData.forEach(function(row,i){ row.idx = i+1; });
        tb.innerHTML = renderLostData(globalLostData);
      } else {
        tb.innerHTML = emptyRow;
      }
      applyLostRowPerms();   // 渲染完成后立即按权限隐藏按钮（不依赖外部 setTimeout 猜测延时）
      // V28：服务端补翻缺的三语备注并写库；filled>0 时重拉一次（重拉后 filled=0 即止，无递归）
      if (typeof autoFillRemarks === 'function') {
        // 非自动重拉（switchView/reloadSession 直调）清零链计数；自动重拉回调传 true 累加
        if (!isAuto) { try { (window.__autoFillChain = window.__autoFillChain || {}).lost_projects = 0; } catch(e){} }
        autoFillRemarks('lost_projects', function(){ loadLost(true); });
      }
    })
    .catch(function() { tb.innerHTML = emptyRow; });
}

// Lost 行内按钮（查看/删除/转回潜在）按权限隐藏
// 注：编辑权限规则已随编辑按钮一并移除（业务需求：失败项目不支持编辑）
// 注意：必须在表格渲染完成后调用，否则新渲染的按钮会绕过隐藏（此前依赖外部 setTimeout 350ms，慢于渲染时失效）
function applyLostRowPerms(){
  if (typeof applyRowPerms !== 'function') return;
  applyRowPerms('lostTbody', [
    { bid: 'LOST-D1', sel: '.btn-view' },
    { bid: 'LOST-D3', sel: '.btn-del' },
    { bid: 'LOST-R1', sel: '.btn-restore' }
  ]);
}

// ==================== 语言应用 ====================
// ★ 100% 复刻 WON 的 applyWonLang 逻辑（与 crm_table.js 同步改造）：
//   绝不重建 colgroup/thead 结构（纯文本更新），行重渲染仅在视图可见时进行，
//   不可见时打轻标 _viewLangStale.lost 由 switchView 消费。
function updateLostTheadTextOnly() {
  var th = document.getElementById('lostThead');
  if (!th || typeof renderLostThead !== 'function') return;
  try {
    // ================================================================
    // ⛔ 已锁定实现 —— V2026.09.03.32/33（Z51/Z52）验证通过，禁止修改
    //    （与 crm_table.js 同构，两处必须保持一致）
    // ================================================================
    // ★ 自愈守卫（与 crm_table.js 同步）：表头损坏（无 th[data-col] 节点）→ 完整重建。
    //   根因背景：HTML 初始 <thead id="lostThead"> 为空，V21 改"文本级更新"后
    //   【首次进入视图】0 匹配不建表头 → 空白彩条；本守卫为该场景兜底修复。
    //   日志分级：tbody 有数据行但表头没了 = 真损坏（warn）；thead 尚未初始化（首次
    //   进入视图，HTML 初始 <thead> 为空）= 正常路径（info），非错误。
    if (!th.querySelector('th[data-col]')) {
      var _tbGuard = document.getElementById('lostTbody');
      var _rowsGuard = _tbGuard ? _tbGuard.querySelectorAll('tr.won-data-row').length : 0;
      if (_rowsGuard > 0) {
        console.warn('[lost-lang] thead DAMAGED (' + _rowsGuard + ' rows but no header) -> full rebuild');
      } else {
      console.warn('[lost-lang] thead first-time init (empty on view entry) -> build');
      }
      th.innerHTML = renderLostThead();
      if (typeof injectLostToggleBtns === 'function') injectLostToggleBtns();
      if (typeof syncLostColVisibility === 'function') syncLostColVisibility();
      return;
    }
    var tmp = document.createElement('thead');
    tmp.innerHTML = renderLostThead();
    var newThs = tmp.querySelectorAll('th[data-col]');
    var _patched = 0;
    for (var k = 0; k < newThs.length; k++) {
      var c = newThs[k].getAttribute('data-col');
      var old = th.querySelector('th[data-col="' + c + '"] .th-label');
      var src = newThs[k].querySelector('.th-label');
      if (old && src) { old.textContent = src.textContent; _patched++; }
    }
    // 搬运零命中 = 新旧结构不匹配 → 完整重建自愈
    if (!_patched) {
      console.warn('[lost-lang] thead text patch matched 0 cells -> full rebuild');
      th.innerHTML = renderLostThead();
      if (typeof injectLostToggleBtns === 'function') injectLostToggleBtns();
      if (typeof syncLostColVisibility === 'function') syncLostColVisibility();
    }
  } catch (e) { console.warn('[lost-lang] thead text sync failed:', e); }
}

// 表格侧备注补翻兜底（行定位 tr.won-data-row 序号 + td[data-col="46"]）
function _lostFillMissingRemarks(tb) {
  if (typeof ptTranslateText !== 'function') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  var L = (typeof CUR_LANG !== 'undefined') ? CUR_LANG : 'en';
  var trs = tb ? tb.querySelectorAll('tr.won-data-row') : [];
  (typeof globalLostData !== 'undefined' ? globalLostData : []).forEach(function(row, i){
    if (!row || !row.remark) return;
    // 行级失败标记：本会话内翻译失败过的行不再重试
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

// ⛔⛔⛔ 锁死声明（V2026.09.07）：LOST 切语言/表头/数据行渲染历经多次回归修复才稳定，
// 任何"优化/重构/简化"必须先取得用户明确同意，禁止私自改动！
function applyLostLang() {
  var t = T();
  var titleEl = document.getElementById('lostTitle');
  var btnAdd = document.getElementById('btnAddLost');
  var btnOverview = document.getElementById('btnLostOverview');
  var btnExport = document.getElementById('btnExportLostExcel');
  if (titleEl) titleEl.innerText = t.lostTitle || t.crmTitle;
  if (btnAdd) btnAdd.innerText = t.btnAddLost || t.btnAddCrm;
  if (btnOverview) btnOverview.innerText = t.btnLostOverview || t.btnCrmOverview;
  if (btnExport) btnExport.innerText = t.btnExportLostExcel || t.btnExportCrmExcel;
  var tb = document.getElementById('lostTbody');

  // ★ 每一步独立 try/catch（V36，与 crm_table.js 同款）：任何一步异常都不得阻断
  //   后续步骤，尤其不能阻断末尾的【数据行语言守卫】。
  // ★ WON 模式：绝不重建 colgroup/thead 结构，只做文本级更新
  try { updateLostTheadTextOnly(); } catch (e) { console.warn('[lost-lang] thead step failed:', e); }
  try { updateLostCollapsedBar(); } catch (e) { console.warn('[lost-lang] collapsed bar step failed:', e); }

  // ==================================================================
  // ⛔⛔⛔ 已锁定实现 —— V2026.09.03.39 / PERM_BUILD Z58 用户验证通过
  //    （与 crm_table.js 的 applyCrmLang 完全同构，两处必须保持一致）
  //    【禁止】加回 visible 门控；【禁止】删除 !hasCache 重取数兜底
  //    动此段前必须取得用户明确同意。
  //    （完整根因链条见 index.html loadDashboard 内 V39 锁定说明）
  // ==================================================================
  // var visible 仅为诊断日志保留，【不得】用于门控数据行重渲染。
  var sec = document.getElementById('view-lost');
  var visible = sec && sec.classList.contains('active');
  var hasCache = (typeof globalLostData !== 'undefined' && globalLostData && globalLostData.length);
  console.warn('[lost-lang] visible=' + !!visible + ' hasCache=' + !!hasCache + ' lang=' + CUR_LANG);
  //
  // 历史：V38 回归修复（与 crm_table.js 完全同构）
  //   旧版（见 electron/dist/lost_table.js）：if (tb) tb.innerHTML =
  //   renderLostData(globalLostData || []); —— 无条件重渲染，功能正常。
  //   V21 引入的 visible 门控使数据行（省份/BU/备注/失败原因）在切语言时
  //   可能完全不重渲染 → 停留旧语言。此处去掉 visible 门控，保留 hasCache
  //   保护（未加载数据不清空白板）；不再打 _viewLangStale 轻标。
  // V39 补充：!hasCache 且 DOM 有数据行时 → 防抖重取数 loadLost()（绝不白板）。
  try {
    if (tb && hasCache) {
      tb.innerHTML = renderLostData(globalLostData);   // 包装器自动 setTimeout(syncLostColVisibility)
      if (typeof applyLostRowPerms === 'function') applyLostRowPerms();
      _lostFillMissingRemarks(tb);
    } else if (tb && !hasCache) {
      // 缓存为空但 DOM 里还有数据行（globalLostData 被外部清空，见 V39 说明）→
      // 不能 renderLostData([])（会白板），重新取数后按新语言渲染。
      var _hasRows = tb.querySelectorAll('tr.won-data-row').length > 0;
      if (_hasRows && typeof loadLost === 'function' && !window.__lostLangRefetching) {
        window.__lostLangRefetching = true;
        setTimeout(function(){ window.__lostLangRefetching = false; }, 3000);
        console.warn('[lost-lang] cache empty but rows present -> reload data for new lang');
        loadLost();
      }
    }
  } catch (e) { console.warn('[lost-lang] rows re-render step failed:', e); }

  // ==================================================================
  // ⛔ 已锁定实现 —— 用户于 V2026.09.03.34 / PERM_BUILD Z53 验证通过，禁止修改
  //    （若要动此段，必须先取得用户明确同意；任何"优化/简化/重构"都在此禁用）
  //    与 crm_table.js 的 applyCrmLang 同构，两处必须保持一致。
  //
  // ★ 假表头行语言守卫（无条件兜底）：二级假表头行
  //   （tbody 首行 tr.fake-header-row）的 PDF 三子列等标签由 renderLostFakeSubHeaderRow
  //   按当前语言生成。任何未整体重渲染 tbody 的路径都会让它残留旧语言 →
  //   一级表头新语言、二级旧语言的错位。无条件按当前语言重盖这一行，数据行零影响。
  //
  //   为什么必须【无条件】放在分支之外：二级假表头行不在 thead 内，不被
  //   updateLostTheadTextOnly 覆盖，唯一常规更新途径是"tbody 整体重渲染"。
  //   凡跳过整体重渲染的条件（hasCache 为空 / 竞态 / 外部直接调用）都由这里兜住。
  // ==================================================================
  try {
    if (tb && typeof renderLostFakeSubHeaderRow === 'function') {
      var fake = tb.querySelector('tr.fake-header-row');
      if (fake) {
        var fh = renderLostFakeSubHeaderRow();
        if (fake.outerHTML !== fh) {
          fake.outerHTML = fh;
          console.warn('[lost-lang] fake-header-row re-stamped to', CUR_LANG);
        }
      }
    }
  } catch (e) { console.warn('[lost-lang] fake-header-row guard failed:', e); }

  // ==================================================================
  // ⛔ 数据行语言一致性守卫（无条件兜底）——V35 新增，与 crm_table.js 同构，
  //    根治"省份/BU/备注/失败原因(Fail Reason, LOST 独有第 47 列)切语言不即时
  //    更新、需刷新或切标签才恢复"的问题。
  // ==================================================================
  // 原理同 crm_table.js：用第一个"省份/BU 非空"的数据行做语言指纹校验——
  // DOM 文本 ≠ 当前语言预期渲染值 → 强制整体重渲染（失败原因列随同一次
  // innerHTML 重渲染一并按 getFailReasonDisplay 刷新）；刚渲染过则指纹一致，
  // 零开销跳过。
  // 判断依据【渲染语言戳】（V36 升级，与 crm_table.js 同款，替代 V35 的 DOM 文本指纹）：
  // tbody 当前 HTML 是 __lostRenderLang 时渲染的，若它与 CUR_LANG 不同 → 数据列
  // （省份/BU/备注/失败原因…）必然是旧语言 → 强制整体重渲染。
  // 不依赖 data-col 索引 / 行序与数据序一致 / provinceDisplay 返回值形态。
  try {
    if (tb && hasCache && typeof renderLostData === 'function') {
      var _renderLang = window.__lostRenderLang;
      if (_renderLang !== undefined && _renderLang !== CUR_LANG) {
        console.warn('[lost-lang] data rows stale (rendered in ' + _renderLang + ', now ' + CUR_LANG + ') -> force re-render');
        tb.innerHTML = renderLostData(globalLostData);
        if (typeof applyLostRowPerms === 'function') applyLostRowPerms();
        _lostFillMissingRemarks(tb);
      }
    }
  } catch (e) { console.warn('[lost-lang] data rows lang guard failed:', e); }
  try {
    if (LOST_REPORT_ROW && typeof refreshLostReport === 'function') refreshLostReport();
  } catch (e) { console.warn('[lost-lang] lost report refresh failed:', e); }
}

// ==================== CRUD ====================
// 删除失败项目：按决策分流（与转回潜在项目一致）
//   保留默认/特别授权 → 普通确认框（无红字）→ 直接删除，无需审批
//   发起审批 → 确认框带红字「单次生效」→ 提交单次审批，审批人通过后由轮询自动删除
function deleteLost(id) {
  var t = T();
  var dec = (typeof normDecision === 'function' && typeof curRawDecision === 'function') ? normDecision(curRawDecision('LOST-D3')) : 'def';
  var isApprove = (dec === 'approve');
  showCrmOrangeConfirm(t.lost_del_title || 'Delete Failed Project', t.lost_del_msg || 'Delete this failed project?', function() {
    if (isApprove) {
      var sentMsg = (t.user_single_use_sent || 'Single-use approval request sent. Please wait for the approver to confirm.');
      if (typeof singleUseGuard === 'function') {
        singleUseGuard('LOST-D3', String(id), t.lost_del_action || '删除失败项目', function() {
          fetchDeleteLost(id, t);   // 审批通过后自动执行
        }, null, { onSent: function() { showAlert(sentMsg); } });
      }
    } else {
      // hide 决策兜底拦截（正常情况下按钮已隐藏）
      if (typeof permVisible === 'function' && !permVisible('LOST-D3')) {
        showToast(t.user_perm_hidden || 'No permission: this module is hidden');
        return;
      }
      fetchDeleteLost(id, t);
    }
  }, isApprove ? { persist: 'single-use' } : {});
}

// 执行真正的删除接口调用
function fetchDeleteLost(id, t){
  t = t || T();
  fetch(lostApiBase() + '/api/lost-projects/' + id, {
    method: 'DELETE', credentials: 'include', headers: (typeof authHeaders==='function'?authHeaders({'Content-Type':'application/json'}):{'Content-Type':'application/json'})
  })
  .then(function(r){ return r.json(); })
  .then(function(res) {
    if (res && (res.ok || res.status === 'ok')) { showSaveOk(t.crm_del_ok || 'Deleted'); loadLost(); }
    else { showAlert('Error: ' + ((res && res.message) || 'Failed')); }
  })
  .catch(function() { showAlert('Network error'); });
}

function viewLost(id) { if (typeof permGuard === 'function' && !permGuard('LOST-D1')) return; openLostReport(id); }

// 执行真正的"转回至潜在项目"接口调用
function fetchRestoreLost(id, t){
  t = t || T();
  fetch(lostApiBase() + '/api/lost-projects/' + id + '/restore', {
    method: 'POST', credentials: 'include', headers: (typeof authHeaders==='function'?authHeaders({'Content-Type':'application/json'}):{'Content-Type':'application/json'})
  })
  .then(function(r){ return r.json(); })
  .then(function(res) {
    if (res && res.ok) { showSaveOk(t.lostRestoreOk || 'Restored'); loadLost(); }
    else { showAlert('Error: ' + ((res && res.message) || 'Failed')); }
  })
  .catch(function() { showAlert('Network error'); });
}

function restoreLost(id) {
  var t = T();
  // 按决策分流（与 CRM-F1 对称）：
  //   保留默认/特别授权 → 确认框（无红字）→ 直接转回 → 提示「已转回」
  //   发起审批 → 确认框（红字单次提示）→ 提交单次审批 → 橙色对话框「申请已发送」
  //             → 审批人（如 tom）待审 → 通过后由轮询自动执行转回
  var dec = (typeof normDecision === 'function' && typeof curRawDecision === 'function') ? normDecision(curRawDecision('LOST-R1')) : 'def';
  var isApprove = (dec === 'approve');
  showCrmOrangeConfirm(t.lost_restore_title || 'Restore to Prospect', t.lost_restore_msg || 'Move this project back to potential projects?', function() {
    if (isApprove) {
      var sentMsg = (t.lost_restore_apply_sent || '申请转回至潜在项目已经发送，请等待审批！') + '\n' + (t.confirm_single_use || '本次申请为单次生效，下次相同操作仍需重新申请！');
      if (typeof singleUseGuard === 'function') {
        singleUseGuard('LOST-R1', String(id), t.lost_restore_action || '转回至潜在项目', function() {
          fetchRestoreLost(id, t);   // 审批通过后自动执行
        }, null, { onSent: function() { showAlert(sentMsg); } });
      }
    } else {
      // hide 决策兜底拦截
      if (typeof permVisible === 'function' && !permVisible('LOST-R1')) {
        showToast(t.user_perm_hidden || 'No permission: this module is hidden');
        return;
      }
      fetchRestoreLost(id, t);
    }
  }, isApprove ? { persist: 'single-use' } : {});
}

// ==================== Excel 导出（与签约项目一致：确认弹窗 + XLSX） ====================
function exportLostToExcel() {
  if (typeof permGuard === 'function' && !permGuard('LOST-E1')) return;
  var t = T();
  if (!globalLostData || globalLostData.length === 0) { (window.showAlert||alert)(t.noData); return; }
  window.__exportCtx = 'lost';
  openExportConfirm();
}

// 构建失败项目 Excel 数据（确认后调用）
function buildLostExcelData() {
  var t = T();
  var rows = [['#', t.crm_quote_no, t.crm_project_name, t.crm_province, t.crm_customer, t.crm_bu,
    t.crm_manager, t.crm_manager_phone, t.crm_construction, t.crm_startup_pct, t.crm_sign_pct,
    t.crm_initial_quote_date, t.crm_est_purchase_date, t.crm_est_ship_date, t.crm_quote_version, t.crm_last_quote_date,
    t.crm_rate_rmb_vnd, t.crm_rate_usd_vnd, t.crm_incoterm,
    'Q1 RMB','Q1 USD','Q1 VND','Q2 RMB','Q2 USD','Q2 VND','Q3 RMB','Q3 USD','Q3 VND',
    'Q4 RMB','Q4 USD','Q4 VND','Q5 RMB','Q5 USD','Q5 VND','Q6 RMB','Q6 USD','Q6 VND',
    'Q7 RMB','Q7 USD','Q7 VND', t.crm_install_quoted,
    t.crm_pdf_equip, t.crm_pdf_install, t.crm_pdf_both,
    t.crm_salesperson, t.crm_remark, (t.won_fail_reason || '失败原因')]];
  globalLostData.forEach(function(p, i) {
    rows.push([
      i + 1, p.quote_no, p.project_name, p.province, p.customer, p.bu,
      p.manager, p.manager_phone, constructionDisplay ? constructionDisplay(p.construction) : p.construction,
      p.startup_pct, p.sign_pct,
      p.initial_quote_date, p.est_purchase_date, p.est_ship_date, p.quote_version, p.last_quote_date,
      p.rate_rmb_vnd, p.rate_usd_vnd, p.incoterm,
      p.q1_rmb, p.q1_usd, p.q1_vnd, p.q2_rmb, p.q2_usd, p.q2_vnd, p.q3_rmb, p.q3_usd, p.q3_vnd,
      p.q4_rmb, p.q4_usd, p.q4_vnd, p.q5_rmb, p.q5_usd, p.q5_vnd, p.q6_rmb, p.q6_usd, p.q6_vnd,
      p.q7_rmb, p.q7_usd, p.q7_vnd,
      p.install_quoted,
      p.pdf_equip || '', p.pdf_install || '', p.pdf_both || '',
      p.salesperson, p.remark, getFailReasonDisplay(p.fail_reason)
    ]);
  });
  return rows;
}

// ==================== 十字高亮 ====================
function bindLostCrossHighlight() {
  var tbody = document.getElementById('lostTbody');
  if (!tbody) return;
  if (window.__lostCrossBound) return;
  window.__lostCrossBound = true;
  tbody.addEventListener('mouseover', onLostCrossOver);
  tbody.addEventListener('mouseout', onLostCrossOut);
  tbody.addEventListener('mouseover', onLostSumOver);
  tbody.addEventListener('mouseout', onLostSumOut);
}

var __lostSumTip = null;
function onLostSumOver(e) {
  var td = e.target.closest('td');
  if (!td) return;
  var tr = td.closest('tr');
  if (!tr || !tr.classList.contains('fake-header-row')) { hideLostSumTip(); return; }
  var colIdx = parseInt(td.dataset.col, 10);
  if (isNaN(colIdx) || colIdx < 20 || colIdx > 40) { hideLostSumTip(); return; }
  var q = Math.floor((colIdx - 20) / 3) + 1;
  var kind = (colIdx - 20) % 3;
  var key = 'q' + q + '_' + ['rmb', 'usd', 'vnd'][kind];
  var sum = 0;
  (globalLostData || []).forEach(function(row) { sum += Number(row[key]) || 0; });
  var t = T();
  var sumLabel = (t && t['crm_sum_q' + q]) ? t['crm_sum_q' + q] : ('Q' + q + ' Total');
  var sym = (kind === 0 ? '¥' : (kind === 1 ? '$' : '₫'));
  hideLostSumTip();
  var tip = document.createElement('div');
  tip.className = 'won-sum-tooltip';
  tip.textContent = sumLabel + ': ' + sym + ' ' + sum.toLocaleString('en-US');
  document.body.appendChild(tip);
  __lostSumTip = tip;
  var rect = td.getBoundingClientRect();
  var left = rect.right + 6;
  var top = rect.top + (rect.height / 2);
  if (left + 160 > window.innerWidth) left = rect.left - tip.offsetWidth - 6;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function onLostSumOut() { hideLostSumTip(); }
function hideLostSumTip() { if (__lostSumTip) { __lostSumTip.remove(); __lostSumTip = null; } }

function onLostCrossOver(e) {
  var td = e.target.closest('td');
  if (!td) return;
  var tr = td.closest('tr');
  if (!tr) return;
  if (tr.classList.contains('fake-header-row')) { clearLostCross(); return; }
  if (tr.closest('thead')) { clearLostCross(); return; }
  var col = td.dataset.col; if (col === undefined) return;
  tr.querySelectorAll('td').forEach(function(c) { c.classList.add('row-hl'); });
  document.querySelectorAll('#lostTbody td[data-col="' + col + '"]').forEach(function(c) {
    if (c.closest('tr.fake-header-row')) return;
    c.classList.add('col-hl');
    if (c.closest('tr') === tr) c.classList.add('cross-hl');
  });
}
function onLostCrossOut(e) {
  var td = e.target.closest('td'); if (!td) return;
  var tr = td.closest('tr'); if (!tr || tr.classList.contains('fake-header-row')) return;
  var col = td.dataset.col; if (col === undefined) return;
  tr.querySelectorAll('td').forEach(function(c) { c.classList.remove('row-hl'); });
  document.querySelectorAll('#lostTbody td[data-col="' + col + '"]').forEach(function(c) {
    c.classList.remove('col-hl', 'cross-hl');
  });
}
function clearLostCross() {
  document.querySelectorAll('#lostTbody td.row-hl,#lostTbody td.col-hl,#lostTbody td.cross-hl')
    .forEach(function(c) { c.classList.remove('row-hl', 'col-hl', 'cross-hl'); });
}

// ==================== 失败项目报告 (Report) ====================
var LOST_REPORT_CUR = 'RMB';
var LOST_REPORT_ROW = null;
var LOST_REPORT_CHARTS = [];

function findLostRow(id) {
  var list = (typeof globalLostData !== 'undefined') ? globalLostData : [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(id)) return list[i];
  }
  return null;
}

function openLostReport(id) {
  var t = T();
  var row = findLostRow(id);
  if (!row) { showAlert(t.crm_not_found || 'Project not found'); return; }
  LOST_REPORT_ROW = row;
  LOST_REPORT_CUR = 'RMB';
  var modal = el('lostReportModal');
  if (!modal) return;
  modal.style.display = 'flex';
  // 失败项目报告：标题栏可拖动移动（与 CRM 一致）
  if (typeof makeDraggable === 'function') makeDraggable('#lostReportModal', '.modal', '.modal > h2');
  el('lostReportTitle').innerText = t.lost_report_title || t.crm_report_title || 'Project Report';
  var sub = el('lostReportSub');
  sub.innerText = (row.project_name || '') + ' — ' + (row.quote_no || '');
  el('lostReportCurLabel').innerText = t.crm_report_currency || 'Currency';
  el('lostReportBtnClose').innerText = t.crm_report_close || 'Close';
  el('lostReportBtnExport').innerText = '🖨 ' + (t.btn_print || '打印');
  _lostReportRender();
  _ovLoadChartLib(function() { _lostReportCharts(); });
}

function closeLostReport() {
  var modal = el('lostReportModal');
  if (modal) modal.style.display = 'none';
  LOST_REPORT_ROW = null;
  for (var i = 0; i < LOST_REPORT_CHARTS.length; i++) {
    if (LOST_REPORT_CHARTS[i]) LOST_REPORT_CHARTS[i].destroy();
  }
  LOST_REPORT_CHARTS = [];
}

// 打印报告（与「客户付款智能报告」一致：直接调系统打印，不再走 html2canvas + jsPDF 导出）
// ⚠️ index.html 内联脚本里也有同名函数，但【本文件是后加载的外部脚本，会覆盖内联定义】，
//    所以这一份才是真正生效的实现——两处必须保持同一行为，改一处要同步改另一处。
function exportLostReportPDF(){
  if (typeof printModalById === 'function') printModalById('lostReportModal');
  else window.print();
}

// ↓ 旧版 html2canvas + jsPDF 导出实现：已停用，改名后无任何调用方（保留作历史参考）
function _legacyExportLostReportPDF() {
  var t = T();
  var body = document.getElementById('lostReportBody');
  var btn = document.getElementById('lostReportBtnExport');
  if (!body) { showAlert(t.crm_report_pdf_failed || 'PDF export failed'); return; }
  if (btn) btn.disabled = true;
  function getJsPDF() {
    if (typeof jsPDF !== 'undefined') return jsPDF;
    if (typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    return null;
  }
  function doExport() {
    var pdfClass = getJsPDF();
    if (!pdfClass) { showAlert(t.crm_report_pdf_load_err || 'PDF library failed to load.'); if (btn) btn.disabled = false; return; }
    var titleText = document.getElementById('lostReportTitle').innerText || 'Project Report';
    var origBodyOverflow = body.style.overflow;
    var origBodyMaxH = body.style.maxHeight;
    var origBodyH = body.style.height;
    body.scrollTop = 0;
    body.style.overflow = 'visible';
    body.style.maxHeight = 'none';
    body.style.height = 'auto';
    setTimeout(function() {
      html2canvas(body, { scale: 1, useCORS: true, backgroundColor: '#fff' }).then(function(canvas) {
        body.style.overflow = origBodyOverflow;
        body.style.maxHeight = origBodyMaxH;
        body.style.height = origBodyH;
        var pageW = 210, pageH = 297;
        var imgData = canvas.toDataURL('image/png');
        var imgW = canvas.width, imgH = canvas.height;
        var availH = pageH - 20, availW = pageW - 20;
        var ratio = Math.min(availW / (imgW / 2), availH / (imgH / 2));
        var scaledW = imgW * ratio / 2, scaledH = imgH * ratio / 2;
        var pdf = new pdfClass({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var pageCount = Math.ceil(scaledH / availH);
        for (var i = 0; i < pageCount; i++) {
          if (i > 0) pdf.addPage();
          pdf.addImage(imgData, 'PNG', 10, -i * availH, scaledW, scaledH);
        }
        pdf.save(titleText.replace(/[^\w\u4e00-\u9fa5]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
        if (btn) btn.disabled = false;
        showAlert(t.crm_report_pdf_success || 'Export successful!');
      }).catch(function(e) {
        body.style.overflow = origBodyOverflow;
        body.style.maxHeight = origBodyMaxH;
        body.style.height = origBodyH;
        showAlert((t.crm_report_pdf_failed || 'PDF export failed: ') + e.message);
        if (btn) btn.disabled = false;
      });
    }, 100);
  }
  if (typeof html2canvas !== 'undefined' && getJsPDF()) {
    doExport();
  } else {
    var scripts = [
      { src: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', name: 'html2canvas' },
      { src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', name: 'jsPDF' }
    ];
    var loaded = 0;
    scripts.forEach(function(sc) {
      var s = document.createElement('script');
      s.src = sc.src;
      s.onload = function() { loaded++; if (loaded >= 2) doExport(); };
      s.onerror = function() { showAlert(t.crm_report_pdf_load_err || 'PDF library failed to load, please check network.'); if (btn) btn.disabled = false; };
      document.head.appendChild(s);
    });
  }
}

function refreshLostReport() {
  if (!LOST_REPORT_ROW) return;
  var modal = el('lostReportModal');
  if (!modal || modal.style.display === 'none') return;
  var t = T();
  el('lostReportTitle').innerText = t.lost_report_title || t.crm_report_title || 'Project Report';
  el('lostReportCurLabel').innerText = t.crm_report_currency || 'Currency';
  el('lostReportBtnClose').innerText = t.crm_report_close || 'Close';
  el('lostReportBtnExport').innerText = '🖨 ' + (t.btn_print || '打印');
  _lostReportRender();
  if (typeof Chart !== 'undefined') _lostReportCharts();
}

function _lostReportRender() {
  var t = T();
  var row = LOST_REPORT_ROW;
  var cur = LOST_REPORT_CUR;
  var esc = function(v) { return String(v == null ? '' : v); };
  var date = function(v) { return (typeof ymdToDmy === 'function') ? ymdToDmy(v) : (v || ''); };
  var pct = function(v) { return (v == null || v === '') ? '' : String(v) + '%'; };
  var yesNo = function(v) {
    var sv = (v == null ? '' : String(v)).toLowerCase();
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
  var qs = [
    { k: 'q1', lbl: t.crm_q1 || 'Q1' }, { k: 'q2', lbl: t.crm_q2 || 'Q2' },
    { k: 'q3', lbl: t.crm_q3 || 'Q3' }, { k: 'q4', lbl: t.crm_q4 || 'Q4' },
    { k: 'q5', lbl: t.crm_q5 || 'Q5' }, { k: 'q6', lbl: t.crm_q6 || 'Q6' },
    { k: 'q7', lbl: t.crm_q7 || 'Q7' }
  ];
  var curKey = cur.toLowerCase();
  var html = '';

  html += section(t.crm_report_sec_basic || 'Project Basic Info');
  html += '<div class="crm-rep-grid">';
  html += field(t.crm_quote_no || 'Quote No.', esc(row.quote_no));
  html += field(t.crm_project_name || 'Project Name', esc(row.project_name));
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

  html += section(t.crm_report_sec_progress || 'Project Progress');
  html += '<div class="crm-rep-grid">';
  var consDisp = (typeof constructionDisplay === 'function') ? constructionDisplay(row.construction) : esc(row.construction);
  html += field(t.crm_construction || 'Construction', esc(consDisp));
  html += field(t.crm_startup_pct || 'Startup Prob.%', pct(row.startup_pct));
  html += field(t.crm_sign_pct || 'Sign Prob.%', pct(row.sign_pct));
  html += field(t.crm_initial_quote_date || 'Initial Quote Date', date(row.initial_quote_date));
  html += field(t.crm_est_purchase_date || 'Est. Purchase Date', date(row.est_purchase_date));
  html += field(t.crm_est_ship_date || 'Est. Ship Date', date(row.est_ship_date));
  html += field(t.crm_quote_version || 'Quote Version', esc(row.quote_version));
  html += field(t.crm_last_quote_date || 'Last Quote Date', date(row.last_quote_date));
  html += '</div>';

  html += section(t.crm_report_sec_quote || 'Quotation');
  html += '<div class="crm-rep-grid">';
  var fmtRate = function(v) { var n = Number(v); return (isFinite(n) && n !== 0) ? n.toLocaleString('en-US') : (v == null || v === '' ? '—' : esc(v)); };
  html += field(t.crm_report_rate || 'Exchange Rate at Quote', 'RMB/VND ' + fmtRate(row.rate_rmb_vnd) + ' | USD/VND ' + fmtRate(row.rate_usd_vnd));
  html += field(t.crm_report_incoterm || 'Incoterms', esc(row.incoterm));
  html += field(t.crm_report_install_quoted || 'Install Quoted?', yesNo(row.install_quoted));
  html += '</div>';

  html += '<div class="crm-rep-price-title">' + (t.crm_report_price_detail || 'Price Details') + ' (' + cur + ')</div>';
  html += '<table class="crm-rep-table"><thead><tr>';
  html += '<th>' + (t.crm_report_unit || 'Amount') + '</th>';
  for (var i = 0; i < qs.length; i++) { html += '<th>' + qs[i].lbl + '</th>'; }
  html += '</tr></thead><tbody><tr>';
  html += '<td class="crm-rep-td-label">' + cur + '</td>';
  var sv = (row.install_quoted == null ? '' : String(row.install_quoted)).toLowerCase();
  var installNo = (row.install_quoted === false || row.install_quoted === 0 || sv === '0' || sv === 'no' || sv === 'n' || sv === 'false' || sv === '否');
  var curSym = (typeof crmCurSym === 'function') ? crmCurSym(cur) : '';
  for (var j = 0; j < qs.length; j++) {
    var q = qs[j];
    var val = row[q.k + '_' + curKey];
    var num = (typeof moneyToNumber === 'function') ? moneyToNumber(val) : (Number(val) || 0);
    if (q.k === 'q6' && installNo) num = 0;
    var amt = (num == null || num === '') ? '' : (num === 0 ? curSym + ' 0' : crmCurFmt(num, cur));
    html += '<td class="crm-rep-td-amt">' + amt + '</td>';
  }
  html += '</tr></tbody></table>';

  html += '<div class="crm-rep-charts">';
  html += '<div class="crm-rep-chart-box"><div class="crm-rep-chart-title">' + (t.crm_report_chart_bar || 'Bar Chart (Q1-Q6)') + '</div><canvas id="lostRepBar"></canvas></div>';
  html += '<div class="crm-rep-chart-box"><div class="crm-rep-chart-title">' + (t.crm_report_chart_pie || 'Pie Chart (Q1-Q6)') + '</div><canvas id="lostRepPie"></canvas></div>';
  html += '</div>';

  // 失败原因区块（放报告最末尾）：内容与 CRM 报告完全一致，仅末尾多此一块——
  // 将来「转回潜在项目」时删除本段即可完全还原为 CRM 报告
  html += section((t.won_fail_reason || '失败原因'));
  html += '<div class="crm-rep-grid">';
  html += field(t.won_fail_reason || '失败原因', esc(getFailReasonDisplay(row.fail_reason)));
  html += '</div>';

  el('lostReportBody').innerHTML = html;
  _lostReportSetCurBtns();
}

function _lostReportSetCurBtns() {
  var cur = LOST_REPORT_CUR;
  ['RMB', 'USD', 'VND'].forEach(function(c) {
    var b = el('lostReportCur' + c);
    if (b) b.classList.toggle('btn-primary', c === cur);
  });
}

function lostReportSetCur(cur) {
  if (!LOST_REPORT_ROW) return;
  LOST_REPORT_CUR = cur;
  _lostReportRender();
  if (typeof Chart !== 'undefined') _lostReportCharts();
}

function _lostReportCharts() {
  for (var i = 0; i < LOST_REPORT_CHARTS.length; i++) {
    if (LOST_REPORT_CHARTS[i]) LOST_REPORT_CHARTS[i].destroy();
  }
  LOST_REPORT_CHARTS = [];
  var row = LOST_REPORT_ROW;
  var cur = LOST_REPORT_CUR;
  var curKey = cur.toLowerCase();
  var t = T();
  var labels = [t.crm_q1 || 'Q1', t.crm_q2 || 'Q2', t.crm_q3 || 'Q3', t.crm_q4 || 'Q4', t.crm_q5 || 'Q5', t.crm_q6 || 'Q6'];
  var keys = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
  var sv = (row.install_quoted == null ? '' : String(row.install_quoted)).toLowerCase();
  var installNo = (row.install_quoted === false || row.install_quoted === 0 || sv === '0' || sv === 'no' || sv === 'n' || sv === 'false' || sv === '否');
  var data = keys.map(function(k) {
    var val = row[k + '_' + curKey];
    var num = (typeof moneyToNumber === 'function') ? moneyToNumber(val) : (Number(val) || 0);
    if (k === 'q6' && installNo) num = 0;
    return num;
  });
  var colors = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

  var bar = _ovMakeChart('lostRepBar', {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: (t.crm_report_unit || 'Amount') + ' (' + cur + ')', data: data, backgroundColor: colors, borderColor: colors, borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        ovDataLabels: { symbol: (typeof crmCurSym === 'function') ? crmCurSym(cur) : '$' }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return v.toLocaleString('en-US'); } } } }
    }
  });
  if (bar) LOST_REPORT_CHARTS.push(bar);

  var pie = _ovMakeChart('lostRepPie', {
    type: 'pie',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderColor: '#fff', borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        datalabels: { display: false },
        ovPieLabels: { symbol: (typeof crmCurSym === 'function') ? crmCurSym(cur) : '$' }
      }
    }
  });
  if (pie) LOST_REPORT_CHARTS.push(pie);
}

// ==================== 渲染包装器：任何 tbody 再生后自动恢复列可见性 ====================
// 与 CRM 同款：renderLostData 的 5 处调用点（加载/排序/搜索/语言切换/清空）统一挂同步钩子，
// setTimeout 0 确保在 innerHTML 写入 DOM 后执行，杜绝表头/数据错位。
(function(){
  var _orig = renderLostData;
  renderLostData = function(list){
    var html = _orig(list);
    // ★ 渲染语言戳（V36，与 crm_table.js 同款）：记下本次 tbody 渲染时用的语言。
    //   数据列（省份/BU/备注/失败原因…）显示文本在渲染那一刻由 CUR_LANG 固化进 HTML，
    //   比对此戳即可确定性判断 tbody 是否与当前语言一致。
    try { window.__lostRenderLang = (typeof CUR_LANG !== 'undefined') ? CUR_LANG : 'vi'; } catch(e) {}
    if (typeof syncLostColVisibility === 'function') setTimeout(syncLostColVisibility, 0);
    // ★ 权限兜底：任何 tbody 再生（加载/排序/搜索/语言切换/清空）后都按权限重新隐藏行内按钮，
    //   否则初始 loadLost 隐藏掉的「删除/转回」会因排序/搜索等再渲染而重新出现，造成"选了隐藏仍显示"。
    //   （查看按钮在点击时由 permGuard 实时拦截，故始终有效；行内操作按钮必须在此处兜底。）
    if (typeof applyLostRowPerms === 'function') setTimeout(applyLostRowPerms, 0);
    return html;
  };
})();
