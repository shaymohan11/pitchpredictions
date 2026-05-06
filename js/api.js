const API_HOST = 'v3.football.api-sports.io';
const API_BASE = `https://${API_HOST}`;

const CACHE_TTL = {
    SEARCH:   7 * 24 * 60 * 60 * 1000,
    TODAY:    60 * 1000,
    FIXTURES: 12 * 60 * 60 * 1000,
    H2H:      6 * 60 * 60 * 1000,
    STATS:    null
};

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const FIN_STATUSES  = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

function getApiKey() { return '7209033039fc2942d98ea61367b28a50'; }

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

async function apiFetch(endpoint) {
    const key = getApiKey();
    if (!key) throw new Error('API key not configured');

    // Support both direct api-sports keys and RapidAPI keys
    // Direct keys (from dashboard.api-football.com) use x-apisports-key
    // RapidAPI keys use x-rapidapi-key + x-rapidapi-host
    const isRapidApi = key.includes('jsn') || key.length < 40;
    const headers = isRapidApi
        ? { 'x-rapidapi-key': key, 'x-rapidapi-host': API_HOST }
        : { 'x-apisports-key': key };

    const res = await fetch(`${API_BASE}${endpoint}`, { headers });

    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key — check Settings.');
    if (res.status === 429) throw new Error('Daily API limit hit (100/day on free plan). Try tomorrow.');
    if (!res.ok) throw new Error(`API error ${res.status} — please try again.`);

    const json = await res.json();
    if (json.errors) {
        const errs = Object.values(json.errors).filter(Boolean);
        if (errs.length) throw new Error(errs.join('. '));
    }

    // Track remaining calls
    const remaining = res.headers.get('x-ratelimit-requests-remaining')
        || res.headers.get('x-ratelimit-remaining');
    if (remaining !== null) {
        window._apiRemaining = parseInt(remaining, 10);
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

async function getTodayFixtures(force = false) {
    const today = new Date().toISOString().split('T')[0];
    if (!force) {
        const cached = fromCache('TODAY', today);
        if (cached) return cached;
    }
    const data = await apiFetch(`/fixtures?date=${today}&timezone=Europe/London`);
    toCache('TODAY', today, data);
    return data;
}

async function getTeamFixtures(teamId, count) {
    const id = `${teamId}_${count}`;
    const cached = fromCache('FIXTURES', id);
    if (cached) return cached;
    const data = await apiFetch(`/fixtures?team=${teamId}&last=${count}&status=FT`);
    toCache('FIXTURES', id, data);
    return data;
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

    if (!fixtures || fixtures.length === 0) throw new Error('No recent match data found for this team.');

    if (venueFilter === 'home') fixtures = fixtures.filter(fx => fx.teams.home.id === teamId);
    else if (venueFilter === 'away') fixtures = fixtures.filter(fx => fx.teams.away.id === teamId);

    fixtures = fixtures.slice(0, gameCount);

    if (fixtures.length === 0) throw new Error(`No ${venueFilter} matches found — try "All".`);

    const matchStats = [];

    for (let i = 0; i < fixtures.length; i++) {
        const fx = fixtures[i];
        if (onProgress) onProgress(i + 1, fixtures.length);

        try {
            const statsArr = await getFixtureStats(fx.fixture.id);
            const teamStats = statsArr?.find(s => s.team.id === teamId);
            const isHome = fx.teams.home.id === teamId;

            const goalsScored    = (isHome ? fx.goals.home : fx.goals.away) ?? 0;
            const goalsConceded  = (isHome ? fx.goals.away : fx.goals.home) ?? 0;

            if (teamStats?.statistics?.length > 0) {
                const s = teamStats.statistics;
                const yellow = extractStat(s, 'Yellow Cards');
                const red    = extractStat(s, 'Red Cards');
                const passes = extractStat(s, 'Total passes');

                matchStats.push({
                    date:          fx.fixture.date.split('T')[0],
                    isHome,
                    opponent:      isHome ? fx.teams.away.name : fx.teams.home.name,
                    opponentLogo:  isHome ? fx.teams.away.logo : fx.teams.home.logo,
                    competition:   fx.league.name,
                    result:        matchResult(fx, teamId),
                    goalsScored,
                    goalsConceded,
                    scored:        goalsScored > 0,
                    shots:         extractStat(s, 'Total Shots'),
                    shotsOnTarget: extractStat(s, 'Shots on Goal'),
                    corners:       extractStat(s, 'Corner Kicks'),
                    fouls:         extractStat(s, 'Fouls'),
                    yellowCards:   yellow,
                    redCards:      red,
                    cards:         yellow + red,
                    possession:    extractPct(s, 'Ball Possession'),
                    passes
                });
            }
        } catch (e) {
            console.warn(`Skipping fixture ${fx.fixture.id}:`, e.message);
        }

        if (i < fixtures.length - 1) await sleep(150);
    }

    if (matchStats.length === 0) throw new Error('No stats available for this team. Try a different selection.');

    return matchStats;
}
