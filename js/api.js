const API_HOST = 'v3.football.api-sports.io';
const API_BASE = `https://${API_HOST}`;

const CACHE_TTL = {
    SEARCH:    7 * 24 * 60 * 60 * 1000,
    TODAY:     60 * 1000,
    FIXTURES:  12 * 60 * 60 * 1000,
    H2H:       6 * 60 * 60 * 1000,
    STATS:     null,
    STANDINGS: 6 * 60 * 60 * 1000,
    UPCOMING:  30 * 60 * 1000
};

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const FIN_STATUSES  = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

const API_KEYS = [
    '7209033039fc2942d98ea61367b28a50',
    '6b80c2c24fddc73a2aa4891e9a73bd0f',
    '7ef13602cdfb889dc6c9fbb20175f0fe'
];
let _keyIndex = parseInt(localStorage.getItem('piq_key_idx') || '0', 10) % API_KEYS.length;

function getApiKey() { return API_KEYS[_keyIndex]; }

function rotateKey() {
    _keyIndex = (_keyIndex + 1) % API_KEYS.length;
    localStorage.setItem('piq_key_idx', _keyIndex);
}

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

async function apiFetch(endpoint, _attempt = 0) {
    if (_attempt >= API_KEYS.length) throw new Error('All API keys exhausted for today. Try again tomorrow.');

    const key = getApiKey();
    const res = await fetch(`${API_BASE}${endpoint}`, { headers: { 'x-apisports-key': key } });

    if (res.status === 429 || res.status === 401 || res.status === 403) {
        rotateKey();
        return apiFetch(endpoint, _attempt + 1);
    }
    if (!res.ok) throw new Error(`API error ${res.status} — please try again.`);

    const json = await res.json();
    if (json.errors) {
        const errs = Object.values(json.errors).filter(Boolean);
        if (errs.length) throw new Error(errs.join('. '));
    }

    const remaining = res.headers.get('x-ratelimit-requests-remaining')
        || res.headers.get('x-ratelimit-remaining');
    if (remaining !== null) {
        window._apiRemaining = parseInt(remaining, 10);
        if (window._apiRemaining <= 2) rotateKey();
    }

    return json.response;
}

// ── Teams ─────────────────────────────────────────────────────────────────────

