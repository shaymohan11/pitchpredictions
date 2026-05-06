// All data comes from ESPN public APIs — no API key required.

const CACHE_TTL = {
    SEARCH:    7 * 24 * 60 * 60 * 1000,
    TODAY:     60 * 1000,
    FIXTURES:  12 * 60 * 60 * 1000,
    H2H:       6 * 60 * 60 * 1000,
    STANDINGS: 6 * 60 * 60 * 1000,
    UPCOMING:  30 * 60 * 1000
};

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const FIN_STATUSES  = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

// ── Cache helpers ─────────────────────────────────────────────────────────────

function ck(type, id) { return `piq_${type}_${id}`; }

function fromCache(type, id) {
    const raw = localStorage.getItem(ck(type, id));
    if (!raw) return null;
    try {
        const { data, ts } = JSON.parse(raw);
        const ttl = CACHE_TTL[type];
        if (ttl === null || Date.now() - ts < ttl) return data;
        localStorage.removeItem(ck(type, id));
    } catch (_) { localStorage.removeItem(ck(type, id)); }
    return null;
}

function toCache(type, id, data) {
    try {
        localStorage.setItem(ck(type, id), JSON.stringify({ data, ts: Date.now() }));
    } catch (_) {
        Object.keys(localStorage).filter(k => k.startsWith('piq_')).slice(0, 30)
            .forEach(k => localStorage.removeItem(k));
    }
}

// ── ESPN helpers ──────────────────────────────────────────────────────────────

const ESPN_LEAGUE_NAMES = {
    'eng.1': 'Premier League',   'eng.2': 'Championship',    'eng.3': 'League One',
    'esp.1': 'La Liga',          'esp.2': 'La Liga 2',
    'ger.1': 'Bundesliga',       'ger.2': 'Bundesliga 2',
    'ita.1': 'Serie A',          'ita.2': 'Serie B',
    'fra.1': 'Ligue 1',          'fra.2': 'Ligue 2',
    'ned.1': 'Eredivisie',       'ned.2': 'Eerste Divisie',
    'por.1': 'Primeira Liga',
    'sco.1': 'Scottish Prem',    'sco.2': 'Scottish Champ',
    'tur.1': 'Süper Lig',
    'bra.1': 'Brasileirão',      'bra.2': 'Série B',
    'usa.1': 'MLS',
    'UEFA.CHAMPIONS': 'Champions League',
    'UEFA.EUROPA':    'Europa League',
    'eng.league_cup':      'EFL Cup',
    'esp.copa_del_rey':    'Copa del Rey',
    'ger.dfb_pokal':       'DFB-Pokal',
    'ita.coppa_italia':    'Coppa Italia',
    'fra.coupe_de_france': 'Coupe de France',
};

// Extra competitions to fetch alongside domestic league (all-comp form)
const EXTRA_COMPS = {
    'eng.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA', 'eng.league_cup'],
    'esp.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA', 'esp.copa_del_rey'],
    'ger.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA', 'ger.dfb_pokal'],
    'ita.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA', 'ita.coppa_italia'],
    'fra.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA', 'fra.coupe_de_france'],
    'ned.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA'],
    'por.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA'],
    'sco.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA'],
    'tur.1': ['UEFA.CHAMPIONS', 'UEFA.EUROPA'],
};

const ESPN_CODES = {
    '39':  'eng.1',  '40':  'eng.2',  '140': 'esp.1',
    '78':  'ger.1',  '135': 'ita.1',  '61':  'fra.1',
    '88':  'ned.1',  '94':  'por.1',  '179': 'sco.1',
    '203': 'tur.1',  '71':  'bra.1',  '253': 'usa.1',
    '2':   'UEFA.CHAMPIONS',           '3':   'UEFA.EUROPA',
    // secondary leagues (scoreboard only)
    '41':  'ger.2',  '136': 'ita.2',  '66':  'fra.2',
    '141': 'esp.2',  '119': 'ned.2',
};

function getScore(competitor) {
    const s = competitor?.score;
    if (!s) return null;
    if (typeof s === 'number') return Math.round(s);
    if (typeof s === 'string') return parseInt(s, 10);
    const v = s.displayValue ?? s.value;
    return v != null ? parseInt(v, 10) : null;
}

function espnCompStatusToShort(comp) {
    const st = comp?.status?.type;
    const state = st?.state || 'pre';
    if (state === 'post') return 'FT';
    if (state === 'in') {
        const detail = (st?.shortDetail || st?.description || '').toLowerCase();
        const period = comp?.status?.period || 1;
        if (detail.includes('half time') || detail.includes('halftime') || detail === 'ht') return 'HT';
        return period === 1 ? '1H' : period === 2 ? '2H' : 'LIVE';
    }
    return 'NS';
}

