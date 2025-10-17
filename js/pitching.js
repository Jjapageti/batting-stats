function ipSortKey(display) {
  const m = String(display ?? "").trim().match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return Number.NEGATIVE_INFINITY;
  const whole = +m[1], frac = +(m[2] ?? 0);
  return whole + (frac === 1 ? 1 / 3 : frac === 2 ? 2 / 3 : 0);
}

export const config = {
  endpoint: "https://bsm.baseball-softball.de/clubs/492/statistics/pitching.json",

  columns: [
    "Name", "League", "Acronym", "Season", "Age",
    "G", "GS", "IP", "BF", "H", "R", "ER", "HR",
    "BB", "IBB", "HBP", "SO", "WP", "BK", "CG",
    "W", "L", "SV", "ERA", "WHIP"
  ],

  // ✅ 안정형 fetch (AllOrigins → 실패 시 corsproxy.io로 fallback)
  async fetchData() {
    const apiUrl = this.endpoint;
    try {
      const u1 = "https://api.allorigins.win/raw?url=" + encodeURIComponent(apiUrl);
      const r1 = await fetch(u1);
      if (!r1.ok) throw new Error("allorigins failed " + r1.status);
      return await r1.json();
    } catch (e) {
      console.warn("⚠️ allorigins failed, fallback to corsproxy:", e.message);
      const u2 = "https://corsproxy.io/?" + encodeURIComponent(apiUrl);
      const r2 = await fetch(u2);
      if (!r2.ok) throw new Error("corsproxy failed " + r2.status);
      return await r2.json();
    }
  },

  // 📊 데이터 매핑
  mapRow: (p) => {
    const v = p.values ?? {}, lg = p.league ?? {}, gc = lg.game_class ?? {};
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
      R: v.runs ?? 0,
      ER: v.earned_runs ?? 0,
      HR: v.homeruns ?? 0,
      BB: v.base_on_balls_allowed ?? 0,
      IBB: v.intentional_base_on_balls ?? 0,
      HBP: v.hit_by_pitches ?? 0,
      SO: v.strikeouts ?? 0,
      WP: v.wild_pitches ?? 0,
      BK: v.balks ?? 0,
      CG: v.complete_games ?? 0,
      W: v.wins ?? 0,
      L: v.losses ?? 0,
      SV: v.saves ?? 0,
      ERA: v.earned_runs_average ?? "-",
      WHIP: v.walks_and_hits_per_innings_pitched ?? "-"
    };
  },

  sortKeys: { IP: ipSortKey }
};
