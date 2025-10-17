// js/shared.js
const MODULES = {
  batting: () => import('./batting.js'),
  pitching: () => import('./pitching.js')
};

const cache = { batting: null, pitching: null };

// 최근 렌더 상태(필터만 다시 그릴 때 사용)
let lastRows = [];
let lastColumns = [];
let lastSortKeys = {};
let lastDatasetKey = "";

// 공용: 프록시(fetch) (allorigins → 실패 시 corsproxy)
async function fetchViaProxy(apiUrl) {
  try {
    const u1 = "https://api.allorigins.win/raw?url=" + encodeURIComponent(apiUrl);
    const r1 = await fetch(u1);
    if (!r1.ok) throw new Error("allorigins failed " + r1.status);
    return await r1.json();
  } catch (_) {
    const u2 = "https://corsproxy.io/?" + encodeURIComponent(apiUrl);
    const r2 = await fetch(u2);
    if (!r2.ok) throw new Error("corsproxy failed " + r2.status);
    return await r2.json();
  }
}

export async function renderApp(datasetKey) {
  lastDatasetKey = datasetKey;

  const mod = await MODULES[datasetKey]();
  const { endpoint, columns, mapRow, sortKeys, fetchData } = mod.config;

  const root = document.getElementById('table-root');
  root.innerHTML = "Loading...";

  try {
    // 데이터 캐싱
    if (!cache[datasetKey]) {
      const json = typeof fetchData === 'function'
        ? await fetchData.call(mod.config) // this.endpoint 보존
        : await fetchViaProxy(endpoint);

      cache[datasetKey] = (json.data ?? []).map(mapRow);
    }

    // 최근 상태 저장
    lastRows = cache[datasetKey];
    lastColumns = columns;
    lastSortKeys = sortKeys || {};

    // 필터 UI(옵션) 구성 + 현재 선택값 보존
    buildFilters(lastRows);

    // 현재 필터값으로 렌더
    const filtered = applyFilters(lastRows);
    renderTable(filtered, lastColumns, lastSortKeys);
  } catch (err) {
    console.error("❌ Data load error:", err);
    root.innerHTML = `<p>❌ Failed to load data.</p>`;
  }
}

// 필터 옵션 구성(이전 선택값 보존)
function buildFilters(rows) {
  const leagueSel = document.getElementById('leagueFilter');
  const yearSel = document.getElementById('yearFilter');

  const prevLeague = leagueSel?.value || 'all';
  const prevYear = yearSel?.value || 'all';

  const leagues = [...new Set(rows.map(r => r.Acronym))].filter(Boolean).sort();
  const years = [...new Set(rows.map(r => r.Season))].filter(v => v !== "-").sort((a,b)=>b-a);

  leagueSel.innerHTML =
    '<option value="all">All</option>' +
    leagues.map(l=>`<option value="${l}">${l}</option>`).join('');

  yearSel.innerHTML =
    '<option value="all">All</option>' +
    years.map(y=>`<option value="${y}">${y}</option>`).join('');

  // 이전 선택 복원(옵션에 있을 때만)
  if ([...leagueSel.options].some(o=>o.value===prevLeague)) leagueSel.value = prevLeague;
  if ([...yearSel.options].some(o=>o.value===prevYear)) yearSel.value = prevYear;

  // ▷ 필터 변경 시 "전체 리렌더 X" —> 캐시 기반으로 테이블만 갱신
  leagueSel.onchange = () => {
    const filtered = applyFilters(lastRows);
    renderTable(filtered, lastColumns, lastSortKeys);
  };
  yearSel.onchange = () => {
    const filtered = applyFilters(lastRows);
    renderTable(filtered, lastColumns, lastSortKeys);
  };
}

function applyFilters(rows) {
  const league = document.getElementById('leagueFilter').value;
  const year = document.getElementById('yearFilter').value;

  return rows.filter(r =>
    (league === "all" || r.Acronym === league) &&
    (year === "all" || String(r.Season) === String(year))
  );
}

function renderTable(rows, columns, sortKeys = {}) {
  const root = document.getElementById('table-root');
  if (!rows.length) { root.innerHTML = "<p>No data found.</p>"; return; }

  const html = `
    <table id="statsTable">
      <thead><tr>${columns.map(c=>`<th class="sortable" data-col="${c}">${c}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `
        <tr>${columns.map(c=>`<td>${r[c] ?? ''}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
  root.innerHTML = html;
  makeTableSortable(document.getElementById('statsTable'), sortKeys);
}

function makeTableSortable(table, sortKeys = {}) {
  table.querySelectorAll("th").forEach((th,i) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      const asc = th.classList.toggle("asc");
      const rows = Array.from(table.tBodies[0].rows);
      const keyFn = sortKeys[col];

      rows.sort((a,b) => {
        let A = a.cells[i].innerText.trim();
        let B = b.cells[i].innerText.trim();

        if (typeof keyFn === 'function') {
          A = keyFn(A);
          B = keyFn(B);
          if (!Number.isNaN(A) && !Number.isNaN(B)) {
            return asc ? A - B : B - A;
          }
        } else {
          const nA = parseFloat(A), nB = parseFloat(B);
          if (!isNaN(nA) && !isNaN(nB)) return asc ? nA - nB : nB - nA;
        }
        return asc ? A.localeCompare(B) : B.localeCompare(A);
      });

      rows.forEach(r => table.tBodies[0].appendChild(r));
    });
  });
}