async function searchTeams(query) {
    const cached = fromCache('SEARCH', query.toLowerCase());
    if (cached) return cached;
    const data = await apiFetch(`/teams?search=${encodeURIComponent(query)}`);
    toCache('SEARCH', query.toLowerCase(), data);
    return data;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function getTodayFixtures(force) {
    const today = new Date().toISOString().split('T')[0];
    const dateKey = today.replace(/-/g, '');
    if (!force) {
        const cached = fromCache('TODAY', today);
        if (cached) return cached;
    }
    const data = await fetchAllESPNFixtures(dateKey);
    toCache('TODAY', today, data);
    return data;
}

function getCurrentSeason() { return 2025; }

async function getTeamFixtures(teamId, count) {
    const season = getCurrentSeason();
    const id = `${teamId}_${season}`;
    const cached = fromCache('FIXTURES', id);
    let data = cached;
    if (!data) {
        data = await apiFetch(`/fixtures?team=${teamId}&season=${season}&status=FT`);
        // Fall back through previous seasons if not enough results
        for (const prev of [season - 1, season - 2]) {
            if (data && data.length >= count) break;
            try {
                const prevData = await apiFetch(`/fixtures?team=${teamId}&season=${prev}&status=FT`);
                data = [...(data || []), ...(prevData || [])];
            } catch (_) {}
        }
        toCache('FIXTURES', id, data);
    }
    return (data || [])
        .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
        .slice(0, Math.max(count * 3, 30));
}

async function getFixtureStats(fixtureId) {
    const cached = fromCache('STATS', fixtureId);
    if (cached) return cached;
    const data = await apiFetch(`/fixtures/statistics?fixture=${fixtureId}`);
    toCache('STATS', fixtureId, data);
    return data;
}

async function getH2H(id1, id2) {
    const key = [id1, id2].sort().join('-');
    const cached = fromCache('H2H', key);
    if (cached) return cached;
    const data = await apiFetch(`/fixtures/headtohead?h2h=${id1}-${id2}&last=10`);
    toCache('H2H', key, data);
    return data;
}

// ── ESPN public standings (no auth required, always live) ────────────────────

const ESPN_CODES = {
    '39':  'eng.1',  '40':  'eng.2',  '140': 'esp.1',
    '78':  'ger.1',  '135': 'ita.1',  '61':  'fra.1',
    '88':  'ned.1',  '94':  'por.1',  '179': 'sco.1',
    '203': 'tur.1',  '71':  'bra.1',  '253': 'usa.1',
    '2':   'UEFA.CHAMPIONS',           '3':   'UEFA.EUROPA',
};

const ESPN_LEAGUE_NAMES = {
    'eng.1': 'Premier League',   'eng.2': 'Championship',
    'esp.1': 'La Liga',          'ger.1': 'Bundesliga',
    'ita.1': 'Serie A',          'fra.1': 'Ligue 1',
    'ned.1': 'Eredivisie',       'por.1': 'Primeira Liga',
    'sco.1': 'Scottish Prem',    'tur.1': 'Süper Lig',
    'bra.1': 'Brasileirão',      'usa.1': 'MLS',
    'UEFA.CHAMPIONS': 'Champions League', 'UEFA.EUROPA': 'Europa League',
};

function espnEventToFixture(ev, leagueId, espnCode) {
    const comp = ev.competitions?.[0];
    if (!comp) return null;
    const homeC = comp.competitors?.find(c => c.homeAway === 'home') || comp.competitors?.[0];
    const awayC = comp.competitors?.find(c => c.homeAway === 'away') || comp.competitors?.[1];
    if (!homeC || !awayC) return null;

    const st    = comp.status?.type;
    const state = st?.state || 'pre';
    let short = 'NS', elapsed = null;

    if (state === 'post') {
        short = 'FT';
    } else if (state === 'in') {
        const detail = (st?.shortDetail || st?.description || '').toLowerCase();
        const period = comp.status?.period || 1;
        if (detail.includes('half time') || detail.includes('halftime') || detail === 'ht') {
            short = 'HT';
        } else if (period === 1) {
            short = '1H';
        } else if (period === 2) {
            short = '2H';
        } else {
            short = 'LIVE';
        }
        const m = (comp.status?.displayClock || '').match(/^(\d+)/);
        if (m) elapsed = parseInt(m[1], 10);
    }

    const pre = state === 'pre';
    return {
        fixture: { id: `espn_${ev.id}`, date: comp.date || ev.date, status: { short, elapsed } },
        league:  { id: parseInt(leagueId, 10), name: ESPN_LEAGUE_NAMES[espnCode] || espnCode, country: '', logo: '' },
        teams: {
            home: { id: `espn_${homeC.team.id}`, name: homeC.team.displayName || homeC.team.name || '', logo: homeC.team.logo || homeC.team.logos?.[0]?.href || '' },
            away: { id: `espn_${awayC.team.id}`, name: awayC.team.displayName || awayC.team.name || '', logo: awayC.team.logo || awayC.team.logos?.[0]?.href || '' },
        },
        goals: { home: pre ? null : parseInt(homeC.score || 0, 10), away: pre ? null : parseInt(awayC.score || 0, 10) },
    };
}

async function fetchAllESPNFixtures(dateParam) {
    const results = await Promise.allSettled(
        Object.entries(ESPN_CODES).map(async ([leagueId, code]) => {
            const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${dateParam}&limit=100`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const json = await res.json();
            return (json.events || [])
                .map(ev => espnEventToFixture(ev, leagueId, code))
                .filter(Boolean);
        })
    );
    return results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
}

async function getStandingsESPN(leagueId) {
    const code = ESPN_CODES[String(leagueId)];
    if (!code) return null;

    const cacheKey = `espn_${code}`;
    const cached = fromCache('STANDINGS', cacheKey);
    if (cached) return cached;

    const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${code}/standings`);
    if (!res.ok) throw new Error('ESPN fetch failed');
    const json = await res.json();

    // ESPN response: json.standings.entries  OR  json.children[0].standings.entries
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

// ── UCL/UEL Knockout Bracket (via ESPN site/v2 — no auth required) ───────────

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

    // Group legs by round and pair key
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
            homeId:    homeC.team.id,
            homeScore: parseInt(homeC.score || 0, 10),
            awayScore: parseInt(awayC.score || 0, 10),
            homeTeam:  { name: homeC.team.displayName, logo: homeC.team.logo || homeC.team.logos?.[0]?.href || '' },
            awayTeam:  { name: awayC.team.displayName, logo: awayC.team.logo || awayC.team.logos?.[0]?.href || '' },
            completed: comp.status?.type?.completed || false,
        });
    });

    // Compute correct per-team aggregates: team1 = home in leg1, agg1 = leg1 home + leg2 away
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

            return {
                team1:  l1.homeTeam,
                team2:  l1.awayTeam,
                agg1, agg2,
                played: l1.completed || (l2?.completed ?? false),
            };
        }).filter(Boolean);
        if (ties.length) result[round] = ties;
    });

    if (!Object.keys(result).length) return null;
    toCache('STANDINGS', cacheKey, result);
    return result;
}

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

