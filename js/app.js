/* PitchIQ — Main App */

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
    team1: null, team2: null,
    gameCount: 5, venue: 'all',
    activeLeague: 'all',
    liveRefreshInterval: null,
    countdownInterval: null,
    nextRefresh: null,
    REFRESH_SECS: 60,
    lastFixtures: [],
    searchTimers: { t1: null, t2: null }
};

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const key = getApiKey();
    if (key) {
        showApp();
    } else {
        document.getElementById('apiKeyModal').classList.remove('hidden');
    }

    document.getElementById('saveKeyBtn').addEventListener('click', saveKey);
    document.getElementById('apiKeyInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') saveKey();
    });
});

function saveKey() {
    const val = document.getElementById('apiKeyInput').value.trim();
    if (!val) return;
    localStorage.setItem('piq_key', val);
    document.getElementById('apiKeyModal').classList.add('hidden');
    showApp();
}

function showApp() {
    document.getElementById('app').classList.remove('hidden');
    initTabs();
    initLeagueFilter();
    initAnalyseTab();
    initSettings();
    initRefreshBtn();
    loadLiveTab();
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.dataset.tab;
            document.getElementById('liveTab').classList.toggle('active', target === 'live');
            document.getElementById('liveTab').classList.toggle('hidden', target !== 'live');
            document.getElementById('analyseTab').classList.toggle('active', target === 'analyse');
            document.getElementById('analyseTab').classList.toggle('hidden', target !== 'analyse');
        });
    });
}

// ─── League Filter ───────────────────────────────────────────────────────────
function initLeagueFilter() {
    document.querySelectorAll('#leagueFilter .fchip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#leagueFilter .fchip').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            state.activeLeague = btn.dataset.league;
            renderFixtures(state.lastFixtures);
        });
    });
}

// ─── Live Tab ────────────────────────────────────────────────────────────────
async function loadLiveTab(force = false) {
    try {
        const fixtures = await getTodayFixtures(force);
        state.lastFixtures = fixtures || [];
        renderFixtures(state.lastFixtures);
        updateApiUsage();
    } catch (e) {
        document.getElementById('liveList').innerHTML = `<div class="empty-msg">${e.message}</div>`;
        document.getElementById('todayList').innerHTML = '';
    }
    scheduleNextRefresh();
}

function renderFixtures(fixtures) {
    const league = state.activeLeague;
    const filtered = league === 'all' ? fixtures : fixtures.filter(fx => String(fx.league.id) === league);

    const live  = filtered.filter(fx => isLive(fx));
    const today = filtered.filter(fx => !isLive(fx) && !isFinished(fx));
    const done  = filtered.filter(fx => isFinished(fx));

    const liveEl  = document.getElementById('liveList');
    const todayEl = document.getElementById('todayList');

    // Date label
    const now = new Date();
    document.getElementById('todayDateLbl').textContent =
        now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

    liveEl.innerHTML  = live.length  ? '' : '<div class="empty-msg">No live games right now</div>';
    todayEl.innerHTML = (today.length + done.length) ? '' : '<div class="empty-msg">No fixtures found</div>';

    live.forEach(fx  => liveEl.appendChild(buildMatchCard(fx, 'live')));
    today.forEach(fx => todayEl.appendChild(buildMatchCard(fx, 'upcoming')));
    done.forEach(fx  => todayEl.appendChild(buildMatchCard(fx, 'finished')));
}

