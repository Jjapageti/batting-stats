// js/pitching.js

// IP "12.1" → 12.333... 변환
function ipSortKey(display) {
  const m = String(display ?? "").trim().match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return Number.NEGATIVE_INFINITY;
  const whole = +m[1], frac = +(m[2] ?? 0);
  return whole + (frac === 1 ? 1/3 : frac === 2 ? 2/3 : 0);
}
const ipToFloat = (s) => {
  const m = String(s ?? "").trim().match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return 0;
  const whole = +m[1], frac = +(m[2] ?? 0);
  return whole + (frac === 1 ? 1/3 : frac === 2 ? 2/3 : 0);
};

// 프록시 fetch
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

/**
 * 리그별 메트릭 캐시 (league.id -> { lgERA, lgR9, fipConst, rpw, repRA9 })
 * - lgERA: 리그 평균 ERA (ER 기반)
 * - lgR9 : 리그 평균 R/9 (실점 기반) → 환경(득점 수준) 판단용
 * - fipConst: FIP 보정 상수 (리그 평균 FIP == lgERA 되게)
 * - rpw: Runs Per Win (간단 근사)  ≈ 10 * sqrt(lgR9 / 4.5), 8~12 사이로 클램프
 * - repRA9: 대체 수준 RA9 (간단 근사) = lgR9 * 1.20  (리그보다 20% 나쁨으로 가정)
 */
const leagueMetricsCache = {};

export const config = {
  endpoint: "https://bsm.baseball-softball.de/clubs/492/statistics/pitching.json",

  columns: [
    "Name", "League", "Acronym", "Season", "Age",
    "G", "GS", "IP", "BF", "H", "R", "ER", "HR",
    "BB", "IBB", "HBP", "SO", "WP", "BK", "CG",
    "W", "L", "SV", "ERA", "WHIP", "FIP", "ERA+", "WAR"
  ],

  async fetchData() {
    // 1) 클럽 투수 데이터
    const clubJson = await fetchViaProxy(this.endpoint);
    const clubData = clubJson?.data ?? [];

    // 2) 아직 캐시에 없는 league.id만 모아서 병렬로 리그 메트릭 계산
    const leagueIds = [...new Set(clubData.map(p => p?.league?.id).filter(Boolean))]
      .filter(id => !(id in leagueMetricsCache));

    await Promise.all(leagueIds.map(async (id) => {
      const url = `https://bsm.baseball-softball.de/league_groups/${id}/statistics/pitching.json`;
      const json = await fetchViaProxy(url);
      const arr = json?.data ?? [];

      let totIP=0, totER=0, totR=0, totHR=0, totBB=0, totHBP=0, totSO=0;
      for (const p of arr) {
        const v = p?.values ?? {};
        totIP  += ipToFloat(v.innings_pitched);
        totER  += Number(v.earned_runs ?? 0);
        totR   += Number(v.runs ?? 0);
        totHR  += Number(v.homeruns ?? 0);
        totBB  += Number(v.base_on_balls_allowed ?? 0);
        totHBP += Number(v.hit_by_pitches ?? 0);
        totSO  += Number(v.strikeouts ?? 0);
      }

      const lgERA = totIP > 0 ? (totER * 9) / totIP : 0;    // ER 기반
      const lgR9  = totIP > 0 ? (totR  * 9) / totIP : 0;    // R 기반(환경)
      const fipRaw = totIP > 0
        ? ((13 * totHR) + (3 * (totBB + totHBP)) - (2 * totSO)) / totIP
        : 0;
      const fipConst = lgERA - fipRaw;

      // Runs Per Win 근사 (환경 보정). 4.5 R/9을 기준으로 스케일링, 8~12 클램프.
      const rpw = Math.min(12, Math.max(8, 10 * Math.sqrt((lgR9 || 4.5) / 4.5)));

      // 대체 수준 RA9 근사 (리그보다 20% 나쁨)
      const repRA9 = (lgR9 || lgERA) * 1.20;

      leagueMetricsCache[id] = { lgERA, lgR9, fipConst, rpw, repRA9 };
    }));

    return clubJson; // shared.js 파이프라인 유지
  },

  mapRow: (p) => {
    const v  = p.values ?? {};
    const lg = p.league ?? {};
    const gc = lg.game_class ?? {};

    const IPf = ipToFloat(v.innings_pitched);
    const ER  = Number(v.earned_runs ?? 0);
    const R   = Number(v.runs ?? 0);
    const HR  = Number(v.homeruns ?? 0);
    const BB  = Number(v.base_on_balls_allowed ?? 0);
    const HBP = Number(v.hit_by_pitches ?? 0);
    const SO  = Number(v.strikeouts ?? 0);

    const ERA_num = IPf > 0 ? (ER * 9) / IPf : 0;

    const lm = leagueMetricsCache[lg.id] || { lgERA:0, lgR9:0, fipConst:0, rpw:10, repRA9:0 };

    // FIP = ((13*HR + 3*(BB + HBP) - 2*SO) / IP) + fipConst
    const FIP_num = IPf > 0
      ? ((13 * HR) + (3 * (BB + HBP)) - (2 * SO)) / IPf + lm.fipConst
      : 0;

    // ERA+ = 100 * (lgERA / ERA)  (간이, 파크팩터 미적용)
    const ERAplus = (lm.lgERA > 0 && ERA_num > 0)
      ? Math.round(100 * (lm.lgERA / ERA_num))
      : "-";

    /**
     * 간이 FIP-WAR (Replacement Level 기준)
     * RSAR = (repRA9 - FIP) * IP / 9
     * WAR  = RSAR / rpw
     * - repRA9: 리그 환경 기반 대체 수준 RA9 (여기선 1.20 * lgR9)
     * - rpw: Runs Per Win (환경에 따라 8~12 사이)
     */
    const RSAR = IPf > 0 ? (lm.repRA9 - FIP_num) * (IPf / 9) : 0;
    const WAR_num = (IPf > 0 && lm.rpw > 0) ? (RSAR / lm.rpw) : 0;

    return {
      Name: `${p.person?.first_name ?? ""} ${p.person?.last_name ?? ""}`.trim(),
      League: lg.name ?? "-",
      Acronym: lg.acronym ?? "-",
      Season: gc.season ?? lg.season ?? "-",
      Age: gc.human_age_group_short ?? lg.human_age_group_short ?? "-",
      G: v.games ?? 0,
      GS: v.games_started ?? 0,
      IP: v.innings_pitched ?? "-",
      BF: v.batters_faced ?? 0,
      H: v.hits ?? 0,
      R, ER, HR, BB,
      IBB: v.intentional_base_on_balls ?? 0,
      HBP, SO,
      WP: v.wild_pitches ?? 0,
      BK: v.balks ?? 0,
      CG: v.complete_games ?? 0,
      W: v.wins ?? 0,
      L: v.losses ?? 0,
      SV: v.saves ?? 0,
      ERA: (v.earned_runs_average ?? (IPf > 0 ? ERA_num.toFixed(2) : "-")),
      WHIP: v.walks_and_hits_per_innings_pitched ?? "-",
      FIP: IPf > 0 ? FIP_num.toFixed(2) : "-",
      "ERA+": ERAplus,
      "WAR": IPf > 0 ? WAR_num.toFixed(2) : "-"
    };
  },

  sortKeys: {
    IP: ipSortKey,
    FIP: (v) => parseFloat(v) || 0,
    "ERA+": (v) => parseFloat(v) || 0,
    "WAR": (v) => parseFloat(v) || 0
  }
};