function espnEventToFixture(ev, leagueId, espnCode) {
    const comp  = ev.competitions?.[0];
    if (!comp) return null;
    const homeC = comp.competitors?.find(c => c.homeAway === 'home') || comp.competitors?.[0];
    const awayC = comp.competitors?.find(c => c.homeAway === 'away') || comp.competitors?.[1];
    if (!homeC || !awayC) return null;

    const short = espnCompStatusToShort(comp);
    const state = comp?.status?.type?.state || 'pre';
    const m = (comp.status?.displayClock || '').match(/^(\d+)/);
    const elapsed = m ? parseInt(m[1], 10) : null;

    return {
        fixture: { id: `espn_${ev.id}`, date: comp.date || ev.date, status: { short, elapsed } },
        league:  { id: parseInt(leagueId, 10), name: ESPN_LEAGUE_NAMES[espnCode] || espnCode, country: '', logo: '' },
        teams: {
            home: { id: `espn_${homeC.team.id}`, name: homeC.team.displayName || '', logo: homeC.team.logo || homeC.team.logos?.[0]?.href || '' },
            away: { id: `espn_${awayC.team.id}`, name: awayC.team.displayName || '', logo: awayC.team.logo || awayC.team.logos?.[0]?.href || '' },
        },
        goals: {
            home: state !== 'pre' ? (getScore(homeC) ?? 0) : null,
            away: state !== 'pre' ? (getScore(awayC) ?? 0) : null,
        },
    };
}

// Convert ESPN team schedule event → internal fixture format
function espnScheduleEventToFixture(ev, leagueCode) {
    const comp  = ev.competitions?.[0];
    if (!comp) return null;
    const homeC = comp.competitors?.find(c => c.homeAway === 'home') || comp.competitors?.[0];
    const awayC = comp.competitors?.find(c => c.homeAway === 'away') || comp.competitors?.[1];
    if (!homeC || !awayC) return null;

    const short = espnCompStatusToShort(comp);
    const state = comp?.status?.type?.state || 'pre';

    return {
        fixture: { id: `espn_${ev.id}`, date: comp.date || ev.date, status: { short, elapsed: null } },
        league:  { id: leagueCode, name: ESPN_LEAGUE_NAMES[leagueCode] || leagueCode, country: '', logo: '' },
        teams: {
            home: { id: homeC.team?.id, name: homeC.team?.displayName || '', logo: homeC.team?.logos?.[0]?.href || homeC.team?.logo || '' },
            away: { id: awayC.team?.id, name: awayC.team?.displayName || '', logo: awayC.team?.logos?.[0]?.href || awayC.team?.logo || '' },
        },
        goals: {
            home: state !== 'pre' ? (getScore(homeC) ?? 0) : null,
            away: state !== 'pre' ? (getScore(awayC) ?? 0) : null,
        },
    };
}

