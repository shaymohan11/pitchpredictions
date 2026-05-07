/* PitchIQ — Usage limits & subscription */

const VIP_EMAIL  = 'orevolt321@gmail.com'; // lowercase — Google OAuth normalises emails
const FREE_LIMIT = 3;
const PRO_LIMIT  = 20;
const CHECKOUT_URL = 'https://bzyvjpujyxikhyfmqevt.supabase.co/functions/v1/create-checkout';

let _subStatus = null; // 'vip' | 'active' | 'inactive'

// ── Load subscription status on sign-in ──────────────────────────────────────
async function loadSubscription() {
    const user = getUser();
    if (!user) { _subStatus = null; updateUsagePill(); return; }
    if (user.email?.toLowerCase() === VIP_EMAIL) { _subStatus = 'vip'; updateUsagePill(); return; }

    try {
        const { data } = await db.from('subscriptions')
            .select('status, current_period_end')
            .eq('user_id', user.id)
            .maybeSingle();

        _subStatus = data?.status || 'inactive';

        if (_subStatus === 'active' && data?.current_period_end) {
            if (new Date(data.current_period_end) < new Date()) _subStatus = 'inactive';
        }
    } catch (_) {
        _subStatus = 'inactive';
    }
    updateUsagePill();
}

// ── Get today's usage count ───────────────────────────────────────────────────
async function getTodayUsage() {
    const user = getUser();
    if (!user) return 0;
    const today = new Date().toISOString().split('T')[0];
    try {
        const { data } = await db.from('user_usage')
            .select('analysis_count')
            .eq('user_id', user.id)
            .eq('date', today)
            .maybeSingle();
        return data?.analysis_count || 0;
    } catch (_) { return 0; }
}

// ── Check if user can run an analysis ────────────────────────────────────────
async function checkCanAnalyse() {
    const user = getUser();
    if (!user) { openAuthModal('login'); return false; }
    if (_subStatus === 'vip') return true;

    const count = await getTodayUsage();
    const isActive = _subStatus === 'active';
    const limit = isActive ? PRO_LIMIT : FREE_LIMIT;

    if (count >= limit) {
        showSubPopup(count, limit, isActive);
        return false;
    }
    return true;
}

// ── Record a completed analysis ───────────────────────────────────────────────
async function recordAnalysis() {
    const user = getUser();
    if (!user || _subStatus === 'vip') return;
    const today = new Date().toISOString().split('T')[0];
    try {
        await db.rpc('increment_analysis', { p_user_id: user.id, p_date: today });
    } catch (_) {}
    updateUsagePill();
}

// ── Update header usage pill ──────────────────────────────────────────────────
async function updateUsagePill() {
    const pill = document.getElementById('apiUsage');
    if (!pill) return;

    const user = getUser();
    if (!user) { pill.classList.add('hidden'); return; }

    if (_subStatus === 'vip') {
        pill.textContent = '♾ Unlimited';
        pill.className = 'usage-pill';
        pill.classList.remove('hidden');
        return;
    }

    const count = await getTodayUsage();
    const isActive = _subStatus === 'active';
    const limit = isActive ? PRO_LIMIT : FREE_LIMIT;
    const rem = limit - count;
    const tier = isActive ? 'Pro' : 'Free';

    pill.textContent = `${tier} · ${rem}/${limit} left today`;
    pill.className = 'usage-pill' + (rem <= 0 ? ' critical' : rem <= 1 ? ' low' : '');
    pill.classList.remove('hidden');
}

// ── Subscription popup ────────────────────────────────────────────────────────
function showSubPopup(count, limit, isSubscribed) {
    const popup = document.getElementById('subPopup');
    const pill  = document.getElementById('subPill');
    const msg   = document.getElementById('subPopupUsed');

    if (msg) {
        msg.textContent = isSubscribed
            ? `You've used all ${limit} of your Premium analyses today. Resets at midnight.`
            : `You've used your ${limit} free analyses today. Upgrade for ${PRO_LIMIT} per day.`;
    }

    _wirePayBtn();

    popup.classList.remove('hidden');
    pill.classList.add('hidden');
    document.body.style.overflow = 'hidden';
}

function hideSubPopup() {
    document.getElementById('subPopup').classList.add('hidden');
    document.body.style.overflow = '';
}

function minimiseSubPopup() {
    document.getElementById('subPopup').classList.add('hidden');
    document.getElementById('subPill').classList.remove('hidden');
    document.body.style.overflow = '';
}

// ── Wire the pay button (called each time popup opens) ────────────────────────
function _wirePayBtn() {
    const btn = document.getElementById('subPayBtn');
    if (!btn) return;
    btn.textContent = 'Get PitchIQ Premium — £3/mo';
    btn.disabled = false;

    btn.onclick = async () => {
        const user = getUser();
        if (!user) { openAuthModal('login'); return; }

        btn.textContent = 'Redirecting to payment...';
        btn.disabled = true;

        try {
            const resp = await fetch(CHECKOUT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id:    user.id,
                    email:      user.email,
                    return_url: window.location.origin + window.location.pathname
                })
            });
            const { url, error } = await resp.json();
            if (error) throw new Error(error);
            window.location.href = url;
        } catch (e) {
            btn.textContent = 'Get PitchIQ Premium — £3/mo';
            btn.disabled = false;
            alert('Could not start checkout: ' + e.message);
        }
    };
}

// ── Handle return from Stripe ─────────────────────────────────────────────────
function _handlePaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('payment');
    if (!status) return;

    history.replaceState({}, '', window.location.pathname);

    if (status === 'success') {
        const toast = document.getElementById('paymentToast');
        if (toast) {
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 6000);
        }
        // Webhook may not have fired yet — poll subscription after a short delay
        setTimeout(async () => {
            await loadSubscription();
            updateUsagePill();
        }, 3000);
    }
}

// ── Init popup controls ───────────────────────────────────────────────────────
function initBilling() {
    document.getElementById('subPopupClose')?.addEventListener('click', hideSubPopup);
    document.getElementById('subPopupMinimize')?.addEventListener('click', minimiseSubPopup);
    document.getElementById('subPill')?.addEventListener('click', async () => {
        const count = await getTodayUsage();
        const isActive = _subStatus === 'active';
        const limit = isActive ? PRO_LIMIT : FREE_LIMIT;
        showSubPopup(count, limit, isActive);
    });

    _handlePaymentReturn();
}