function buildMatchCard(fx, type) {
    const card = document.createElement('div');
    card.className = `match-card${type === 'live' ? ' live-card' : ''} fade-in`;

    const homeTeam = fx.teams.home;
    const awayTeam = fx.teams.away;
    const hScore = fx.goals.home ?? '–';
    const aScore = fx.goals.away ?? '–';
    const minute = fx.fixture.status.elapsed;
    const status = fx.fixture.status.short;

    let statusHtml = '';
    if (type === 'live') {
        const minStr = minute ? `${minute}'` : status;
        statusHtml = `<span class="live-badge"><span class="live-badge-dot"></span>${minStr}</span>`;
    } else if (type === 'finished') {
        statusHtml = `<span class="time-badge">FT</span>`;
    } else {
        statusHtml = `<span class="time-badge">${formatKickoff(fx)}</span>`;
    }

    const homeScoreHtml = type !== 'upcoming' ? `<span class="score">${hScore}</span>` : '';
    const awayScoreHtml = type !== 'upcoming' ? `<span class="score">${aScore}</span>` : '';

    card.innerHTML = `
        <div class="match-league">
            <span class="league-name">${fx.league.country} · ${fx.league.name}</span>
            ${statusHtml}
        </div>
        <div class="match-body">
            <div class="team-side">
                <img class="team-logo" src="${homeTeam.logo}" alt="${homeTeam.name}" onerror="this.style.display='none'">
                <span class="team-name">${homeTeam.name}</span>
            </div>
            <div class="score-block">
                ${type === 'upcoming'
                    ? `<div class="kickoff-time">${formatKickoff(fx)}</div><div style="font-size:11px;color:var(--muted);margin-top:2px">vs</div>`
                    : `<div style="display:flex;align-items:center">${homeScoreHtml}<span class="score-sep">-</span>${awayScoreHtml}</div>`
                }
            </div>
            <div class="team-side right">
                <img class="team-logo" src="${awayTeam.logo}" alt="${awayTeam.name}" onerror="this.style.display='none'">
                <span class="team-name">${awayTeam.name}</span>
            </div>
        </div>
        <div class="analyse-hint">Tap to analyse →</div>
    `;

    card.addEventListener('click', () => prefillTeams(homeTeam, awayTeam));
    return card;
}

function prefillTeams(home, away) {
    // Switch to analyse tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="analyse"]').classList.add('active');
    document.getElementById('liveTab').classList.add('hidden');
    document.getElementById('liveTab').classList.remove('active');
    document.getElementById('analyseTab').classList.remove('hidden');
    document.getElementById('analyseTab').classList.add('active');

    setTeam(1, { id: home.id, name: home.name, logo: home.logo });
    setTeam(2, { id: away.id, name: away.name, logo: away.logo });
}

// ─── Countdown / Auto-refresh ─────────────────────────────────────────────────
function scheduleNextRefresh() {
    clearInterval(state.liveRefreshInterval);
    clearInterval(state.countdownInterval);

    state.nextRefresh = Date.now() + state.REFRESH_SECS * 1000;

    state.countdownInterval = setInterval(() => {
        const remaining = Math.max(0, Math.round((state.nextRefresh - Date.now()) / 1000));
        const el = document.getElementById('countdown');
        if (el) el.textContent = remaining + 's';
        if (remaining === 0) {
            clearInterval(state.countdownInterval);
            loadLiveTab(true);
        }
    }, 1000);
}

function initRefreshBtn() {
    document.getElementById('refreshBtn').addEventListener('click', () => loadLiveTab(true));
}

