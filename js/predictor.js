/* PitchPredictions — Dixon-Coles predictor with weighted recent form */

function factorial(n) {
    if (n <= 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}

function poissonProb(lambda, k) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    if (k > 200) return 0;
    // Log-space for numerical stability with large lambda (shots, corners, etc.)
    let logP = k * Math.log(lambda) - lambda;
    for (let i = 1; i <= k; i++) logP -= Math.log(i);
    const p = Math.exp(logP);
    return isFinite(p) ? p : 0;
}

const RHO      = -0.1;   // Dixon-Coles low-score correction
const MAX_G    = 8;      // max goals per team in matrix
const HOME_ADV = 1.10;   // home goals multiplier
const AWAY_ADJ = 0.90;   // away goals multiplier
const DECAY    = 0.12;   // exponential decay for recent form (higher = steeper)

// Dixon-Coles correction for low-scoring cells
function dcTau(x, y, lH, lA) {
    if (x === 0 && y === 0) return 1 - lH * lA * RHO;
    if (x === 0 && y === 1) return 1 + lH * RHO;
    if (x === 1 && y === 0) return 1 + lA * RHO;
    if (x === 1 && y === 1) return 1 - RHO;
    return 1;
}

function buildScoreMatrix(lH, lA) {
    const m = [];
    let tot = 0;
    for (let x = 0; x <= MAX_G; x++) {
        m[x] = [];
        for (let y = 0; y <= MAX_G; y++) {
            m[x][y] = Math.max(0, poissonProb(lH, x) * poissonProb(lA, y) * dcTau(x, y, lH, lA));
            tot += m[x][y];
        }
    }
    if (tot > 0)
        for (let x = 0; x <= MAX_G; x++)
            for (let y = 0; y <= MAX_G; y++)
                m[x][y] /= tot;
    return m;
}

function calcWDL(lH, lA) {
    const m = buildScoreMatrix(lH, lA);
    let hw = 0, dr = 0, aw = 0;
    for (let x = 0; x <= MAX_G; x++)
        for (let y = 0; y <= MAX_G; y++) {
            if (x > y) hw += m[x][y];
            else if (x === y) dr += m[x][y];
            else aw += m[x][y];
        }
    const tot = hw + dr + aw || 1;
    return {
        homeWin:  Math.round(hw / tot * 100),
        draw:     Math.round(dr / tot * 100),
        awayWin:  Math.round(aw / tot * 100)
    };
}

function probOver(lambda, threshold) {
    let under = 0;
    for (let k = 0; k <= Math.floor(threshold); k++) under += poissonProb(lambda, k);
    return Math.round((1 - under) * 1000) / 10;
}

// Exponentially weighted average — most recent match (index 0) has weight 1.0
function wAvg(matches, key) {
    if (!matches.length) return 0;
    const ws = matches.map((_, i) => Math.exp(-i * DECAY));
    const tot = ws.reduce((a, b) => a + b, 0);
    return matches.reduce((s, m, i) => s + ((m[key] || 0) * ws[i]), 0) / tot;
}

function wPct(matches, pred) {
    if (!matches.length) return 0;
    const ws = matches.map((_, i) => Math.exp(-i * DECAY));
    const tot = ws.reduce((a, b) => a + b, 0);
    return matches.reduce((s, m, i) => s + (pred(m) ? ws[i] : 0), 0) / tot;
}

function calcAverages(matches) {
    const n = matches.length;
    if (n === 0) return {
        goals: 0, goalsConceded: 0,
        scoredRate: 0, cleanSheetRate: 0, winRate: 0,
        count: 0, wins: 0, draws: 0, losses: 0
    };
    const wins   = matches.filter(m => m.result === 'W').length;
    const draws  = matches.filter(m => m.result === 'D').length;
    const losses = matches.filter(m => m.result === 'L').length;
    return {
        goals:          wAvg(matches, 'goalsScored'),
        goalsConceded:  wAvg(matches, 'goalsConceded'),
        scoredRate:     wPct(matches, m => m.goalsScored > 0),
        cleanSheetRate: wPct(matches, m => m.goalsConceded === 0),
        winRate:        wins / n,
        count: n, wins, draws, losses
    };
}

function buildStat(label, unit, avgA, avgB, lines) {
    const lambda = Math.max(0, avgA) + Math.max(0, avgB);
    return {
        label, unit,
        avgTeam1:  Math.round(avgA * 10) / 10,
        avgTeam2:  Math.round(avgB * 10) / 10,
        predicted: Math.round(lambda * 10) / 10,
        lines: lines.map(t => ({
            label: `Over ${t}`,
            over:  probOver(lambda, t),
            under: Math.round((100 - probOver(lambda, t)) * 10) / 10
        }))
    };
}

function predictMatch(avgs1, avgs2) {
    const lH = Math.max(0.1, avgs1.goals * HOME_ADV);
    const lA = Math.max(0.1, avgs2.goals * AWAY_ADJ);
    const wdl = calcWDL(lH, lA);

    // Shot/corner/card estimates derived from goals (league-average correlations)
    const SHOTS_PER_GOAL = 9.5;   // EPL avg ≈ 9.3 shots per goal
    const SOT_RATE       = 0.33;  // ~33% of shots on target
    const CORN_PER_GOAL  = 3.7;   // EPL avg ≈ 3.7 corners per goal
    const FH_SHARE       = 0.38;  // ~38% of goals scored in first half

    const shotsH = lH * SHOTS_PER_GOAL;
    const shotsA = lA * SHOTS_PER_GOAL;

    return {
        wdl,
        doubleChance: {
            homeOrDraw: wdl.homeWin + wdl.draw,
            drawOrAway: wdl.draw + wdl.awayWin,
            homeOrAway: wdl.homeWin + wdl.awayWin
        },
        goals:           buildStat('Total Goals',       'goals', lH,                    lA,                    [0.5, 1.5, 2.5, 3.5, 4.5]),
        goalsFirstHalf:  buildStat('First Half Goals',  'goals', lH * FH_SHARE,          lA * FH_SHARE,          [0.5, 1.5]),
        goalsSecondHalf: buildStat('Second Half Goals', 'goals', lH * (1 - FH_SHARE),    lA * (1 - FH_SHARE),    [0.5, 1.5, 2.5]),
        shots:           buildStat('Total Shots',       'shots', shotsH,                 shotsA,                 [18.5, 21.5, 24.5, 27.5, 30.5]),
        shotsOnTarget:   buildStat('Shots on Target',   'sot',   shotsH * SOT_RATE,      shotsA * SOT_RATE,      [4.5, 6.5, 8.5, 10.5]),
        corners:         buildStat('Total Corners',     'crnrs', lH * CORN_PER_GOAL,     lA * CORN_PER_GOAL,     [7.5, 9.5, 11.5, 13.5]),
        cards:           buildStat('Total Cards',       'cards', 1.75,                   1.75,                   [1.5, 2.5, 3.5, 4.5]),
        btts: {
            label:          'Both Teams to Score',
            prob:           Math.round(avgs1.scoredRate * avgs2.scoredRate * 100),
            team1ScoredPct: Math.round(avgs1.scoredRate * 100),
            team2ScoredPct: Math.round(avgs2.scoredRate * 100),
            team1CSPct:     Math.round(avgs1.cleanSheetRate * 100),
            team2CSPct:     Math.round(avgs2.cleanSheetRate * 100)
        }
    };
}