function extractStat(stats, type) {
    const s = stats.find(x => x.type === type);
    if (!s || s.value === null || s.value === undefined) return 0;
    const n = parseInt(s.value, 10);
    return isNaN(n) ? 0 : n;
}

function extractPct(stats, type) {
    const s = stats.find(x => x.type === type);
    if (!s || !s.value) return 0;
    return parseInt(String(s.value).replace('%', ''), 10) || 0;
}

function matchResult(fixture, teamId) {
    const h = fixture.goals.home, a = fixture.goals.away;
    if (h === null || a === null) return null;
    const isHome = fixture.teams.home.id === teamId;
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

    if (venueFilter === 'home') fixtures = fixtures.filter(fx => fx.teams.home.id === teamId);
    else if (venueFilter === 'away') fixtures = fixtures.filter(fx => fx.teams.away.id === teamId);

    fixtures = fixtures.slice(0, gameCount);
    if (fixtures.length === 0)
        throw new Error(`No ${venueFilter} matches found — try "All".`);

    const matchStats = [];

    for (let i = 0; i < fixtures.length; i++) {
        const fx = fixtures[i];
        if (onProgress) onProgress(i + 1, fixtures.length);

        const isHome        = fx.teams.home.id === teamId;
        const goalsScored   = (isHome ? fx.goals.home : fx.goals.away) ?? 0;
        const goalsConceded = (isHome ? fx.goals.away : fx.goals.home) ?? 0;
        const res           = matchResult(fx, teamId);
        if (!res) continue; // skip null-score fixtures

        let s = [];
        try {
            const statsArr = await getFixtureStats(fx.fixture.id);
            const teamStats = statsArr?.find(ts => ts.team.id === teamId);
            s = teamStats?.statistics || [];
        } catch (_) { /* use empty stats — goals are enough for basic prediction */ }

        const yellow = s.length ? extractStat(s, 'Yellow Cards') : 0;
        const red    = s.length ? extractStat(s, 'Red Cards')    : 0;

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
            shots:         s.length ? extractStat(s, 'Total Shots')      : 0,
            shotsOnTarget: s.length ? extractStat(s, 'Shots on Goal')    : 0,
            corners:       s.length ? extractStat(s, 'Corner Kicks')     : 0,
            fouls:         s.length ? extractStat(s, 'Fouls')            : 0,
            yellowCards:   yellow,
            redCards:      red,
            cards:         yellow + red,
            possession:    s.length ? extractPct(s,  'Ball Possession')  : 0,
            passes:        s.length ? extractStat(s, 'Total passes')     : 0
        });

        if (i < fixtures.length - 1) await sleep(150);
    }

    if (matchStats.length === 0)
        throw new Error('No match data found for this team. They may not have any completed games in the available seasons (2022–2024).');

    return matchStats;
}
