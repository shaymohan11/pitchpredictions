function factorial(n) {
    if (n <= 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}

function poissonProb(lambda, k) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(Math.min(k, 20));
}

function probOver(lambda, threshold) {
    let under = 0;
    for (let k = 0; k <= Math.floor(threshold); k++) under += poissonProb(lambda, k);
    return Math.round((1 - under) * 1000) / 10;
}

function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pct(arr, pred) {
    if (!arr.length) return 0;
    return arr.filter(pred).length / arr.length;
}

function calcAverages(matches) {
    return {
        goals:          avg(matches.map(m => m.goalsScored)),
        goalsConceded:  avg(matches.map(m => m.goalsConceded)),
        shots:          avg(matches.map(m => m.shots)),
        shotsOnTarget:  avg(matches.map(m => m.shotsOnTarget)),
        corners:        avg(matches.map(m => m.corners)),
        fouls:          avg(matches.map(m => m.fouls)),
        yellowCards:    avg(matches.map(m => m.yellowCards)),
        redCards:       avg(matches.map(m => m.redCards)),
        cards:          avg(matches.map(m => m.cards)),
        possession:     avg(matches.map(m => m.possession)),
        scoredRate:     pct(matches, m => m.goalsScored > 0),
        cleanSheetRate: pct(matches, m => m.goalsConceded === 0),
        count:   matches.length,
        wins:    matches.filter(m => m.result === 'W').length,
        draws:   matches.filter(m => m.result === 'D').length,
        losses:  matches.filter(m => m.result === 'L').length
    };
}

function buildStat(label, unit, avgA, avgB, lines) {
    const lambda = avgA + avgB;
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
    return {
        goals:         buildStat('Total Goals',        'goals',    avgs1.goals,         avgs2.goals,         [0.5, 1.5, 2.5, 3.5, 4.5]),
        corners:       buildStat('Total Corners',      'corners',  avgs1.corners,        avgs2.corners,        [7.5, 8.5, 9.5, 10.5, 11.5, 12.5]),
        shots:         buildStat('Total Shots',        'shots',    avgs1.shots,          avgs2.shots,          [16.5, 18.5, 20.5, 22.5, 24.5, 26.5]),
        shotsOnTarget: buildStat('Shots on Target',    'on target',avgs1.shotsOnTarget,  avgs2.shotsOnTarget,  [5.5, 6.5, 7.5, 8.5, 9.5, 10.5]),
        cards:         buildStat('Total Cards',        'cards',    avgs1.cards,          avgs2.cards,          [1.5, 2.5, 3.5, 4.5, 5.5]),
        fouls:         buildStat('Total Fouls',        'fouls',    avgs1.fouls,          avgs2.fouls,          [16.5, 18.5, 20.5, 22.5, 24.5]),
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
