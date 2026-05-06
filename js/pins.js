/* PitchPredictions — Pins & Saved Analyses (Supabase-backed) */

async function pinTeam(team) {
    if (!getUser()) { openAuthModal('login'); return; }
    await db.from('pinned_teams').upsert({
        user_id:   getUser().id,
        team_id:   team.id,
        team_name: team.name,
        team_logo: team.logo || ''
    });
    await loadPinnedTeams();
}

async function unpinTeam(teamId) {
    if (!getUser()) return;
    await db.from('pinned_teams')
        .delete()
        .eq('user_id', getUser().id)
        .eq('team_id', teamId);
    await loadPinnedTeams();
}

async function loadPinnedTeams() {
    if (!getUser()) { renderPinnedTeams([]); return; }
    const { data } = await db
        .from('pinned_teams')
        .select('*')
        .eq('user_id', getUser().id)
        .order('created_at', { ascending: false });
    renderPinnedTeams(data || []);
}

async function saveAnalysis(t1, t2, predData) {
    if (!getUser()) { openAuthModal('login'); return false; }
    const { error } = await db.from('saved_analyses').insert({
        user_id:    getUser().id,
        team1_id:   t1.id,   team1_name: t1.name, team1_logo: t1.logo || '',
        team2_id:   t2.id,   team2_name: t2.name, team2_logo: t2.logo || '',
        prediction_data: predData
    });
    if (error) throw error;
    await loadSavedAnalyses();
    return true;
}

async function deleteAnalysis(id) {
    if (!getUser()) return;
    await db.from('saved_analyses')
        .delete()
        .eq('id', id)
        .eq('user_id', getUser().id);
    await loadSavedAnalyses();
}

async function loadSavedAnalyses() {
    if (!getUser()) { renderSavedAnalyses([]); return; }
    const { data } = await db
        .from('saved_analyses')
        .select('*')
        .eq('user_id', getUser().id)
        .order('created_at', { ascending: false });
    renderSavedAnalyses(data || []);
}

function renderPinnedTeams(teams) {
    const sidebar  = document.getElementById('pinnedTeamsList');
    const fullList = document.getElementById('pinnedTeamsFullList');

    const sidebarHtml = !getUser()
        ? `<div class="sb-empty sb-login-prompt">
               <a class="sb-login-link" href="#" onclick="openAuthModal('login');return false;">Login</a> to pin your favourite teams
           </div>`
        : teams.length === 0
            ? '<div class="sb-empty">No pinned teams — pin a team from the Analyse tab</div>'
            : teams.map(t => `
                <div class="pinned-team-row">
                    <img src="${t.team_logo}" alt="" width="22" height="22" style="object-fit:contain" onerror="this.style.display='none'">
                    <span class="pinned-team-name">${t.team_name}</span>
                    <button class="pin-remove-btn" data-id="${t.team_id}" title="Unpin">×</button>
                </div>
              `).join('');

    if (sidebar) {
        sidebar.innerHTML = sidebarHtml;
        sidebar.querySelectorAll('.pin-remove-btn').forEach(btn =>
            btn.addEventListener('click', () => unpinTeam(parseInt(btn.dataset.id)))
        );
    }

    if (!fullList) return;

    if (!getUser()) {
        fullList.innerHTML = `
            <div class="saved-empty">
                <div style="font-size:32px;margin-bottom:12px">📌</div>
                <div style="font-size:16px;font-weight:800;margin-bottom:8px">Pin your favourite teams</div>
                <p style="color:var(--text-muted);margin-bottom:16px">Login to pin teams and see them here</p>
                <button class="modal-submit" style="max-width:200px;margin:0 auto" onclick="openAuthModal('login')">Login / Sign Up</button>
            </div>`;
        return;
    }

    fullList.innerHTML = teams.length === 0
        ? '<div class="saved-empty"><div style="font-size:32px;margin-bottom:8px">📌</div><p>No pinned teams yet — search a team in the Analyse tab and click the pin button</p></div>'
        : `<div class="saved-section-title">📌 Pinned Teams</div>
           <div class="pinned-grid">
               ${teams.map(t => `
                   <div class="pinned-card">
                       <img src="${t.team_logo}" alt="" class="pinned-card-logo" onerror="this.style.display='none'">
                       <div class="pinned-card-name">${t.team_name}</div>
                       <button class="pin-remove-sm" data-id="${t.team_id}">Unpin</button>
                   </div>
               `).join('')}
           </div>`;

    fullList.querySelectorAll('.pin-remove-sm').forEach(btn =>
        btn.addEventListener('click', () => unpinTeam(parseInt(btn.dataset.id)))
    );
}

