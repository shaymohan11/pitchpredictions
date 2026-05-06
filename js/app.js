/* PitchPredictions — Main App */

const state = {
    team1: null, team2: null,
    gameCount: 5, venue: 'all',
    activeLeague: 'all',
    countdownInterval: null,
    nextRefresh: null,
    REFRESH_SECS: 60,
    lastFixtures: [],
    searchTimers: { t1: null, t2: null },
    currentT1: null, currentT2: null, currentPreds: null
};

const BIG_LEAGUES = new Set([39, 2, 3, 1, 4, 140, 78, 135, 61, 40, 48]);

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initLeagueFilter();
    initAnalyseTab();
    initRefreshBtn();
    initAuthModal();
    await initAuth();
    loadLiveTab();
    loadUpcomingFixtures();
    loadStandings('39'); // auto-load Premier League standings
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const t = btn.dataset.tab;
            ['live', 'analyse', 'saved'].forEach(id => {
                const el = document.getElementById(`${id}Tab`);
                if (el) {
                    el.classList.toggle('active', id === t);
                    el.classList.toggle('hidden',  id !== t);
                }
            });
            if (t === 'saved') {
                loadPinnedTeams();
                loadSavedAnalyses();
            }
        });
    });
}

// ─── League Filter ────────────────────────────────────────────────────────────
function initLeagueFilter() {
    document.querySelectorAll('#leagueFilter .lchip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#leagueFilter .lchip').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            state.activeLeague = btn.dataset.league;
            // Always switch to live tab so the user sees the updated standings + fixtures
            const liveBtn = document.querySelector('[data-tab="live"]');
            if (liveBtn && !liveBtn.classList.contains('active')) liveBtn.click();
            renderFixtures(state.lastFixtures);
            loadStandings(btn.dataset.league);
        });
    });
}

// ─── Live Tab ─────────────────────────────────────────────────────────────────
async function loadLiveTab(force) {
    try {
        const fixtures = await getTodayFixtures(force);
        state.lastFixtures = fixtures || [];
        renderFixtures(state.lastFixtures);
        updateApiUsage();
    } catch (e) {
        document.getElementById('liveList').innerHTML  = `<div class="empty-row">${e.message}</div>`;
        document.getElementById('todayList').innerHTML = '';
    }
    updateTicker(state.lastFixtures);
    scheduleNextRefresh();
}

function renderFixtures(fixtures) {
    const league   = state.activeLeague;
    const filtered = league === 'all' ? fixtures : fixtures.filter(fx => String(fx.league.id) === league);

    const live     = filtered.filter(fx => isLive(fx));
    const upcoming = filtered.filter(fx => !isLive(fx) && !isFinished(fx));
    const done     = filtered.filter(fx => isFinished(fx));

    const liveEl  = document.getElementById('liveList');
    const todayEl = document.getElementById('todayList');
    const now     = new Date();

    document.getElementById('todayDateLbl').textContent =
        now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    liveEl.innerHTML  = live.length  ? '' : '<div class="empty-row">No live games right now</div>';
    todayEl.innerHTML = (upcoming.length + done.length) ? '' : '<div class="empty-row">No fixtures scheduled today</div>';

    live.forEach(fx     => liveEl.appendChild(buildMatchCard(fx, 'live')));
    upcoming.forEach(fx => todayEl.appendChild(buildMatchCard(fx, 'upcoming')));
    done.forEach(fx     => todayEl.appendChild(buildMatchCard(fx, 'finished')));
}