async function fetchAllESPNFixtures(dateParam) {
    const results = await Promise.allSettled(
        Object.entries(ESPN_CODES).map(async ([leagueId, code]) => {
            const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${dateParam}&limit=100`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const json = await res.json();
            return (json.events || []).map(ev => espnEventToFixture(ev, leagueId, code)).filter(Boolean);
        })
    );
    return results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
}

// ── Teams ─────────────────────────────────────────────────────────────────────

function searchTeams(query) {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    const results = ESPN_TEAM_DB.filter(t => t.name.toLowerCase().includes(q));
    // Return in the shape app.js expects from the old API: [{team:{id,name,logo,country}}]
    return results.slice(0, 10).map(t => ({
        team: { id: t.id, name: t.name, logo: t.logo, country: ESPN_LEAGUE_NAMES[t.league] || t.league }
    }));
}

function teamById(id) {
    return ESPN_TEAM_DB.find(t => t.id === String(id));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function getTodayFixtures(force) {
    return getFixturesForDate(new Date().toISOString().split('T')[0], force);
}

async function getFixturesForDate(isoDate, force) {
    if (!force) {
        const cached = fromCache('TODAY', isoDate);
        if (cached) return cached;
    }
    const data = await fetchAllESPNFixtures(isoDate.replace(/-/g, ''));
    toCache('TODAY', isoDate, data);
    return data;
}

async function fetchScheduleForComp(teamId, leagueCode, season) {
    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/teams/${teamId}/schedule?season=${season}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const json = await res.json();
        return (json.events || [])
            .filter(ev => ev.competitions?.[0]?.status?.type?.state === 'post')
            .map(ev => espnScheduleEventToFixture(ev, leagueCode))
            .filter(Boolean);
    } catch (_) { return []; }
}

async function getTeamFixtures(teamId, count) {
    const cacheKey = `espn_${teamId}`;
    const cached = fromCache('FIXTURES', cacheKey);
    if (cached && cached.length >= Math.min(count, 20)) return cached.slice(0, Math.max(count * 3, 30));

    const teamInfo = teamById(teamId);
    if (!teamInfo) throw new Error('Team not found. Try a different spelling or check they are in a supported league.');

    const leagueCode = teamInfo.league;
    const extraComps = EXTRA_COMPS[leagueCode] || [];
    const allComps   = [leagueCode, ...extraComps];

    let allFinished = [];

    for (const season of [2025, 2024, 2023]) {
        if (allFinished.length >= count * 3) break;
        // Fetch all comps for this season in parallel
        const results = await Promise.allSettled(
            allComps.map(comp => fetchScheduleForComp(teamId, comp, season))
        );
        const newGames = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
        const seenIds  = new Set(allFinished.map(f => f.fixture.id));
        allFinished    = [...allFinished, ...newGames.filter(f => !seenIds.has(f.fixture.id))];
    }

    allFinished.sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
    toCache('FIXTURES', cacheKey, allFinished);
    return allFinished.slice(0, Math.max(count * 3, 30));
}

async function getH2H(id1, id2) {
    const key = [id1, id2].sort().join('-');
    const cached = fromCache('H2H', key);
    if (cached) return cached;

    // H2H comes from team1's full multi-competition schedule
    let fixtures = fromCache('FIXTURES', `espn_${id1}`);
    if (!fixtures) {
        try { fixtures = await getTeamFixtures(id1, 30); } catch (_) { return []; }
    }

    const h2h = (fixtures || []).filter(fx =>
        String(fx.teams.home.id) === String(id2) || String(fx.teams.away.id) === String(id2)
    ).slice(0, 10);

    toCache('H2H', key, h2h);
    return h2h;
}

// ── ESPN public standings ─────────────────────────────────────────────────────

async function getStandingsESPN(leagueId) {
    const code = ESPN_CODES[String(leagueId)];
    if (!code) return null;

    const cacheKey = `espn_${code}`;
    const cached = fromCache('STANDINGS', cacheKey);
    if (cached) return cached;

    const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${code}/standings`);
    if (!res.ok) throw new Error('ESPN fetch failed');
    const json = await res.json();

    const standings = json.standings || json.children?.[0]?.standings;
    if (!standings?.entries?.length) throw new Error('No data');

    const leagueName = standings.displayName || json.name || code;
    const rows = standings.entries.map((e, i) => {
        const sv = name => e.stats?.find(s => s.name === name)?.value ?? 0;
        return {
            rank:     i + 1,
            team:     { name: e.team.displayName, logo: e.team.logos?.[0]?.href || '' },
            played:   sv('gamesPlayed'),
            goalDiff: sv('pointDifferential'),
            points:   sv('points'),
        };
    });

    const result = { leagueName, rows };
    toCache('STANDINGS', cacheKey, result);
    return result;
}

// ── UCL/UEL Knockout Bracket ──────────────────────────────────────────────────

const SLUG_TO_ROUND = {
    'round-of-16':  'Round of 16',
    'quarterfinals': 'Quarter-finals',
    'semifinals':    'Semi-finals',
    'final':         'Final',
};
const ROUND_ORDER = ['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'];

async function getUCLKnockout(leagueId) {
    const espnCode = leagueId === '2' ? 'UEFA.CHAMPIONS' : 'UEFA.EUROPA';
    const cacheKey = `bracket_espn_${leagueId}`;
    const cached   = fromCache('STANDINGS', cacheKey);
    if (cached) return cached;

    const now  = new Date();
    const from = new Date(now); from.setMonth(from.getMonth() - 3);
    const to   = new Date(now); to.setMonth(to.getMonth() + 2);
    const fmt  = d => d.toISOString().slice(0, 10).replace(/-/g, '');

    const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnCode}/scoreboard?dates=${fmt(from)}-${fmt(to)}&limit=100`
    );
    if (!res.ok) throw new Error('ESPN fetch failed');
    const json = await res.json();

    const byRound = {};
    (json.events || []).forEach(ev => {
        const round = SLUG_TO_ROUND[ev.season?.slug];
        if (!round) return;

        const comp  = ev.competitions?.[0];
        if (!comp) return;
        const homeC = comp.competitors?.find(c => c.homeAway === 'home') || comp.competitors?.[0];
        const awayC = comp.competitors?.find(c => c.homeAway === 'away') || comp.competitors?.[1];
        if (!homeC || !awayC) return;

        const pairKey = [homeC.team.id, awayC.team.id].sort().join('-');
        if (!byRound[round]) byRound[round] = {};
        if (!byRound[round][pairKey]) byRound[round][pairKey] = { legs: [] };

        byRound[round][pairKey].legs.push({
            legNum:    comp.leg?.value || 1,
            homeScore: getScore(homeC) ?? 0,
            awayScore: getScore(awayC) ?? 0,
            homeTeam:  { name: homeC.team.displayName, logo: homeC.team.logo || homeC.team.logos?.[0]?.href || '' },
            awayTeam:  { name: awayC.team.displayName, logo: awayC.team.logo || awayC.team.logos?.[0]?.href || '' },
            completed: comp.status?.type?.completed || false,
        });
    });

    const result = {};
    ROUND_ORDER.forEach(round => {
        if (!byRound[round]) return;
        const ties = Object.values(byRound[round]).map(({ legs }) => {
            legs.sort((a, b) => a.legNum - b.legNum);
            const l1 = legs[0];
            if (!l1) return null;
            const l2 = legs[1];
            let agg1 = l1.completed ? l1.homeScore : 0;
            let agg2 = l1.completed ? l1.awayScore : 0;
            if (l2?.completed) { agg1 += l2.awayScore; agg2 += l2.homeScore; }
            return { team1: l1.homeTeam, team2: l1.awayTeam, agg1, agg2, played: l1.completed || (l2?.completed ?? false) };
        }).filter(Boolean);
        if (ties.length) result[round] = ties;
    });

    if (!Object.keys(result).length) return null;
    toCache('STANDINGS', cacheKey, result);
    return result;
}

// ── Upcoming fixtures ─────────────────────────────────────────────────────────

async function getUpcomingFixtures() {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(today.getDate() + 1);
    const d7 = new Date(today); d7.setDate(today.getDate() + 7);
    const fmt = d => d.toISOString().split('T')[0].replace(/-/g, '');
    const rangeKey = fmt(d1);
    const cached = fromCache('UPCOMING', rangeKey);
    if (cached) return cached;

    const data = await fetchAllESPNFixtures(`${fmt(d1)}-${fmt(d7)}`);
    const nowMs = Date.now();
    const future = data.filter(fx => new Date(fx.fixture.date).getTime() > nowMs);
    toCache('UPCOMING', rangeKey, future);
    return future;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchResult(fixture, teamId) {
    const h = fixture.goals.home, a = fixture.goals.away;
    if (h === null || a === null) return null;
    const isHome = String(fixture.teams.home.id) === String(teamId);
    const mine = isHome ? h : a, theirs = isHome ? a : h;
    if (mine > theirs) return 'W';
    if (mine < theirs) return 'L';
    return 'D';
}

function isLive(fx)     { return LIVE_STATUSES.has(fx.fixture.status.short); }
function isFinished(fx) { return FIN_STATUSES.has(fx.fixture.status.short); }

function formatKickoff(fx) {
    return new Date(fx.fixture.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Full team analysis data ───────────────────────────────────────────────────

async function fetchTeamData(teamId, gameCount, venueFilter, onProgress) {
    const fetchCount = venueFilter !== 'all' ? gameCount * 3 : gameCount;
    let fixtures = await getTeamFixtures(teamId, Math.min(fetchCount, 30));

    if (!fixtures || fixtures.length === 0)
        throw new Error('No recent match data found for this team.');

    if (venueFilter === 'home') fixtures = fixtures.filter(fx => String(fx.teams.home.id) === String(teamId));
    else if (venueFilter === 'away') fixtures = fixtures.filter(fx => String(fx.teams.away.id) === String(teamId));

    fixtures = fixtures.slice(0, gameCount);
    if (fixtures.length === 0)
        throw new Error(`No ${venueFilter} matches found — try "All".`);

    const matchStats = [];

    for (let i = 0; i < fixtures.length; i++) {
        const fx = fixtures[i];
        if (onProgress) onProgress(i + 1, fixtures.length);

        const isHome        = String(fx.teams.home.id) === String(teamId);
        const goalsScored   = (isHome ? fx.goals.home : fx.goals.away) ?? 0;
        const goalsConceded = (isHome ? fx.goals.away : fx.goals.home) ?? 0;
        const res           = matchResult(fx, teamId);
        if (!res) continue;

        matchStats.push({
            date:          fx.fixture.date.split('T')[0],
            isHome,
            opponent:      isHome ? fx.teams.away.name : fx.teams.home.name,
            opponentLogo:  isHome ? fx.teams.away.logo : fx.teams.home.logo,
            competition:   fx.league.name,
            result:        res,
            goalsScored,
            goalsConceded,
            scored:        goalsScored > 0,
        });
    }

    if (matchStats.length === 0)
        throw new Error('No match data found — this team may not have any recorded results yet.');

    return matchStats;
}
