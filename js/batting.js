export const config = {
  endpoint: "https://bsm.baseball-softball.de/clubs/492/statistics/batting.json",

  columns: [
    "Name", "League", "Acronym", "Season", "Age",
    "G", "AB", "R", "RBI", "H", "2B", "3B", "HR",
    "BB", "K", "AVG", "OBP", "SLG", "OPS"
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
  mapRow: (p) => ({
    Name: `${p.person?.first_name ?? ""} ${p.person?.last_name ?? ""}`.trim(),
    League: p.league?.name ?? "-",
    Acronym: p.league?.acronym ?? "-",
    Season: p.league?.season ?? "-",
    Age: p.league?.human_age_group_short ?? "-",
    G: p.values?.games ?? 0,
    AB: p.values?.at_bats ?? 0,
    R: p.values?.runs ?? 0,
    RBI: p.values?.runs_batted_in ?? 0,
    H: p.values?.hits ?? 0,
    "2B": p.values?.doubles ?? 0,
    "3B": p.values?.triples ?? 0,
    HR: p.values?.homeruns ?? 0,
    BB: p.values?.base_on_balls ?? 0,
    K: p.values?.strikeouts ?? 0,
    AVG: p.values?.batting_average ?? "-",
    OBP: p.values?.on_base_percentage ?? "-",
    SLG: p.values?.slugging_percentage ?? "-",
    OPS: p.values?.on_base_plus_slugging ?? "-"
  }),

  sortKeys: {}
};