function updateTicker(fixtures) {
    const bar   = document.getElementById('bigGamesTicker');
    const inner = document.getElementById('tickerInner');
    const bigLive  = fixtures.filter(fx => isLive(fx) && BIG_LEAGUES.has(fx.league.id));
    const bigToday = fixtures.filter(fx => !isLive(fx) && BIG_LEAGUES.has(fx.league.id));
    const items = [...bigLive, ...bigToday];

    if (!items.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');

    const buildItem = fx => {
        const live = isLive(fx);
        const div  = document.createElement('div');
        div.className = 'ticker-item';
        div.innerHTML = live
            ? `<span class="ticker-team">${fx.teams.home.name}</span>
               <span class="ticker-score">${fx.goals.home ?? '–'} - ${fx.goals.away ?? '–'}</span>
               <span class="ticker-team">${fx.teams.away.name}</span>
               <span class="ticker-min">${fx.fixture.status.elapsed ? fx.fixture.status.elapsed+"'" : 'LIVE'}</span>
               <span class="ticker-league">${fx.league.name}</span>`
            : `<span class="ticker-team">${fx.teams.home.name}</span>
               <span class="ticker-score" style="color:rgba(255,255,255,0.5);font-size:11px"> vs </span>
               <span class="ticker-team">${fx.teams.away.name}</span>
               <span style="font-size:10px;color:rgba(255,255,255,0.5);margin-left:4px">${formatKickoff(fx)}</span>
               <span class="ticker-league">${fx.league.name}</span>`;
        div.addEventListener('click', () => prefillTeams(fx.teams.home, fx.teams.away));
        return div;
    };

    inner.innerHTML = '';
    items.forEach(fx => inner.appendChild(buildItem(fx)));
    items.forEach(fx => inner.appendChild(buildItem(fx)));
    inner.style.animation = 'none'; inner.offsetHeight; inner.style.animation = '';
}

function buildMatchCard(fx, type) {
    const card = document.createElement('div');
    card.className = `match-card fade-in${type === 'live' ? ' is-live' : ''}`;
    const home = fx.teams.home, away = fx.teams.away;
    const hg = fx.goals.home ?? '–', ag = fx.goals.away ?? '–';
    const min = fx.fixture.status.elapsed;

    let statusHtml;
    if (type === 'live')        statusHtml = `<span class="mc-live-badge"><span class="mc-live-dot"></span>${min ? min+"'" : fx.fixture.status.short}</span>`;
    else if (type === 'finished') statusHtml = `<span class="mc-ft-badge">FT</span>`;
    else                          statusHtml = `<span class="mc-time-badge">${formatKickoff(fx)}</span>`;

    const scoreHtml = type === 'upcoming'
        ? `<div class="mc-kickoff">${formatKickoff(fx)}</div><div class="mc-vs">vs</div>`
        : `<div style="display:flex;align-items:center"><span class="mc-score">${hg}</span><span class="mc-score-sep"> - </span><span class="mc-score">${ag}</span></div>${min && type === 'live' ? `<div class="mc-minute">${min}'</div>` : ''}`;

    card.innerHTML = `
        <div class="mc-league">
            <span class="mc-league-name">${fx.league.country ? fx.league.country + ' · ' : ''}${fx.league.name}</span>
            ${statusHtml}
        </div>
        <div class="mc-body">
            <div class="mc-team">
                <img class="mc-logo" src="${home.logo}" alt="" onerror="this.style.display='none'">
                <span class="mc-name">${home.name}</span>
            </div>
            <div class="mc-score-wrap">${scoreHtml}</div>
            <div class="mc-team away">
                <img class="mc-logo" src="${away.logo}" alt="" onerror="this.style.display='none'">
                <span class="mc-name">${away.name}</span>
            </div>
        </div>
        <div class="mc-analyse-hint">Tap to analyse this match →</div>
    `;
    card.addEventListener('click', () => prefillTeams(home, away));
    return card;
}

async function resolveTeam(t) {
    if (!String(t.id).startsWith('espn_')) return t;
    try {
        const res = await searchTeams(t.name);
        const match = res?.find(r => r.team.name.toLowerCase() === t.name.toLowerCase()) || res?.[0];
        if (match) return { id: match.team.id, name: match.team.name, logo: match.team.logo || t.logo };
    } catch (_) {}
    return t;
}

async function prefillTeams(home, away) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="analyse"]').classList.add('active');
    ['live','saved'].forEach(id => {
        document.getElementById(`${id}Tab`).classList.add('hidden');
        document.getElementById(`${id}Tab`).classList.remove('active');
    });
    document.getElementById('analyseTab').classList.remove('hidden');
    document.getElementById('analyseTab').classList.add('active');
    const [t1, t2] = await Promise.all([resolveTeam(home), resolveTeam(away)]);
    setTeam(1, t1);
    setTeam(2, t2);
}

// ─── Standings ────────────────────────────────────────────────────────────────
state.standingsRows  = 10;   // default collapsed
state.standingsCache = null;

async function loadStandings(leagueId) {
    const el    = document.getElementById('standingsContent');
    const label = document.getElementById('standingsLeagueLabel');

    if (leagueId === 'all') return loadStandings('39');

    // UCL / UEL → show bracket instead of table
    if (leagueId === '2' || leagueId === '3') {
        return loadUCLBracket(leagueId);
    }

    el.innerHTML = '<div class="sb-empty">Loading...</div>';
    try {
        const data = await getStandingsESPN(leagueId);
        if (!data) {
            el.innerHTML = '<div class="sb-empty">No standings for this competition</div>';
            if (label) label.textContent = '';
            return;
        }
        if (label) label.textContent = data.leagueName;
        state.standingsCache = data;
        renderStandingsTable(data);
    } catch (_) {
        el.innerHTML = `<div class="sb-empty">Couldn't load standings</div>`;
    }
}

