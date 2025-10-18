const MODULES = {
  batting: () => import('./batting.js'),
  pitching: () => import('./pitching.js')
};

const cache = { batting: null, pitching: null };

// 최근 렌더 상태
let lastRows = [];
let lastColumns = [];
let lastSortKeys = {};
let lastDatasetKey = "";
let currentSort = { col: null, asc: true };

// 프록시 fetch (allorigins → 실패 시 corsproxy)
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
    if (!cache[datasetKey]) {
      const json = typeof fetchData === 'function'
        ? await fetchData.call(mod.config)
        : await fetchViaProxy(endpoint);
      cache[datasetKey] = (json.data ?? []).map(mapRow);
    }

    lastRows = cache[datasetKey];
    lastColumns = columns;
    lastSortKeys = sortKeys || {};

    buildFilters(lastRows);

    const filtered = applyFilters(lastRows);
    const finallySorted = applyCurrentSort(filtered, lastSortKeys);
    renderTable(finallySorted, lastColumns, lastSortKeys);
  } catch (err) {
    console.error(" Data load error:", err);
    root.innerHTML = `<p> Failed to load data.</p>`;
  }
}

function buildFilters(rows) {
  const leagueSel = document.getElementById('leagueFilter');
  const yearSel = document.getElementById('yearFilter');
  const nameInput = document.getElementById('nameSearch');

  const prevLeague = leagueSel?.value || 'all';
  const prevYear = yearSel?.value || 'all';
  const prevName = nameInput?.value || '';

  const leagues = [...new Set(rows.map(r => r.Acronym))].filter(Boolean).sort((a,b)=>a.localeCompare(b));
  const years = [...new Set(rows.map(r => r.Season))].filter(v => v !== "-").sort((a,b)=>b-a);

  leagueSel.innerHTML = '<option value="all">All</option>' + leagues.map(l=>`<option>${l}</option>`).join('');
  yearSel.innerHTML = '<option value="all">All</option>' + years.map(y=>`<option>${y}</option>`).join('');

  leagueSel.value = prevLeague;
  yearSel.value = prevYear;
  nameInput.value = prevName;

  const rerender = () => {
    const filtered = applyFilters(lastRows);
    const finallySorted = applyCurrentSort(filtered, lastSortKeys);
    renderTable(finallySorted, lastColumns, lastSortKeys);
  };

  leagueSel.onchange = rerender;
  yearSel.onchange = rerender;

  // 이름 검색: 엔터 눌렀을 때만 적용
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      rerender();
    }
  };
}

function applyFilters(rows) {
  const league = document.getElementById('leagueFilter').value;
  const year = document.getElementById('yearFilter').value;
  const search = document.getElementById('nameSearch')?.value?.toLowerCase() || "";

  return rows.filter(r => {
    const matchLeague = (league === "all" || r.Acronym === league);
    const matchYear = (year === "all" || String(r.Season) === String(year));
    const matchName = !search || r.Name?.toLowerCase().includes(search);
    return matchLeague && matchYear && matchName;
  });
}

function applyCurrentSort(rows, sortKeys = {}) {
  if (!currentSort.col) return rows;
  const { col, asc } = currentSort;
  const keyFn = sortKeys[col];

  const clone = rows.slice();
  clone.sort((a, b) => {
    let A = a[col];
    let B = b[col];
    if (typeof keyFn === 'function') {
      A = keyFn(A); B = keyFn(B);
      if (!Number.isNaN(A) && !Number.isNaN(B)) return asc ? A - B : B - A;
    } else {
      const nA = parseFloat(A), nB = parseFloat(B);
      if (!isNaN(nA) && !isNaN(nB)) return asc ? nA - nB : nB - nA;
    }
    return asc ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
  });
  return clone;
}

function renderTable(rows, columns, sortKeys = {}) {
  const root = document.getElementById('table-root');
  if (!rows.length) { root.innerHTML = "<p>No data found.</p>"; return; }

  const headerHtml = columns.map(c => {
    const cls = ["sortable"];
    if (currentSort.col === c) cls.push(currentSort.asc ? "asc" : "desc");
    return `<th class="${cls.join(' ')}" data-col="${c}">${c}</th>`;
  }).join('');

  const html = `
    <table id="statsTable">
      <thead><tr>${headerHtml}</tr></thead>
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
      if (currentSort.col === col) currentSort.asc = !currentSort.asc;
      else { currentSort.col = col; currentSort.asc = true; }

      const rows = Array.from(table.tBodies[0].rows).map(tr => {
        const obj = {};
        lastColumns.forEach((c, idx) => obj[c] = tr.cells[idx].innerText.trim());
        return obj;
      });

      const finallySorted = applyCurrentSort(rows, sortKeys);
      renderTable(finallySorted, lastColumns, sortKeys);
    });
  });
}
