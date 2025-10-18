// js/batting.js

// ---------- 공용 프록시 fetch ----------
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

// ---------- 지표 계산 헬퍼 ----------
function safeNum(v, d = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

// wOBA (간이 계수: HBP/SF 미제공 → AB+BB로 단순화)
function computeWobaFromValues(v) {
  const AB = safeNum(v?.at_bats);
  const H  = safeNum(v?.hits);
  const _2B = safeNum(v?.doubles);
  const _3B = safeNum(v?.triples);
  const HR  = safeNum(v?.homeruns);
  const BB  = safeNum(v?.base_on_balls);
  const _1B = Math.max(0, H - _2B - _3B - HR);
  const denom = AB + BB;
  if (denom <= 0) return 0;
  return ((0.69 * BB) + (0.89 * _1B) + (1.27 * _2B) + (1.62 * _3B) + (2.10 * HR)) / denom;
}

// OPS 읽기(문자열일 수 있음). 없으면 OBP+SLG로 계산
function getOPS(v) {
  let ops = safeNum(v?.on_base_plus_slugging, NaN);
  if (Number.isNaN(ops)) {
    const obp = safeNum(v?.on_base_percentage);
    const slg = safeNum(v?.slugging_percentage);
    ops = obp + slg;
  }
  return ops;
}

// PA 근사 (HBP, SF 미제공 → AB + BB 사용)
const getPA = (v) => safeNum(v?.at_bats) + safeNum(v?.base_on_balls);

// ---------- 리그별 메트릭 캐시 ----------
// league.id -> { lgWoba, lgOPS, lgRperPA }
const leagueMetricsCache = {};

export const config = {
  endpoint: "https://bsm.baseball-softball.de/clubs/492/statistics/batting.json",

  columns: [
    "Name","League","Acronym","Season","Age",
    "G","AB","R","RBI","H","2B","3B","HR","BB","K",
    "AVG","OBP","SLG","OPS","OPS+","wRC+","WAR"
  ],

  async fetchData() {
    // 1) 클럽 데이터
    const clubJson = await fetchViaProxy(this.endpoint);
    const clubData = clubJson?.data ?? [];

    // 2) club 안에서 등장한 모든 league.id 수집 (캐시에 없는 것만)
    const leagueIds = [...new Set(
      clubData.map(p => p?.league?.id).filter(Boolean)
    )].filter(id => !(id in leagueMetricsCache));

    // 3) 각 리그 평균 계산 (병렬)
    await Promise.all(leagueIds.map(async (id) => {
      const url = `https://bsm.baseball-softball.de/league_groups/${id}/statistics/batting.json`;
      const json = await fetchViaProxy(url);
      const arr = json?.data ?? [];

      let wobaSum = 0, wobaDen = 0;      // wOBA 평균 (AB+BB 가중)
      let opsSum  = 0, opsDen  = 0;      // OPS 평균 (AB+BB 가중)
      let totR    = 0, totPA   = 0;      // 리그 총 득점·PA (oWAR용)

      for (const row of arr) {
        const v = row?.values ?? {};
        const AB = safeNum(v.at_bats);
        const BB = safeNum(v.base_on_balls);
        const H  = safeNum(v.hits);
        const _2B = safeNum(v.doubles);
        const _3B = safeNum(v.triples);
        const HR  = safeNum(v.homeruns);
        const PA  = AB + BB;

        // wOBA (간이)
        const _1B = Math.max(0, H - _2B - _3B - HR);
        const denom = AB + BB;
        if (denom > 0) {
          const woba = ((0.69 * BB) + (0.89 * _1B) + (1.27 * _2B) + (1.62 * _3B) + (2.10 * HR));
          wobaSum += woba;
          wobaDen += denom;
        }

        // OPS (가중 평균)
        const ops = getOPS(v);
        if (PA > 0 && Number.isFinite(ops)) {
          opsSum += ops * PA;
          opsDen += PA;
        }

        // 리그 득점/PA (공격 WAR에 사용)
        totR  += safeNum(v.runs);
        totPA += PA;
      }

      const lgWoba   = wobaDen > 0 ? (wobaSum / wobaDen) : 0;
      const lgOPS    = opsDen  > 0 ? (opsSum  / opsDen ) : 0;
      const lgRperPA = totPA   > 0 ? (totR    / totPA   ) : 0;

      leagueMetricsCache[id] = { lgWoba, lgOPS, lgRperPA };
    }));

    return clubJson; // shared.js 파이프라인 유지
  },

  mapRow: (p) => {
    const v  = p.values ?? {};
    const lg = p.league ?? {};
    const metrics = leagueMetricsCache[lg.id] || { lgWoba:0, lgOPS:0, lgRperPA:0 };

    // 개인 지표
    const AB  = safeNum(v.at_bats);
    const H   = safeNum(v.hits);
    const _2B = safeNum(v.doubles);
    const _3B = safeNum(v.triples);
    const HR  = safeNum(v.homeruns);
    const BB  = safeNum(v.base_on_balls);
    const K   = safeNum(v.strikeouts);
    const PA  = AB + BB;

    const AVG = v.batting_average ?? "-";
    const OBP = v.on_base_percentage ?? "-";
    const SLG = v.slugging_percentage ?? "-";
    const OPS = Number.isFinite(getOPS(v)) ? getOPS(v).toFixed(3) : "-";

    // wRC+ (간이 wOBA 비율)
    const wobaPlayer = computeWobaFromValues(v);
    const wRCplus = (metrics.lgWoba > 0 && wobaPlayer > 0)
      ? Math.round((wobaPlayer / metrics.lgWoba) * 100)
      : "-";

    // OPS+ (가중 평균 OPS 대비)
    const opsNum = getOPS(v);
    const OPSplus = (metrics.lgOPS > 0 && Number.isFinite(opsNum) && opsNum > 0)
      ? Math.round(100 * (opsNum / metrics.lgOPS))
      : "-";

    /**
     * (간이) oWAR: 공격 WAR 근사
     * - RAA ≈ (OPS+ - 100)/100 * (lgR/PA) * PA
     * - Rrep ≈ -20 * (PA / 600)           (대체수준: 600PA당 -20점 가정)
     * - rPW  = 10                          (고정 근사)
     * - WAR  = (RAA + Rrep) / rPW
     */
    let WAR = "-";
    if (OPSplus !== "-" && metrics.lgRperPA > 0 && PA > 0) {
      const RAA  = ((OPSplus - 100) / 100) * metrics.lgRperPA * PA;
      const Rrep = -20 * (PA / 600);
      const rPW  = 10;
      WAR = ((RAA + Rrep) / rPW).toFixed(2);
    }

    return {
      Name: `${p.person?.first_name ?? ""} ${p.person?.last_name ?? ""}`.trim(),
      League: lg.name ?? "-",
      Acronym: lg.acronym ?? "-",
      Season: lg.season ?? "-",
      Age: lg.human_age_group_short ?? "-",
      G: safeNum(v.games),
      AB, R: safeNum(v.runs), RBI: safeNum(v.runs_batted_in), H,
      "2B": _2B, "3B": _3B, HR, BB, K,
      AVG, OBP, SLG, OPS,
      "OPS+": OPSplus,
      "wRC+": wRCplus,
      "WAR": WAR
    };
  },

  sortKeys: {
    "OPS":  (v) => parseFloat(v) || 0,
    "OPS+": (v) => parseFloat(v) || 0,
    "wRC+": (v) => parseFloat(v) || 0,
    "WAR":  (v) => parseFloat(v) || 0
  }
};