// ─── API Usage ────────────────────────────────────────────────────────────────
function updateApiUsage() {
    const el = document.getElementById('apiUsage');
    if (!el) return;
    const rem = window._apiRemaining;
    if (rem === undefined || rem === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = `${rem} calls left`;
    el.className = 'api-badge';
    if (rem <= 10) el.classList.add('critical');
    else if (rem <= 30) el.classList.add('low');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function initSettings() {
    const btn  = document.getElementById('settingsBtn');
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay hidden';
    overlay.innerHTML = `
        <div class="settings-sheet">
            <div class="settings-title">Settings</div>
            <div class="settings-row">
                <span class="settings-lbl">API Key</span>
            </div>
            <input type="text" class="settings-input" id="settingsKeyInput" placeholder="RapidAPI key..." spellcheck="false" autocomplete="off">
            <button class="btn-cta" id="settingsSaveBtn" style="margin-bottom:10px">Save Key</button>
            <button class="settings-close" id="settingsClose">Close</button>
        </div>
    `;
    document.body.appendChild(overlay);

    btn.addEventListener('click', () => {
        document.getElementById('settingsKeyInput').value = getApiKey() || '';
        overlay.classList.remove('hidden');
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
    overlay.querySelector('#settingsClose').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.querySelector('#settingsSaveBtn').addEventListener('click', () => {
        const v = overlay.querySelector('#settingsKeyInput').value.trim();
        if (v) { localStorage.setItem('piq_key', v); overlay.classList.add('hidden'); loadLiveTab(true); }
    });
}

// ─── Analyse Tab ─────────────────────────────────────────────────────────────
function initAnalyseTab() {
    initTeamSearch(1, 'team1Input', 'team1Drop', 'team1Pill');
    initTeamSearch(2, 'team2Input', 'team2Drop', 'team2Pill');

    document.querySelectorAll('#gameCountChips .chip').forEach(c => {
        c.addEventListener('click', () => {
            document.querySelectorAll('#gameCountChips .chip').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            state.gameCount = parseInt(c.dataset.val, 10);
        });
    });

    document.querySelectorAll('#venueChips .chip').forEach(c => {
        c.addEventListener('click', () => {
            document.querySelectorAll('#venueChips .chip').forEach(x => x.classList.remove('active'));
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
                const el = document.getElementById(`${id}Pane`);
                el.classList.toggle('hidden', id !== t);
            });
        });
    });

    document.getElementById('retryBtn').addEventListener('click', runAnalysis);
}

// ─── Team Search ──────────────────────────────────────────────────────────────
function initTeamSearch(n, inputId, dropId, pillId) {
    const input = document.getElementById(inputId);
    const drop  = document.getElementById(dropId);
    const pill  = document.getElementById(pillId);

    input.addEventListener('input', () => {
        clearTimeout(state.searchTimers[`t${n}`]);
        const q = input.value.trim();
        if (q.length < 2) { drop.classList.add('hidden'); return; }
        state.searchTimers[`t${n}`] = setTimeout(async () => {
            try {
                drop.innerHTML = '<div class="drop-item" style="color:var(--muted)">Searching...</div>';
                drop.classList.remove('hidden');
                const results = await searchTeams(q);
                renderDrop(results, drop, n, input, pill);
            } catch (e) {
                drop.innerHTML = `<div class="drop-item" style="color:var(--red)">${e.message}</div>`;
            }
        }, 350);
    });

    document.addEventListener('click', e => {
        if (!input.contains(e.target) && !drop.contains(e.target)) drop.classList.add('hidden');
    });
}

function renderDrop(results, drop, n, input, pill) {
    drop.innerHTML = '';
    if (!results || !results.length) {
        drop.innerHTML = '<div class="drop-item" style="color:var(--muted)">No teams found</div>';
        return;
    }
    results.slice(0, 10).forEach(r => {
        const team = r.team;
        const div = document.createElement('div');
        div.className = 'drop-item';
        div.innerHTML = `
            <img class="drop-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">
            <div>
                <div style="font-weight:700">${team.name}</div>
                <div class="drop-country">${r.team.country || ''}</div>
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
    if (n === 1) state.team1 = team;
    else state.team2 = team;

    const pillId = `team${n}Pill`;
    const el = document.getElementById(pillId);
    el.innerHTML = `
        <div class="team-pill">
            <img class="pill-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">
            <span>${team.name}</span>
            <button class="pill-x" data-n="${n}">×</button>
        </div>
    `;
    el.classList.remove('hidden');
    el.querySelector('.pill-x').addEventListener('click', () => clearTeam(n));
    checkAnalyseReady();
}

function clearTeam(n) {
    if (n === 1) state.team1 = null;
    else state.team2 = null;
    document.getElementById(`team${n}Pill`).classList.add('hidden');
    document.getElementById(`team${n}Input`).value = '';
    checkAnalyseReady();
}

function checkAnalyseReady() {
    document.getElementById('analyseBtn').disabled = !(state.team1 && state.team2);
}

// ─── Analysis ─────────────────────────────────────────────────────────────────
async function runAnalysis() {
    if (!state.team1 || !state.team2) return;

    hideResults();
    document.getElementById('analyseError').classList.add('hidden');
    document.getElementById('analyseLoading').classList.remove('hidden');

    const t1 = state.team1, t2 = state.team2;
    let data1, data2, h2h;

    try {
        setProgress(0, 'Fetching fixtures...');
        const [r1, r2] = await Promise.all([
            fetchTeamData(t1.id, state.gameCount, state.venue, (i, total) => {
                setProgress(Math.round((i / total) * 40), `Analysing ${t1.name}... (${i}/${total})`);
            }),
            fetchTeamData(t2.id, state.gameCount, state.venue, (i, total) => {
                setProgress(40 + Math.round((i / total) * 40), `Analysing ${t2.name}... (${i}/${total})`);
            })
        ]);
        data1 = r1; data2 = r2;

        setProgress(85, 'Fetching head-to-head...');
        try { h2h = await getH2H(t1.id, t2.id); } catch (_) { h2h = []; }

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

function hideResults() {
    document.getElementById('results').classList.add('hidden');
}

// ─── Render Results ───────────────────────────────────────────────────────────
function renderResults(t1, t2, data1, data2, h2h) {
    const avgs1 = calcAverages(data1);
    const avgs2 = calcAverages(data2);
    const preds = predictMatch(avgs1, avgs2);

    renderMatchHeader(t1, t2, avgs1, avgs2, data1, data2);
    renderStats(t1, t2, avgs1, avgs2);
    renderPredictions(t1, t2, preds);
    renderH2H(t1, t2, h2h);
    renderForm(t1, t2, data1, data2);

    // Reset to stats tab
    document.querySelectorAll('.rtab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-rtab="stats"]').classList.add('active');
    ['stats','predictions','h2h','form'].forEach(id => {
        document.getElementById(`${id}Pane`).classList.toggle('hidden', id !== 'stats');
    });

    document.getElementById('results').classList.remove('hidden');
    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMatchHeader(t1, t2, avgs1, avgs2, data1, data2) {
    const card = document.getElementById('matchHeaderCard');
    const form1 = data1.slice(-5).map(m => m.result);
    const form2 = data2.slice(-5).map(m => m.result);

    card.innerHTML = `
        <div class="match-header">
            <div class="mh-team">
                <img class="mh-logo" src="${t1.logo}" alt="${t1.name}" onerror="this.style.display='none'">
                <div class="mh-name">${t1.name}</div>
                <div class="mh-form">${form1.map(r => `<span class="form-badge ${r}">${r}</span>`).join('')}</div>
                <div class="mh-record">${avgs1.wins}W ${avgs1.draws}D ${avgs1.losses}L</div>
            </div>
            <div class="mh-vs">VS</div>
            <div class="mh-team right">
                <img class="mh-logo" src="${t2.logo}" alt="${t2.name}" onerror="this.style.display='none'">
                <div class="mh-name">${t2.name}</div>
                <div class="mh-form">${form2.map(r => `<span class="form-badge ${r}">${r}</span>`).join('')}</div>
                <div class="mh-record">${avgs2.wins}W ${avgs2.draws}D ${avgs2.losses}L</div>
            </div>
        </div>
    `;
}

function renderStats(t1, t2, avgs1, avgs2) {
    const rows = [
        { label: 'Goals Scored',     a: avgs1.goals,         b: avgs2.goals },
        { label: 'Goals Conceded',   a: avgs1.goalsConceded, b: avgs2.goalsConceded },
        { label: 'Shots',            a: avgs1.shots,         b: avgs2.shots },
        { label: 'Shots on Target',  a: avgs1.shotsOnTarget, b: avgs2.shotsOnTarget },
        { label: 'Corners',          a: avgs1.corners,       b: avgs2.corners },
        { label: 'Possession %',     a: avgs1.possession,    b: avgs2.possession },
        { label: 'Fouls',            a: avgs1.fouls,         b: avgs2.fouls },
        { label: 'Yellow Cards',     a: avgs1.yellowCards,   b: avgs2.yellowCards },
        { label: 'Clean Sheets %',   a: avgs1.cleanSheetRate * 100, b: avgs2.cleanSheetRate * 100 },
        { label: 'Scored in Game %', a: avgs1.scoredRate * 100,     b: avgs2.scoredRate * 100 }
    ];

    const el = document.getElementById('statsContent');
    el.innerHTML = `
        <div class="card-title">Average Stats (last ${state.gameCount} games)</div>
        <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:var(--muted);margin-bottom:8px;padding:0 4px">
            <span>${t1.name}</span><span>${t2.name}</span>
        </div>
        ${rows.map(r => {
            const total = r.a + r.b || 1;
            const leftPct = Math.round(r.a / total * 100);
            return `
            <div class="stat-row">
                <span class="stat-val">${r.a.toFixed(1)}</span>
                <div class="stat-label-wrap">
                    <div class="stat-name">${r.label}</div>
                    <div class="stat-bar-row">
                        <div class="stat-bar-left" style="width:${leftPct}%"></div>
                        <div class="stat-bar-right"></div>
                    </div>
                </div>
                <span class="stat-val">${r.b.toFixed(1)}</span>
            </div>`;
        }).join('')}
    `;
}

function renderPredictions(t1, t2, preds) {
    const el = document.getElementById('predictionsContent');
    el.innerHTML = '';

    // BTTS
    const btts = preds.btts;
    const bttsClass = btts.prob >= 65 ? 'high' : btts.prob >= 40 ? 'medium' : 'low';
    const bttsCard = document.createElement('div');
    bttsCard.className = 'btts-card';
    bttsCard.innerHTML = `
        <div class="btts-title">Both Teams to Score</div>
        <div class="btts-prob ${bttsClass}">${btts.prob}%</div>
        <div class="btts-sublabel">probability</div>
        <div class="btts-breakdown">
            <div class="btts-stat">
                <div class="btts-stat-val">${btts.team1ScoredPct}%</div>
                <div class="btts-stat-lbl">${t1.name.split(' ')[0]} scored</div>
            </div>
            <div class="btts-stat">
                <div class="btts-stat-val">${btts.team2ScoredPct}%</div>
                <div class="btts-stat-lbl">${t2.name.split(' ')[0]} scored</div>
            </div>
            <div class="btts-stat">
                <div class="btts-stat-val">${btts.team1CSPct}%</div>
                <div class="btts-stat-lbl">${t1.name.split(' ')[0]} CS</div>
            </div>
            <div class="btts-stat">
                <div class="btts-stat-val">${btts.team2CSPct}%</div>
                <div class="btts-stat-lbl">${t2.name.split(' ')[0]} CS</div>
            </div>
        </div>
    `;
    el.appendChild(bttsCard);

    // Other market cards
    const markets = [
        { key: 'goals',         icon: '⚽', title: 'Total Goals' },
        { key: 'corners',       icon: '🚩', title: 'Total Corners' },
        { key: 'shots',         icon: '🎯', title: 'Total Shots' },
        { key: 'shotsOnTarget', icon: '🥅', title: 'Shots on Target' },
        { key: 'cards',         icon: '🟨', title: 'Total Cards' },
        { key: 'fouls',         icon: '🦶', title: 'Total Fouls' }
    ];

    markets.forEach(m => {
        const pred = preds[m.key];
        const card = document.createElement('div');
        card.className = 'pred-card';
        card.innerHTML = `
            <div class="pred-title">${m.icon} ${m.title}</div>
            <div class="pred-averages">
                <div class="pred-avg">
                    <div class="pred-avg-val">${pred.avgTeam1}</div>
                    <div class="pred-avg-lbl">${t1.name.split(' ')[0]}</div>
                </div>
                <div class="pred-avg" style="background:var(--bg);border:1px solid var(--border)">
                    <div class="pred-avg-val" style="color:var(--accent)">${pred.predicted}</div>
                    <div class="pred-avg-lbl">Predicted</div>
                </div>
                <div class="pred-avg">
                    <div class="pred-avg-val">${pred.avgTeam2}</div>
                    <div class="pred-avg-lbl">${t2.name.split(' ')[0]}</div>
                </div>
            </div>
            <div class="pred-lines">
                ${pred.lines.map(l => {
                    const cls = l.over >= 65 ? 'high' : l.over >= 40 ? 'medium' : 'low';
                    return `
                    <div class="pred-line">
                        <span class="pred-line-lbl">${l.label}</span>
                        <div class="pred-line-track">
                            <div class="pred-line-fill ${cls}" style="width:${Math.min(l.over, 100)}%">
                                ${l.over >= 15 ? l.over + '%' : ''}
                            </div>
                        </div>
                        <span class="pred-line-pct">${l.over}%</span>
                    </div>`;
                }).join('')}
            </div>
        `;
        el.appendChild(card);
    });
}

function renderH2H(t1, t2, h2h) {
    const el = document.getElementById('h2hContent');
    if (!h2h || !h2h.length) {
        el.innerHTML = '<div class="empty-msg">No head-to-head data found</div>';
        return;
    }

    let t1wins = 0, t2wins = 0, draws = 0;
    h2h.forEach(fx => {
        const h = fx.goals.home, a = fx.goals.away;
        if (h === null || a === null) return;
        const homeIsT1 = fx.teams.home.id === t1.id;
        const t1goals = homeIsT1 ? h : a, t2goals = homeIsT1 ? a : h;
        if (t1goals > t2goals) t1wins++;
        else if (t2goals > t1goals) t2wins++;
        else draws++;
    });

    el.innerHTML = `
        <div class="card-title">Head to Head (last ${h2h.length})</div>
        <div class="h2h-summary">
            <div class="h2h-box win">
                <div class="h2h-box-val" style="color:var(--accent)">${t1wins}</div>
                <div class="h2h-box-lbl">${t1.name.split(' ')[0]}</div>
            </div>
            <div class="h2h-box draw">
                <div class="h2h-box-val" style="color:var(--gold)">${draws}</div>
                <div class="h2h-box-lbl">Draws</div>
            </div>
            <div class="h2h-box loss">
                <div class="h2h-box-val" style="color:var(--red)">${t2wins}</div>
                <div class="h2h-box-lbl">${t2.name.split(' ')[0]}</div>
            </div>
        </div>
        ${h2h.slice(0, 8).map(fx => {
            const home = fx.teams.home.name, away = fx.teams.away.name;
            const hg = fx.goals.home ?? '?', ag = fx.goals.away ?? '?';
            const date = fx.fixture.date.split('T')[0];
            return `
            <div class="h2h-game">
                <div>
                    <div class="h2h-names">
                        <span class="h2h-team">${home}</span>
                        <span class="h2h-score">${hg} – ${ag}</span>
                        <span class="h2h-team">${away}</span>
                    </div>
                    <div class="h2h-date">${date}</div>
                </div>
                <div class="h2h-comp">${fx.league.name}</div>
            </div>`;
        }).join('')}
    `;
}

function renderForm(t1, t2, data1, data2) {
    const el = document.getElementById('formContent');
    const renderTable = (team, data) => `
        <div style="font-size:13px;font-weight:800;margin-bottom:10px">${team.name}</div>
        <table class="form-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Opponent</th>
                    <th>Res</th>
                    <th>GF</th>
                    <th>GA</th>
                    <th>Shots</th>
                    <th>Crns</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(m => `
                <tr>
                    <td style="color:var(--muted)">${m.date}</td>
                    <td>${m.opponent}</td>
                    <td><span class="result-badge ${m.result}">${m.result}</span></td>
                    <td style="font-weight:700">${m.goalsScored}</td>
                    <td style="color:var(--muted)">${m.goalsConceded}</td>
                    <td style="color:var(--muted)">${m.shots}</td>
                    <td style="color:var(--muted)">${m.corners}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;

    el.innerHTML = `
        <div style="margin-bottom:20px">${renderTable(t1, data1)}</div>
        <div style="border-top:1px solid var(--border);padding-top:16px">${renderTable(t2, data2)}</div>
    `;
}
