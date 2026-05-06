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
    if (!force) {
        const cached = fromCache('TODAY', today);
        if (cached) return cached;
    }
    const data = await apiFetch(`/fixtures?date=${today}&timezone=Europe/London`);
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

async function getStandings(leagueId) {
    const season = getCurrentSeason();
    const key = `${leagueId}_${season}`;
    const cached = fromCache('STANDINGS', key);
    if (cached) return cached;
    const data = await apiFetch(`/standings?league=${leagueId}&season=${season}`);
    toCache('STANDINGS', key, data);
    return data;
}

async function getUpcomingFixtures() {
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const key = tomorrow.toISOString().split('T')[0];
    const cached = fromCache('UPCOMING', key);
    if (cached) return cached;

    const dates = [1, 2, 3, 4, 5, 6, 7].map(n => {
        const d = new Date(today); d.setDate(today.getDate() + n);
        return d.toISOString().split('T')[0];
    });

    const results = await Promise.allSettled(
        dates.map(date => apiFetch(`/fixtures?date=${date}&timezone=Europe/London`))
    );
    const data = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value || []);

    toCache('UPCOMING', key, data);
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