function renderStandingsTable(data) {
    const el      = document.getElementById('standingsContent');
    const total   = data.rows.length;
    const rows    = data.rows.slice(0, state.standingsRows);
    const canMore = state.standingsRows < total;
    const canLess = state.standingsRows >= total;

    el.innerHTML = `
        <table class="standings-table">
            <thead><tr><th>#</th><th>Team</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>
            <tbody>
                ${rows.map(r => `
                    <tr>
                        <td class="st-pos">${r.rank}</td>
                        <td>
                            <div style="display:flex;align-items:center;gap:5px">
                                <img src="${r.team.logo}" width="14" height="14" style="object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">
                                <span class="st-name">${r.team.name}</span>
                            </div>
                        </td>
                        <td class="st-num">${r.played}</td>
                        <td class="st-num" style="color:${r.goalDiff >= 0 ? 'var(--green)' : 'var(--red)'}">${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</td>
                        <td class="st-pts">${r.points}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div class="st-expand-row">
            ${canMore
                ? `<button class="st-expand-btn" data-action="more">View more ▾</button>`
                : `<button class="st-expand-btn" data-action="less">View less ▴</button>`
            }
        </div>
    `;
    el.querySelector('.st-expand-btn')?.addEventListener('click', e => {
        state.standingsRows = e.target.dataset.action === 'more' ? total : 10;
        if (state.standingsCache) renderStandingsTable(state.standingsCache);
    });
}

// ─── UCL / UEL Bracket ────────────────────────────────────────────────────────
async function loadUCLBracket(leagueId) {
    const el    = document.getElementById('standingsContent');
    const label = document.getElementById('standingsLeagueLabel');
    const name  = leagueId === '2' ? 'Champions League' : 'Europa League';
    if (label) label.textContent = name;
    el.innerHTML = '<div class="sb-empty">Loading bracket...</div>';

    try {
        const rounds = await getUCLKnockout(leagueId);
        if (!rounds || !Object.keys(rounds).length) {
            el.innerHTML = '<div class="sb-empty">Bracket data not yet available for this season</div>';
            return;
        }

        const LABELS = { 'Round of 16': 'Round of 16', 'Quarter-finals': 'Quarter-finals', 'Semi-finals': 'Semi-finals', 'Final': 'Final' };

        let html = `<div class="ucl-bracket">`;

        for (const [round, ties] of Object.entries(rounds)) {
            html += `<div class="bracket-round-hdr">${LABELS[round] || round}</div>`;
            for (const tie of ties) {
                const agg1win = tie.played && tie.agg1 > tie.agg2;
                const agg2win = tie.played && tie.agg2 > tie.agg1;
                html += `
                <div class="bracket-tie">
                    <div class="bt-row ${agg1win ? 'bt-winner' : agg2win ? 'bt-loser' : ''}">
                        <img src="${tie.team1.logo}" class="bt-logo" onerror="this.style.display='none'">
                        <span class="bt-name">${tie.team1.name}</span>
                        ${tie.played ? `<span class="bt-score">${tie.agg1}</span>` : '<span class="bt-tbd">TBD</span>'}
                    </div>
                    <div class="bt-row ${agg2win ? 'bt-winner' : agg1win ? 'bt-loser' : ''}">
                        <img src="${tie.team2.logo}" class="bt-logo" onerror="this.style.display='none'">
                        <span class="bt-name">${tie.team2.name}</span>
                        ${tie.played ? `<span class="bt-score">${tie.agg2}</span>` : '<span class="bt-tbd">TBD</span>'}
                    </div>
                </div>`;
            }
        }

        html += `</div>`;
        el.innerHTML = html;
    } catch (_) {
        el.innerHTML = '<div class="sb-empty">Failed to load bracket</div>';
    }
}

// ─── Upcoming Sidebar ─────────────────────────────────────────────────────────
async function loadUpcomingFixtures() {
    const el = document.getElementById('upcomingContent');
    try {
        const fixtures = await getUpcomingFixtures();
        const big = fixtures.filter(fx => BIG_LEAGUES.has(fx.league.id));
        if (!big.length) { el.innerHTML = '<div class="sb-empty">No upcoming big league fixtures found</div>'; return; }
        const shown = big.slice(0, 20);
        el.innerHTML = shown.map(fx => {
            const d   = new Date(fx.fixture.date);
            const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            return `
                <div class="upcoming-item">
                    <div class="upcoming-date">${day}</div>
                    <div class="upcoming-teams">
                        <div class="upcoming-team-row">
                            <img src="${fx.teams.home.logo}" class="upcoming-logo" onerror="this.style.display='none'">
                            <span>${fx.teams.home.name}</span>
                        </div>
                        <div class="upcoming-team-row muted">
                            <img src="${fx.teams.away.logo}" class="upcoming-logo" onerror="this.style.display='none'">
                            <span>${fx.teams.away.name}</span>
                        </div>
                        <div class="upcoming-league">${fx.league.name}</div>
                    </div>
                    <div class="upcoming-time">${formatKickoff(fx)}</div>
                </div>
            `;
        }).join('');
        el.querySelectorAll('.upcoming-item').forEach((item, i) => {
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => prefillTeams(shown[i].teams.home, shown[i].teams.away));
        });
    } catch (_) {
        el.innerHTML = '<div class="sb-empty">Upcoming fixtures unavailable</div>';
    }
}

// ─── Countdown & Refresh ──────────────────────────────────────────────────────
function scheduleNextRefresh() {
    clearInterval(state.countdownInterval);
    state.nextRefresh = Date.now() + state.REFRESH_SECS * 1000;
    state.countdownInterval = setInterval(() => {
        const rem = Math.max(0, Math.round((state.nextRefresh - Date.now()) / 1000));
        const el  = document.getElementById('countdown');
        if (el) el.textContent = rem + 's';
        if (rem === 0) { clearInterval(state.countdownInterval); loadLiveTab(true); }
    }, 1000);
}

function initRefreshBtn() {
    document.getElementById('refreshBtn').addEventListener('click', () => loadLiveTab(true));
}

// ─── API Usage ────────────────────────────────────────────────────────────────
function updateApiUsage() {
    const el  = document.getElementById('apiUsage');
    if (!el) return;
    const rem = window._apiRemaining;
    if (rem === undefined || rem === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent  = `${rem} calls left`;
    el.className    = 'usage-pill';
    if (rem <= 10) el.classList.add('critical');
    else if (rem <= 30) el.classList.add('low');
}

// ─── Analyse Tab ──────────────────────────────────────────────────────────────
function initAnalyseTab() {
    initTeamSearch(1, 'team1Input', 'team1Drop', 'team1Pill');
    initTeamSearch(2, 'team2Input', 'team2Drop', 'team2Pill');

    document.querySelectorAll('#gameCountChips .toggle').forEach(c => {
        c.addEventListener('click', () => {
            document.querySelectorAll('#gameCountChips .toggle').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            state.gameCount = parseInt(c.dataset.val, 10);
        });
    });

    document.querySelectorAll('#venueChips .toggle').forEach(c => {
        c.addEventListener('click', () => {
            document.querySelectorAll('#venueChips .toggle').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            state.venue = c.dataset.val;
        });
    });

    document.getElementById('analyseBtn').addEventListener('click', runAnalysis);

    document.querySelectorAll('.rtab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.rtab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const t = btn.dataset.rtab;
            ['stats','predictions','h2h','form'].forEach(id => {
                document.getElementById(`${id}Pane`).classList.toggle('hidden', id !== t);
            });
        });
    });

    document.getElementById('retryBtn').addEventListener('click', runAnalysis);
}

function initTeamSearch(n, inputId, dropId, pillId) {
    const input = document.getElementById(inputId);
    const drop  = document.getElementById(dropId);

    input.addEventListener('input', () => {
        clearTimeout(state.searchTimers[`t${n}`]);
        const q = input.value.trim();
        if (q.length < 2) { drop.classList.add('hidden'); return; }
        state.searchTimers[`t${n}`] = setTimeout(async () => {
            try {
                drop.innerHTML = '<div class="drop-item" style="color:var(--text-muted)">Searching...</div>';
                drop.classList.remove('hidden');
                const results = await searchTeams(q);
                renderDrop(results, drop, n, input);
            } catch (e) {
                drop.innerHTML = `<div class="drop-item" style="color:var(--red)">${e.message}</div>`;
            }
        }, 350);
    });

    document.addEventListener('click', e => {
        if (!input.contains(e.target) && !drop.contains(e.target)) drop.classList.add('hidden');
    });
}

function renderDrop(results, drop, n, input) {
    drop.innerHTML = '';
    if (!results || !results.length) {
        drop.innerHTML = '<div class="drop-item" style="color:var(--text-muted)">No teams found</div>';
        return;
    }
    results.slice(0, 10).forEach(r => {
        const team = r.team;
        const div  = document.createElement('div');
        div.className = 'drop-item';
        div.innerHTML = `
            <img class="drop-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">
            <div>
                <div class="drop-name">${team.name}</div>
                <div class="drop-country">${team.country || ''}</div>
            </div>
        `;
        div.addEventListener('click', () => {
            setTeam(n, { id: team.id, name: team.name, logo: team.logo });
            drop.classList.add('hidden');
            input.value = '';
        });
        drop.appendChild(div);
    });
}

function setTeam(n, team) {
    if (n === 1) state.team1 = team; else state.team2 = team;
    const el = document.getElementById(`team${n}Pill`);
    el.innerHTML = `
        <img class="selected-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">
        <span>${team.name}</span>
        <button class="selected-clear" data-n="${n}">×</button>
    `;
    el.classList.remove('hidden');
    el.querySelector('.selected-clear').addEventListener('click', () => {
        if (n === 1) state.team1 = null; else state.team2 = null;
        el.classList.add('hidden');
        document.getElementById(`team${n}Input`).value = '';
        checkReady();
    });
    checkReady();
}

function checkReady() {
    document.getElementById('analyseBtn').disabled = !(state.team1 && state.team2);
}

// ─── Run Analysis ─────────────────────────────────────────────────────────────
async function runAnalysis() {
    if (!state.team1 || !state.team2) return;
    document.getElementById('results').classList.add('hidden');
    document.getElementById('analyseError').classList.add('hidden');
    document.getElementById('analyseLoading').classList.remove('hidden');

    const t1 = state.team1, t2 = state.team2;

    try {
        setProgress(0, 'Fetching fixtures...');
        const [data1, data2] = await Promise.all([
            fetchTeamData(t1.id, state.gameCount, state.venue, (i, tot) =>
                setProgress(Math.round(i / tot * 40), `Analysing ${t1.name}... (${i}/${tot})`)),
            fetchTeamData(t2.id, state.gameCount, state.venue, (i, tot) =>
                setProgress(40 + Math.round(i / tot * 40), `Analysing ${t2.name}... (${i}/${tot})`))
        ]);

        setProgress(85, 'Fetching head-to-head...');
        let h2h = [];
        try { h2h = await getH2H(t1.id, t2.id); } catch (_) {}

        setProgress(100, 'Building report...');
        await sleep(300);

        document.getElementById('analyseLoading').classList.add('hidden');
        renderResults(t1, t2, data1, data2, h2h);
        updateApiUsage();
    } catch (e) {
        document.getElementById('analyseLoading').classList.add('hidden');
        document.getElementById('errorMsg').textContent = e.message;
        document.getElementById('analyseError').classList.remove('hidden');
    }
}

function setProgress(pct, text) {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('progFill').style.width = pct + '%';
}

// ─── Render Results ───────────────────────────────────────────────────────────
function renderResults(t1, t2, data1, data2, h2h) {
    const avgs1 = calcAverages(data1);
    const avgs2 = calcAverages(data2);
    const preds = predictMatch(avgs1, avgs2);

    state.currentT1    = t1;
    state.currentT2    = t2;
    state.currentPreds = preds;

    renderHero(t1, t2, avgs1, avgs2, data1, data2, h2h);
    renderStats(t1, t2, avgs1, avgs2);
    renderPredictions(t1, t2, preds);
    renderH2H(t1, t2, h2h);
    renderForm(t1, t2, data1, data2);

    document.querySelectorAll('.rtab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-rtab="stats"]').classList.add('active');
    ['stats','predictions','h2h','form'].forEach(id => {
        document.getElementById(`${id}Pane`).classList.toggle('hidden', id !== 'stats');
    });

    // Save button
    const saveBtn = document.getElementById('saveAnalysisBtn');
    if (saveBtn) {
        saveBtn.textContent = '💾 Save Analysis';
        saveBtn.disabled    = false;
        saveBtn.className   = 'save-btn';
        saveBtn.onclick = async () => {
            if (!getUser()) { openAuthModal('login'); return; }
            try {
                saveBtn.textContent = 'Saving...';
                saveBtn.disabled    = true;
                await saveAnalysis(t1, t2, {
                    wdl: preds.wdl,
                    goals: { predicted: preds.goals.predicted },
                    btts:  { prob: preds.btts.prob }
                });
                saveBtn.textContent = '✓ Saved';
                saveBtn.className   = 'save-btn saved';
            } catch (e) {
                saveBtn.textContent = '💾 Save Analysis';
                saveBtn.disabled    = false;
                alert('Could not save: ' + e.message);
            }
        };
    }

    document.getElementById('results').classList.remove('hidden');
    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function renderHero(t1, t2, avgs1, avgs2, data1, data2, h2h) {
    h2h = h2h || [];

    const fmtDate = dateStr => {
        const d = new Date(dateStr);
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
    };

    let f1 = [], f2 = [], formLabel = 'Recent Form';
    const h2hGames = h2h.filter(fx => fx.goals.home !== null && fx.goals.away !== null).slice(0, 5);

    if (h2hGames.length > 0) {
        formLabel = `Last ${h2hGames.length} H2H`;
        h2hGames.forEach(fx => {
            const isT1Home = fx.teams.home.id === t1.id;
            const t1g = isT1Home ? fx.goals.home : fx.goals.away;
            const t2g = isT1Home ? fx.goals.away : fx.goals.home;
            let t1r, t2r;
            if (t1g > t2g)      { t1r = 'W'; t2r = 'L'; }
            else if (t1g < t2g) { t1r = 'L'; t2r = 'W'; }
            else                { t1r = 'D'; t2r = 'D'; }
            f1.push({ result: t1r, date: fx.fixture.date });
            f2.push({ result: t2r, date: fx.fixture.date });
        });
    } else {
        // fallback to each team's own recent form — equalise counts
        f1 = data1.slice(0, 5).map(m => ({ result: m.result, date: m.date }));
        f2 = data2.slice(0, 5).map(m => ({ result: m.result, date: m.date }));
        const minLen = Math.min(f1.length, f2.length);
        f1 = f1.slice(0, minLen);
        f2 = f2.slice(0, minLen);
    }

    const pipsHtml = arr => arr.map(item => `
        <div class="form-pip-wrap">
            <span class="form-pip ${item.result}">${item.result}</span>
            <span class="form-pip-date">${fmtDate(item.date)}</span>
        </div>
    `).join('');

    document.getElementById('matchHeaderCard').innerHTML = `
        <div class="hero-inner">
            <div class="hero-team">
                <img class="hero-logo" src="${t1.logo}" alt="${t1.name}" onerror="this.style.display='none'">
                <div class="hero-name">${t1.name}</div>
                <div class="hero-form">${pipsHtml(f1)}</div>
                <div class="hero-record">${avgs1.wins}W · ${avgs1.draws}D · ${avgs1.losses}L</div>
                <button class="pin-team-btn" onclick="pinTeam(${JSON.stringify({ id: t1.id, name: t1.name, logo: t1.logo }).replace(/"/g,'&quot;')})">📌 Pin</button>
            </div>
            <div class="hero-vs-wrap">
                <div class="hero-vs">VS</div>
                <div class="hero-form-label">${formLabel}</div>
            </div>
            <div class="hero-team">
                <img class="hero-logo" src="${t2.logo}" alt="${t2.name}" onerror="this.style.display='none'">
                <div class="hero-name">${t2.name}</div>
                <div class="hero-form">${pipsHtml(f2)}</div>
                <div class="hero-record">${avgs2.wins}W · ${avgs2.draws}D · ${avgs2.losses}L</div>
                <button class="pin-team-btn" onclick="pinTeam(${JSON.stringify({ id: t2.id, name: t2.name, logo: t2.logo }).replace(/"/g,'&quot;')})">📌 Pin</button>
            </div>
        </div>
    `;
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function renderStats(t1, t2, avgs1, avgs2) {
    const rows = [
        { label: 'Goals Scored',      a: avgs1.goals,                           b: avgs2.goals },
        { label: 'Goals Conceded',    a: avgs1.goalsConceded,                   b: avgs2.goalsConceded },
        { label: 'Shots',             a: avgs1.shots,                           b: avgs2.shots },
        { label: 'Shots on Target',   a: avgs1.shotsOnTarget,                   b: avgs2.shotsOnTarget },
        { label: 'Corners',           a: avgs1.corners,                         b: avgs2.corners },
        { label: 'Possession %',      a: avgs1.possession,                      b: avgs2.possession },
        { label: 'Fouls',             a: avgs1.fouls,                           b: avgs2.fouls },
        { label: 'Yellow Cards',      a: avgs1.yellowCards,                     b: avgs2.yellowCards },
        { label: 'Clean Sheets %',    a: Math.round(avgs1.cleanSheetRate * 100), b: Math.round(avgs2.cleanSheetRate * 100) },
        { label: 'Scored in Game %',  a: Math.round(avgs1.scoredRate * 100),    b: Math.round(avgs2.scoredRate * 100) }
    ];
    const fmt = v => typeof v === 'number' && v % 1 !== 0 ? v.toFixed(1) : v;
    document.getElementById('statsContent').innerHTML = `
        <div class="stats-header"><span>${t1.name}</span><span>${t2.name}</span></div>
        ${rows.map(r => {
            const tot = (r.a + r.b) || 1;
            const lp  = Math.round(r.a / tot * 100);
            return `
            <div class="stat-row">
                <span class="stat-num">${fmt(r.a)}</span>
                <div class="stat-center">
                    <div class="stat-name">${r.label}</div>
                    <div class="stat-bar">
                        <div class="stat-bar-l" style="width:${lp}%"></div>
                        <div class="stat-bar-r"></div>
                    </div>
                </div>
                <span class="stat-num">${fmt(r.b)}</span>
            </div>`;
        }).join('')}
    `;
}

// ─── Predictions ──────────────────────────────────────────────────────────────
function renderPredictions(t1, t2, preds) {
    const el = document.getElementById('predictionsContent');
    el.innerHTML = '';

    // W/D/L outcome card (Dixon-Coles)
    const wdl = preds.wdl;
    const topIdx = [wdl.homeWin, wdl.draw, wdl.awayWin].indexOf(Math.max(wdl.homeWin, wdl.draw, wdl.awayWin));
    const wdlDiv = document.createElement('div');
    wdlDiv.className = 'pred-card';
    wdlDiv.innerHTML = `
        <div class="pred-card-title">🏆 Match Result — Dixon-Coles Model</div>
        <div class="wdl-row">
            <div class="wdl-box ${topIdx === 0 ? 'wdl-top' : ''}">
                <div class="wdl-team">${t1.name.split(' ')[0]} Win</div>
                <div class="wdl-pct">${wdl.homeWin}%</div>
            </div>
            <div class="wdl-box ${topIdx === 1 ? 'wdl-top' : ''}">
                <div class="wdl-team">Draw</div>
                <div class="wdl-pct">${wdl.draw}%</div>
            </div>
            <div class="wdl-box ${topIdx === 2 ? 'wdl-top' : ''}">
                <div class="wdl-team">${t2.name.split(' ')[0]} Win</div>
                <div class="wdl-pct">${wdl.awayWin}%</div>
            </div>
        </div>
        <div class="pred-lines">
            ${[
                { label: t1.name.split(' ')[0], pct: wdl.homeWin },
                { label: 'Draw',                 pct: wdl.draw },
                { label: t2.name.split(' ')[0], pct: wdl.awayWin }
            ].map(row => {
                const cls = row.pct >= 50 ? 'high' : row.pct >= 30 ? 'medium' : 'low';
                return `<div class="pred-line">
                    <span class="pred-line-label">${row.label}</span>
                    <div class="pred-line-track">
                        <div class="pred-line-bar ${cls}" style="width:${Math.min(row.pct,100)}%">${row.pct >= 15 ? row.pct+'%' : ''}</div>
                    </div>
                    <span class="pred-line-pct">${row.pct}%</span>
                </div>`;
            }).join('')}
        </div>
        <div class="pred-model-note">Dixon-Coles model · Home advantage applied · Weighted recent form</div>
    `;
    el.appendChild(wdlDiv);

    // BTTS
    const b   = preds.btts;
    const cls = b.prob >= 65 ? 'high' : b.prob >= 40 ? 'medium' : 'low';
    const bttsDiv = document.createElement('div');
    bttsDiv.className = 'btts-card';
    bttsDiv.innerHTML = `
        <div class="btts-title">⚽ Both Teams to Score</div>
        <div class="btts-pct ${cls}">${b.prob}%</div>
        <div class="btts-sub">probability both teams score</div>
        <div class="btts-grid">
            <div class="btts-stat"><div class="btts-stat-val">${b.team1ScoredPct}%</div><div class="btts-stat-lbl">${t1.name.split(' ')[0]} scored</div></div>
            <div class="btts-stat"><div class="btts-stat-val">${b.team2ScoredPct}%</div><div class="btts-stat-lbl">${t2.name.split(' ')[0]} scored</div></div>
            <div class="btts-stat"><div class="btts-stat-val">${b.team1CSPct}%</div><div class="btts-stat-lbl">${t1.name.split(' ')[0]} clean sheet</div></div>
            <div class="btts-stat"><div class="btts-stat-val">${b.team2CSPct}%</div><div class="btts-stat-lbl">${t2.name.split(' ')[0]} clean sheet</div></div>
        </div>
    `;
    el.appendChild(bttsDiv);

    // Market predictions
    const markets = [
        { key: 'goals',         icon: '⚽', title: 'Total Goals' },
        { key: 'corners',       icon: '🚩', title: 'Total Corners' },
        { key: 'shots',         icon: '🎯', title: 'Total Shots' },
        { key: 'shotsOnTarget', icon: '🥅', title: 'Shots on Target' },
        { key: 'cards',         icon: '🟨', title: 'Total Cards' },
        { key: 'fouls',         icon: '🦶', title: 'Total Fouls' }
    ];
    markets.forEach(m => {
        const p   = preds[m.key];
        const div = document.createElement('div');
        div.className = 'pred-card';
        div.innerHTML = `
            <div class="pred-card-title">${m.icon} ${m.title}</div>
            <div class="pred-avgs">
                <div class="pred-avg-box"><div class="pred-avg-val">${p.avgTeam1}</div><div class="pred-avg-lbl">${t1.name.split(' ')[0]}</div></div>
                <div class="pred-avg-box highlight"><div class="pred-avg-val">${p.predicted}</div><div class="pred-avg-lbl">Predicted</div></div>
                <div class="pred-avg-box"><div class="pred-avg-val">${p.avgTeam2}</div><div class="pred-avg-lbl">${t2.name.split(' ')[0]}</div></div>
            </div>
            <div class="pred-lines">
                ${p.lines.map(l => {
                    const lc = l.over >= 65 ? 'high' : l.over >= 40 ? 'medium' : 'low';
                    return `<div class="pred-line">
                        <span class="pred-line-label">${l.label}</span>
                        <div class="pred-line-track">
                            <div class="pred-line-bar ${lc}" style="width:${Math.min(l.over,100)}%">${l.over >= 15 ? l.over+'%' : ''}</div>
                        </div>
                        <span class="pred-line-pct">${l.over}%</span>
                    </div>`;
                }).join('')}
            </div>
        `;
        el.appendChild(div);
    });
}

// ─── H2H ─────────────────────────────────────────────────────────────────────
function renderH2H(t1, t2, h2h) {
    const el = document.getElementById('h2hContent');
    if (!h2h || !h2h.length) {
        el.innerHTML = `
            <div class="no-h2h-notice">
                <div class="no-h2h-icon">⚠️</div>
                <div class="no-h2h-title">No Head-to-Head History Found</div>
                <p class="no-h2h-text">These teams have no recorded meetings in the database. Predictions are based on each team's individual recent form only, which may reduce accuracy for this specific matchup.</p>
            </div>
        `;
        return;
    }
    let w = 0, d = 0, l = 0;
    h2h.forEach(fx => {
        const hg = fx.goals.home, ag = fx.goals.away;
        if (hg === null || ag === null) return;
        const isHome = fx.teams.home.id === t1.id;
        const mine = isHome ? hg : ag, theirs = isHome ? ag : hg;
        if (mine > theirs) w++; else if (theirs > mine) l++; else d++;
    });
    el.innerHTML = `
        <div style="font-size:14px;font-weight:800;margin-bottom:16px">Head to Head — Last ${h2h.length} Meetings</div>
        <div class="h2h-record">
            <div class="h2h-box w-box"><div class="h2h-box-num">${w}</div><div class="h2h-box-lbl">${t1.name.split(' ')[0]} wins</div></div>
            <div class="h2h-box d-box"><div class="h2h-box-num">${d}</div><div class="h2h-box-lbl">Draws</div></div>
            <div class="h2h-box l-box"><div class="h2h-box-num">${l}</div><div class="h2h-box-lbl">${t2.name.split(' ')[0]} wins</div></div>
        </div>
        ${h2h.slice(0, 8).map(fx => `
        <div class="h2h-row">
            <div class="h2h-teams">
                <span class="h2h-team">${fx.teams.home.name}</span>
                <span class="h2h-score">${fx.goals.home ?? '?'} – ${fx.goals.away ?? '?'}</span>
                <span class="h2h-team">${fx.teams.away.name}</span>
            </div>
            <div class="h2h-meta">
                <div class="h2h-date">${fx.fixture.date.split('T')[0]}</div>
                <div class="h2h-comp">${fx.league.name}</div>
            </div>
        </div>`).join('')}
    `;
}

// ─── Form Table ───────────────────────────────────────────────────────────────
function renderForm(t1, t2, data1, data2) {
    const tbl = (team, data) => `
        <div class="form-section-title">${team.name} — Last ${data.length} Games</div>
        <table class="form-table">
            <thead><tr><th>Date</th><th>Opponent</th><th>Res</th><th>GF</th><th>GA</th><th>Shots</th><th>Corners</th></tr></thead>
            <tbody>
                ${data.map(m => `<tr>
                    <td style="color:var(--text-muted)">${m.date}</td>
                    <td style="font-weight:600">${m.opponent}</td>
                    <td><span class="result-pip ${m.result}">${m.result}</span></td>
                    <td style="font-weight:700">${m.goalsScored}</td>
                    <td style="color:var(--text-muted)">${m.goalsConceded}</td>
                    <td style="color:var(--text-muted)">${m.shots || '—'}</td>
                    <td style="color:var(--text-muted)">${m.corners || '—'}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    document.getElementById('formContent').innerHTML = `
        ${tbl(t1, data1)}
        <div style="margin-top:28px;padding-top:24px;border-top:1px solid var(--border)">${tbl(t2, data2)}</div>
    `;
}