function renderSavedAnalyses(analyses) {
    const sidebar  = document.getElementById('savedAnalysesList');
    const fullList = document.getElementById('savedAnalysesFullList');

    if (sidebar) {
        if (!getUser()) {
            sidebar.innerHTML = `<div class="sb-empty sb-login-prompt">
                <a class="sb-login-link" href="#" onclick="openAuthModal('login');return false;">Login</a> to save analyses
            </div>`;
        } else if (analyses.length === 0) {
            sidebar.innerHTML = '<div class="sb-empty">No saved analyses yet — run an analysis and save it</div>';
        } else {
            sidebar.innerHTML = analyses.slice(0, 4).map(a => `
                <div class="saved-brief-row">
                    <img src="${a.team1_logo}" alt="" width="16" height="16" style="object-fit:contain" onerror="this.style.display='none'">
                    <span>${a.team1_name}</span>
                    <span style="color:var(--text-muted);margin:0 4px;font-size:10px">vs</span>
                    <img src="${a.team2_logo}" alt="" width="16" height="16" style="object-fit:contain" onerror="this.style.display='none'">
                    <span>${a.team2_name}</span>
                </div>
            `).join('');
        }
    }

    if (!fullList) return;

    if (!getUser()) {
        fullList.innerHTML = `
            <div class="saved-empty">
                <div style="font-size:32px;margin-bottom:12px">💾</div>
                <div style="font-size:16px;font-weight:800;margin-bottom:8px">Save your analyses</div>
                <p style="color:var(--text-muted);margin-bottom:16px">Create an account to save predictions and access them later</p>
                <button class="modal-submit" style="max-width:200px;margin:0 auto" onclick="openAuthModal('signup')">Create Account</button>
            </div>`;
        return;
    }

    if (analyses.length === 0) {
        fullList.innerHTML = '<div class="saved-empty"><div style="font-size:32px;margin-bottom:8px">💾</div><p>No saved analyses yet — run a match analysis and click the Save button</p></div>';
        return;
    }

    fullList.innerHTML = `
        <div class="saved-section-title">💾 Saved Analyses</div>
        <div class="saved-analyses-grid">
            ${analyses.map(a => `
                <div class="saved-analysis-card">
                    <div class="sac-teams">
                        <div class="sac-team">
                            <img src="${a.team1_logo}" alt="" class="sac-logo" onerror="this.style.display='none'">
                            <span>${a.team1_name}</span>
                        </div>
                        <span class="sac-vs">vs</span>
                        <div class="sac-team">
                            <img src="${a.team2_logo}" alt="" class="sac-logo" onerror="this.style.display='none'">
                            <span>${a.team2_name}</span>
                        </div>
                    </div>
                    <div class="sac-date">${new Date(a.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</div>
                    <div class="sac-actions">
                        <button class="sac-analyse-btn"
                            data-t1id="${a.team1_id}" data-t1name="${a.team1_name.replace(/"/g,'&quot;')}" data-t1logo="${a.team1_logo}"
                            data-t2id="${a.team2_id}" data-t2name="${a.team2_name.replace(/"/g,'&quot;')}" data-t2logo="${a.team2_logo}">
                            Re-analyse
                        </button>
                        <button class="sac-delete-btn" data-id="${a.id}">Delete</button>
                    </div>
                </div>
            `).join('')}
        </div>`;

    fullList.querySelectorAll('.sac-delete-btn').forEach(btn =>
        btn.addEventListener('click', () => deleteAnalysis(btn.dataset.id))
    );
    fullList.querySelectorAll('.sac-analyse-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            prefillTeams(
                { id: parseInt(btn.dataset.t1id), name: btn.dataset.t1name, logo: btn.dataset.t1logo },
                { id: parseInt(btn.dataset.t2id), name: btn.dataset.t2name, logo: btn.dataset.t2logo }
            );
        });
    });
}
